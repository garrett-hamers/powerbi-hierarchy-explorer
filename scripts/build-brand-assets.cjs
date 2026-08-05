/*
 * Renders both brand marks:
 *   assets/partner-center-logo.png - the 300x300 listing logo on the AppSource
 *                                    offer card
 *   assets/icon.png                - the 20x20 icon Power BI shows in the
 *                                    visualization pane, embedded in the
 *                                    packaged .pbiviz as content.iconBase64
 *
 * Both are the same mark - a parent/child tree, which is the shape the visual
 * itself draws, on the #2764C4 brand tile - drawn by one code path from the
 * geometry below, so the listing and the visualization pane cannot drift apart.
 *
 * Everything is drawn here rather than exported from a design tool so the assets
 * are reproducible and reviewable: running this script on any machine rewrites
 * byte-identical output. It uses the Node standard library only - no browser, no
 * image library, nothing added to the dependency tree that `npm audit` would
 * then have to cover.
 *
 * Shapes are analytic (rounded rectangles and round-capped capsules) and are
 * sampled on a SUPERSAMPLE x SUPERSAMPLE grid per output pixel, so every curve
 * lands on real intermediate tones instead of the stair-stepping a hard-edged
 * two-colour image produces. The PNG encoder is the mirror image of the decoder
 * in read-png-metadata.cjs, which is also what verifies the results before this
 * script reports success.
 *
 *   npm run brand-assets
 */
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { readPngMetadata } = require("./read-png-metadata.cjs");

const root = path.resolve(__dirname, "..");

// 8x8 = 64 coverage samples per pixel. Enough tones for the eye to read the
// curves as smooth, and few enough that the palettes stay in the same band as
// the rest of the portfolio's artwork.
const SUPERSAMPLE = 8;

// #2764C4 is the visual's own accent, so the listing, the visualization pane and
// the rendered chart all agree.
const PALETTE = {
  page: "#FFFFFF",
  brand: "#2764C4",
  node: "#FFFFFF",
  leaf: "#C3D8F5"
};

/*
 * The two marks share a motif but not a coordinate system, because a 20x20 icon
 * is not a 300x300 logo scaled by 1/15. Scaling down proportionally would give
 * the icon 0.5px connectors and 2.8px nodes, which resolve to faint grey smears
 * rather than shapes. Small canvases need relatively bolder strokes and fewer
 * elements, so the icon carries the top two levels of the same tree - a root and
 * its two children - at weights tuned for 20 pixels: a proportionally thicker
 * connector, wider margins, and enough blue between the bus and the child nodes
 * that they stay legible as separate shapes rather than merging into a blob.
 *
 * `levels` runs root first. `links` joins each level to the one below it with an
 * elbow: a drop from the parent, a bus across its children, and a drop into each
 * child. Children are split evenly between the parents above them.
 */
const ASSETS = [
  {
    name: "partnerCenterLogo",
    relativePath: "assets/partner-center-logo.png",
    size: 300,
    tileRadius: 48,
    levels: [
      { centers: [150], centerY: 73, width: 106, height: 42, radius: 13, color: PALETTE.node },
      { centers: [86, 214], centerY: 151, width: 86, height: 38, radius: 11, color: PALETTE.node },
      {
        centers: [56, 116, 184, 244],
        centerY: 228,
        width: 50,
        height: 40,
        radius: 10,
        color: PALETTE.leaf
      }
    ],
    links: [
      { parent: 0, busY: 113, stroke: 7, color: PALETTE.node },
      { parent: 1, busY: 189, stroke: 6, color: PALETTE.leaf }
    ]
  },
  {
    name: "icon",
    relativePath: "assets/icon.png",
    size: 20,
    tileRadius: 3.2,
    levels: [
      { centers: [10], centerY: 4.5, width: 11, height: 4.2, radius: 1.4, color: PALETTE.node },
      { centers: [5.2, 14.8], centerY: 14.7, width: 7.2, height: 4.6, radius: 1.4, color: PALETTE.node }
    ],
    links: [{ parent: 0, busY: 9.4, stroke: 1.4, color: PALETTE.node }]
  }
];

// Floors the render must clear before it is written, so a change to the geometry
// that flattened a mark could not quietly ship. They match the publication gate
// in validate-publication-assets.cjs.
const MIN_COLORS = { 300: 16, 20: 8 };

const fail = (message) => {
  process.stderr.write(`Brand asset generation failed: ${message}\n`);
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

const drawLevel = (surface, level) => {
  for (const center of level.centers) {
    surface.roundedRect(
      center - level.width / 2,
      level.centerY - level.height / 2,
      level.width,
      level.height,
      level.radius,
      level.color
    );
  }
};

/**
 * Draws the elbow connectors from one parent down to the children beneath it:
 * a drop from the parent, a bus across the children, and a drop into each one.
 */
const drawElbow = (surface, parentBottom, parentCenter, children, childTop, busY, stroke, color) => {
  surface.capsule(parentCenter, parentBottom, parentCenter, busY, stroke, color);
  surface.capsule(children[0], busY, children[children.length - 1], busY, stroke, color);
  for (const child of children) {
    surface.capsule(child, busY, child, childTop, stroke, color);
  }
};

const renderMark = (asset) => {
  const surface = new Surface(asset.size, SUPERSAMPLE);
  surface.fill(PALETTE.page);
  surface.roundedRect(0, 0, asset.size, asset.size, asset.tileRadius, PALETTE.brand);

  // Connectors first so the nodes sit on top of the joins.
  for (const link of asset.links) {
    const parent = asset.levels[link.parent];
    const child = asset.levels[link.parent + 1];
    const perParent = child.centers.length / parent.centers.length;
    parent.centers.forEach((parentCenter, index) => {
      drawElbow(
        surface,
        parent.centerY + parent.height / 2,
        parentCenter,
        child.centers.slice(index * perParent, (index + 1) * perParent),
        child.centerY - child.height / 2,
        link.busY,
        link.stroke,
        link.color
      );
    });
  }

  for (const level of asset.levels) {
    drawLevel(surface, level);
  }

  return { width: asset.size, height: asset.size, rgba: surface.resolve() };
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

const buildBrandAssets = () =>
  ASSETS.map((asset) => {
    const mark = renderMark(asset);
    return { ...asset, ...mark, png: encodePng(mark.width, mark.height, mark.rgba) };
  });

module.exports = { ASSETS, buildBrandAssets, renderMark, encodePng, MIN_COLORS };

if (require.main === module) {
  for (const asset of buildBrandAssets()) {
    const target = path.join(root, ...asset.relativePath.split("/"));
    fs.writeFileSync(target, asset.png);

    // Verified with the same decoder the publication gate uses, so a render that
    // silently produced a flat or malformed image cannot be committed.
    const metadata = readPngMetadata(target);
    if (metadata.width !== asset.size || metadata.height !== asset.size) {
      fail(
        `${asset.relativePath} rendered ${metadata.width}x${metadata.height} but must be exactly ${asset.size}x${asset.size}`
      );
    }
    const floor = MIN_COLORS[asset.size];
    if (metadata.distinctColors < floor) {
      fail(
        `${asset.relativePath} rendered only ${metadata.distinctColors} distinct colours, below the ${floor} required of an antialiased mark`
      );
    }
    process.stdout.write(
      `${asset.relativePath} written: ${metadata.width}x${metadata.height}, ${metadata.bytes} bytes, ` +
        `${metadata.distinctColors} distinct colours, ${metadata.sha256}\n`
    );
  }
}
