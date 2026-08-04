const crypto = require("node:crypto");
const fs = require("node:fs");

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const IHDR = Buffer.from("IHDR", "ascii");

const readPngMetadata = (filePath) => {
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

  return {
    bytes: bytes.length,
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    sha256: crypto.createHash("sha256").update(bytes).digest("hex").toUpperCase()
  };
};

module.exports = { readPngMetadata };
