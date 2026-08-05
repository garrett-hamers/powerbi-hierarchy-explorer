const crypto = require("node:crypto");
const fs = require("node:fs");
const zlib = require("node:zlib");

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const IHDR = Buffer.from("IHDR", "ascii");

/**
 * Walks the PNG chunk stream so callers can assert real structure instead of
 * trusting the 8-byte signature alone. Returns the chunk type order and the
 * concatenated IDAT payload.
 */
const readChunks = (bytes, filePath) => {
  const types = [];
  const imageData = [];
  let offset = 8;

  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString("ascii");
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) {
      throw new Error(`${filePath}: truncated PNG chunk "${type}"`);
    }
    types.push(type);
    if (type === "IDAT") {
      imageData.push(bytes.subarray(dataStart, dataEnd));
    }
    offset = dataEnd + 4;
    if (type === "IEND") {
      break;
    }
  }

  return { types, imageData: Buffer.concat(imageData) };
};

/**
 * Reverses PNG scanline filters and returns the decoded pixel rows. Only the
 * 8-bit truecolour forms we actually ship are supported (RGB and RGBA,
 * non-interlaced); anything else is rejected loudly rather than guessed at.
 */
const decodePixels = (bytes, imageData, header, filePath) => {
  if (imageData.length === 0) {
    throw new Error(`${filePath}: PNG contains no IDAT image data`);
  }
  if (header.bitDepth !== 8 || (header.colorType !== 2 && header.colorType !== 6)) {
    throw new Error(
      `${filePath}: unsupported PNG format (bit depth ${header.bitDepth}, colour type ${header.colorType}); expected 8-bit RGB or RGBA`
    );
  }
  if (header.interlace !== 0) {
    throw new Error(`${filePath}: interlaced PNGs are not supported`);
  }

  let raw;
  try {
    raw = zlib.inflateSync(imageData);
  } catch (error) {
    throw new Error(`${filePath}: PNG image data could not be inflated (${error.message})`);
  }

  const channels = header.colorType === 6 ? 4 : 3;
  const stride = header.width * channels;
  const expected = (stride + 1) * header.height;
  if (raw.length < expected) {
    throw new Error(`${filePath}: PNG image data is short (${raw.length} of ${expected} bytes)`);
  }

  const pixels = Buffer.alloc(stride * header.height);
  let source = 0;
  for (let row = 0; row < header.height; row += 1) {
    const filter = raw[source];
    source += 1;
    const target = row * stride;
    const above = target - stride;
    for (let index = 0; index < stride; index += 1) {
      const value = raw[source + index];
      const left = index >= channels ? pixels[target + index - channels] : 0;
      const up = row > 0 ? pixels[above + index] : 0;
      const upLeft = row > 0 && index >= channels ? pixels[above + index - channels] : 0;
      let restored;
      switch (filter) {
        case 0:
          restored = value;
          break;
        case 1:
          restored = value + left;
          break;
        case 2:
          restored = value + up;
          break;
        case 3:
          restored = value + ((left + up) >> 1);
          break;
        case 4: {
          const estimate = left + up - upLeft;
          const distanceLeft = Math.abs(estimate - left);
          const distanceUp = Math.abs(estimate - up);
          const distanceUpLeft = Math.abs(estimate - upLeft);
          const predictor =
            distanceLeft <= distanceUp && distanceLeft <= distanceUpLeft
              ? left
              : distanceUp <= distanceUpLeft
                ? up
                : upLeft;
          restored = value + predictor;
          break;
        }
        default:
          throw new Error(`${filePath}: unknown PNG scanline filter ${filter} on row ${row}`);
      }
      pixels[target + index] = restored & 0xff;
    }
    source += stride;
  }

  return { pixels, channels, stride };
};

/**
 * Counts distinct colours in the decoded image. A fabricated placeholder is a
 * single flat fill, so any genuine artwork clears a small threshold while a
 * blank rectangle cannot.
 */
const countDistinctColors = (pixels, channels, limit = 4096) => {
  const seen = new Set();
  for (let offset = 0; offset + channels <= pixels.length; offset += channels) {
    let key = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      key = key * 256 + pixels[offset + channel];
    }
    seen.add(key);
    if (seen.size >= limit) {
      break;
    }
  }
  return seen.size;
};

/**
 * Reads and fully decodes a PNG once. Both public helpers build on this so the
 * structural checks and the pixel comparison can never disagree about a file.
 */
const readPngImage = (filePath) => {
  const bytes = fs.readFileSync(filePath);
  if (bytes.length < 33) {
    throw new Error(`${filePath}: PNG file is truncated`);
  }
  if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error(`${filePath}: invalid PNG signature`);
  }
  const firstChunkLength = bytes.readUInt32BE(8);
  const firstChunkType = bytes.subarray(12, 16);
  if (!firstChunkType.equals(IHDR) || firstChunkLength < 13) {
    throw new Error(`${filePath}: missing PNG IHDR chunk`);
  }

  const { types, imageData } = readChunks(bytes, filePath);
  const header = {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    bitDepth: bytes.readUInt8(24),
    colorType: bytes.readUInt8(25),
    interlace: bytes.readUInt8(28)
  };
  const { pixels, channels } = decodePixels(bytes, imageData, header, filePath);
  return { bytes, header, types, pixels, channels };
};

/**
 * The summary the publication gate and the release manifest record. It stays
 * JSON-sized on purpose: the decoded samples are reached through readPngPixels.
 */
const readPngMetadata = (filePath) => {
  const { bytes, header, types, pixels, channels } = readPngImage(filePath);
  return {
    bytes: bytes.length,
    ...header,
    chunkTypes: types,
    distinctColors: countDistinctColors(pixels, channels),
    sha256: crypto.createHash("sha256").update(bytes).digest("hex").toUpperCase()
  };
};

/**
 * The decoded samples on their own, for callers that need to compare an image
 * against freshly rendered pixels rather than against compressed file bytes.
 */
const readPngPixels = (filePath) => {
  const { header, pixels, channels } = readPngImage(filePath);
  return { width: header.width, height: header.height, channels, pixels };
};

module.exports = { readPngMetadata, readPngPixels };
