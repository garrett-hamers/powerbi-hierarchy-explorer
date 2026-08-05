/*
 * Renders assets/partner-center-logo.png - the 300x300 listing logo Partner
 * Center shows on the AppSource offer card.
 *
 * The mark is a three level parent/child tree, which is the shape the visual
 * itself draws, on the same #2764C4 brand tile as the 20x20 assets/icon.png.
 *
 * Everything is drawn here rather than exported from a design tool so the asset
 * is reproducible and reviewable: the geometry below is the source, and running
 * this script on any machine rewrites byte-identical output. It uses the Node
 * standard library only - no browser, no image library, nothing added to the
 * dependency tree that `npm audit` would then have to cover.
 *
 * Shapes are analytic (rounded rectangles and round-capped capsules) and are
 * sampled on a SUPERSAMPLE x SUPERSAMPLE grid per output pixel, so every curved
 * and every diagonal edge lands on a real intermediate tone instead of the
 * stair-stepping a hard-edged two-colour image produces at this size. The PNG
 * encoder is the mirror image of the decoder in read-png-metadata.cjs, which is
 * also what verifies the result before this script reports success.
 *
 *   npm run logo
 */
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { readPngMetadata } = require("./read-png-metadata.cjs");

const root = path.resolve(__dirname, "..");
const targetPath = path.join(root, "assets", "partner-center-logo.png");
const relativeTarget = "assets/partner-center-logo.png";

const SIZE = 300;
// 8x8 = 64 coverage samples per pixel. Enough tones for the eye to read the
// rounded corners as smooth, and few enough that the palette stays in the same
// band as the rest of the portfolio's artwork.
const SUPERSAMPLE = 8;

// #2764C4 is the visual's own accent and the colour of the shipped 20x20 icon,
// so the listing, the visualization pane and the rendered chart all agree.
const PALETTE = {
  page: "#FFFFFF",
  brand: "#2764C4",
  node: "#FFFFFF",
  leaf: "#C3D8F5"
};

// Geometry in logo pixels. Every row is centred on 150, and each parent sits at
// the midpoint of its own children, so the tree stays symmetric.
const TILE_RADIUS = 48;
const ROOT = { centers: [150], centerY: 73, width: 106, height: 42, radius: 13 };
const BRANCH = { centers: [86, 214], centerY: 151, width: 86, height: 38, radius: 11 };
const LEAF = { centers: [56, 116, 184, 244], centerY: 228, width: 50, height: 40, radius: 10 };
const BRANCH_BUS_Y = 113;
const LEAF_BUS_Y = 189;
const BRANCH_STROKE = 7;
const LEAF_STROKE = 6;

const fail = (message) => {
  process.stderr.write(`Partner Center logo generation failed: ${message}\n`);
  process.exit(1);
};

const parseColor = (value) => [
  Number.parseInt(value.slice(1, 3), 16),
  Number.parseInt(value.slice(3, 5), 16),
  Number.parseInt(value.slice(5, 7), 16)
];

/**
 * An opaque RGB surface held at SUPERSAMPLE times the final resolution. Shapes
 * are painted as hard-edged coverage here and the antialiasing appears when
 * `resolve` averages each block back down to one pixel.
 */
class Surface {
  constructor(size, scale) {
    this.size = size;
    this.scale = scale;
    this.width = size * scale;
    this.samples = new Uint8Array(this.width * this.width * 3);
  }

  fill(color) {
    const [red, green, blue] = parseColor(color);
    for (let offset = 0; offset < this.samples.length; offset += 3) {
      this.samples[offset] = red;
      this.samples[offset + 1] = green;
      this.samples[offset + 2] = blue;
    }
  }

  /** Paints `color` wherever `inside` reports coverage, clipped to `bounds`. */
  paint(bounds, color, inside) {
    const [red, green, blue] = parseColor(color);
    const minX = Math.max(0, Math.floor(bounds[0] * this.scale));
    const minY = Math.max(0, Math.floor(bounds[1] * this.scale));
    const maxX = Math.min(this.width - 1, Math.ceil(bounds[2] * this.scale));
    const maxY = Math.min(this.width - 1, Math.ceil(bounds[3] * this.scale));
    for (let y = minY; y <= maxY; y += 1) {
      const sampleY = (y + 0.5) / this.scale;
      for (let x = minX; x <= maxX; x += 1) {
        const sampleX = (x + 0.5) / this.scale;
        if (!inside(sampleX, sampleY)) {
          continue;
        }
        const offset = (y * this.width + x) * 3;
        this.samples[offset] = red;
        this.samples[offset + 1] = green;
        this.samples[offset + 2] = blue;
      }
    }
  }

  roundedRect(x, y, width, height, radius, color) {
    const r = Math.min(radius, width / 2, height / 2);
    this.paint([x, y, x + width, y + height], color, (px, py) => {
      if (px < x || px > x + width || py < y || py > y + height) {
        return false;
      }
      const dx = Math.max(x + r - px, 0, px - (x + width - r));
      const dy = Math.max(y + r - py, 0, py - (y + height - r));
      return dx * dx + dy * dy <= r * r;
    });
  }

  /** A round-capped line, so connector joins meet without square notches. */
  capsule(x1, y1, x2, y2, strokeWidth, color) {
    const half = strokeWidth / 2;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lengthSquared = dx * dx + dy * dy;
    const bounds = [
      Math.min(x1, x2) - half,
      Math.min(y1, y2) - half,
      Math.max(x1, x2) + half,
      Math.max(y1, y2) + half
    ];
    this.paint(bounds, color, (px, py) => {
      const projection = lengthSquared === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / lengthSquared;
      const t = Math.min(1, Math.max(0, projection));
      const offsetX = x1 + t * dx - px;
      const offsetY = y1 + t * dy - py;
      return offsetX * offsetX + offsetY * offsetY <= half * half;
    });
  }

  /** Box-filters each SUPERSAMPLE x SUPERSAMPLE block into one opaque RGBA pixel. */
  resolve() {
    const rgba = new Uint8Array(this.size * this.size * 4);
    const perPixel = this.scale * this.scale;
    for (let y = 0; y < this.size; y += 1) {
      for (let x = 0; x < this.size; x += 1) {
        let red = 0;
        let green = 0;
        let blue = 0;
        for (let sampleY = 0; sampleY < this.scale; sampleY += 1) {
          const rowStart = ((y * this.scale + sampleY) * this.width + x * this.scale) * 3;
          for (let sampleX = 0; sampleX < this.scale; sampleX += 1) {
            const offset = rowStart + sampleX * 3;
            red += this.samples[offset];
            green += this.samples[offset + 1];
            blue += this.samples[offset + 2];
          }
        }
        const target = (y * this.size + x) * 4;
        rgba[target] = Math.round(red / perPixel);
        rgba[target + 1] = Math.round(green / perPixel);
        rgba[target + 2] = Math.round(blue / perPixel);
        rgba[target + 3] = 255;
      }
    }
    return rgba;
  }
}

const drawRow = (surface, row, color) => {
  for (const center of row.centers) {
    surface.roundedRect(
      center - row.width / 2,
      row.centerY - row.height / 2,
      row.width,
      row.height,
      row.radius,
      color
    );
  }
};

/**
 * Draws the elbow connectors from one parent down to the children beneath it:
 * a drop from the parent, a bus across the children, and a drop into each one.
 */
const drawConnectors = (surface, parent, parentCenter, children, childTop, busY, strokeWidth, color) => {
  const parentBottom = parent.centerY + parent.height / 2;
  surface.capsule(parentCenter, parentBottom, parentCenter, busY, strokeWidth, color);
  surface.capsule(children[0], busY, children[children.length - 1], busY, strokeWidth, color);
  for (const child of children) {
    surface.capsule(child, busY, child, childTop, strokeWidth, color);
  }
};

const renderLogo = () => {
  const surface = new Surface(SIZE, SUPERSAMPLE);
  surface.fill(PALETTE.page);
  surface.roundedRect(0, 0, SIZE, SIZE, TILE_RADIUS, PALETTE.brand);

  // Connectors first so the nodes sit on top of the joins.
  drawConnectors(
    surface,
    ROOT,
    ROOT.centers[0],
    BRANCH.centers,
    BRANCH.centerY - BRANCH.height / 2,
    BRANCH_BUS_Y,
    BRANCH_STROKE,
    PALETTE.node
  );
  const leafTop = LEAF.centerY - LEAF.height / 2;
  BRANCH.centers.forEach((branchCenter, index) => {
    const perBranch = LEAF.centers.length / BRANCH.centers.length;
    drawConnectors(
      surface,
      BRANCH,
      branchCenter,
      LEAF.centers.slice(index * perBranch, (index + 1) * perBranch),
      leafTop,
      LEAF_BUS_Y,
      LEAF_STROKE,
      PALETTE.leaf
    );
  });

  drawRow(surface, ROOT, PALETTE.node);
  drawRow(surface, BRANCH, PALETTE.node);
  drawRow(surface, LEAF, PALETTE.leaf);

  return { width: SIZE, height: SIZE, rgba: surface.resolve() };
};

// --- PNG encoding -------------------------------------------------------------

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

const crc32 = (buffer) => {
  let crc = 0xffffffff;
  for (let index = 0; index < buffer.length; index += 1) {
    crc = CRC_TABLE[(crc ^ buffer[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, checksum]);
};

const paeth = (left, up, upLeft) => {
  const estimate = left + up - upLeft;
  const distanceLeft = Math.abs(estimate - left);
  const distanceUp = Math.abs(estimate - up);
  const distanceUpLeft = Math.abs(estimate - upLeft);
  if (distanceLeft <= distanceUp && distanceLeft <= distanceUpLeft) {
    return left;
  }
  return distanceUp <= distanceUpLeft ? up : upLeft;
};

/**
 * Applies the standard adaptive scanline filter heuristic: try all five filters
 * and keep the one with the smallest sum of absolute signed differences. It is
 * a pure function of the pixels, so the choice - and therefore the file - is the
 * same on every run and every machine.
 */
const filterScanlines = (rgba, width, height) => {
  const channels = 4;
  const stride = width * channels;
  const output = Buffer.alloc((stride + 1) * height);
  const candidate = Buffer.alloc(stride);
  for (let row = 0; row < height; row += 1) {
    const start = row * stride;
    const previous = start - stride;
    let bestType = 0;
    let bestScore = Number.POSITIVE_INFINITY;
    let best = null;
    for (let type = 0; type <= 4; type += 1) {
      let score = 0;
      for (let index = 0; index < stride; index += 1) {
        const raw = rgba[start + index];
        const left = index >= channels ? rgba[start + index - channels] : 0;
        const up = row > 0 ? rgba[previous + index] : 0;
        const upLeft = row > 0 && index >= channels ? rgba[previous + index - channels] : 0;
        let value;
        switch (type) {
          case 0: value = raw; break;
          case 1: value = raw - left; break;
          case 2: value = raw - up; break;
          case 3: value = raw - ((left + up) >> 1); break;
          default: value = raw - paeth(left, up, upLeft); break;
        }
        candidate[index] = value & 0xff;
        const signed = candidate[index] > 127 ? 256 - candidate[index] : candidate[index];
        score += signed;
      }
      if (score < bestScore) {
        bestScore = score;
        bestType = type;
        best = Buffer.from(candidate);
      }
    }
    output[row * (stride + 1)] = bestType;
    best.copy(output, row * (stride + 1) + 1);
  }
  return output;
};

const encodePng = (width, height, rgba) => {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // truecolour with alpha
  header[10] = 0; // deflate
  header[11] = 0; // adaptive filtering
  header[12] = 0; // no interlace
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(filterScanlines(rgba, width, height), { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
};

const buildPartnerCenterLogo = () => {
  const logo = renderLogo();
  return { ...logo, png: encodePng(logo.width, logo.height, logo.rgba) };
};

module.exports = { buildPartnerCenterLogo, renderLogo, encodePng, SIZE };

if (require.main === module) {
  const logo = buildPartnerCenterLogo();
  fs.writeFileSync(targetPath, logo.png);

  // Verified with the same decoder the publication gate uses, so a render that
  // silently produced a flat or malformed image cannot be committed.
  const metadata = readPngMetadata(targetPath);
  if (metadata.width !== SIZE || metadata.height !== SIZE) {
    fail(`rendered ${metadata.width}x${metadata.height} but Partner Center requires exactly ${SIZE}x${SIZE}`);
  }
  if (metadata.distinctColors < 24) {
    fail(`rendered only ${metadata.distinctColors} distinct colours, which is not an antialiased mark`);
  }
  process.stdout.write(
    `${relativeTarget} written: ${metadata.width}x${metadata.height}, ${metadata.bytes} bytes, ` +
      `${metadata.distinctColors} distinct colours, ${metadata.sha256}\n`
  );
}
