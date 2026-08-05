/*
 * Deterministic gate for everything Microsoft requires in an AppSource /
 * Partner Center submission for a Power BI custom visual.
 *
 * Requirements enforced here (docs/partner-center-submission.md holds the
 * filled-in submission form values):
 *   - pbiviz.json carries name, display name, GUID, a four-part version,
 *     description, support URL, author name and author email
 *   - the Partner Center logo is a real 300x300 PNG carrying genuinely
 *     antialiased artwork rather than a flat upscale
 *   - the visualization pane icon is a real 20x20 PNG, and is the file
 *     pbiviz.json actually packages
 *   - 1 to 5 screenshots exist, each a real PNG at exactly 1366x768 and at most
 *     1024 KB
 *   - the support and privacy policy URLs are https
 *   - an EULA file is present
 *
 * Everything is checked with the Node standard library only, so CI needs no
 * browser and no extra packages.
 */
const fs = require("node:fs");
const path = require("node:path");
const { readPngMetadata } = require("./read-png-metadata.cjs");

const root = path.resolve(__dirname, "..");

const LOGO = { path: "assets/partner-center-logo.png", width: 300, height: 300 };
const ICON = { path: "assets/icon.png", width: 20, height: 20 };
const SCREENSHOTS = {
  directory: "assets/screenshots",
  width: 1366,
  height: 768,
  maxBytes: 1024 * 1024,
  min: 1,
  max: 5
};
const EULA = "EULA.md";
const DOSSIER = "docs/partner-center-submission.md";
const SUPPORT_URL = "https://atlyn.io/contact";
const PRIVACY_POLICY_URL = "https://atlyn.io/legal/privacy";
// Owner decision: the visual is listed free and monetised only through the
// Atlyn storefront subscription. Recorded here so the dossier cannot lose it.
const LISTING_PRICING = "AppSource listing: Free";
const SAMPLE_PROJECT = "samples/AtlynHierarchyExplorerSample.pbip";

// A single flat rectangle is what a fabricated placeholder looks like, and the
// 300x300 logo is where that actually matters: the defect this floor exists to
// catch is a logo produced by upscaling the 20x20 icon, which arrives as a valid
// PNG at the right dimensions carrying only the two inks it was drawn with.
//
// The floor is keyed by canvas size and deliberately covers the logo only. It is
// tempting to apply one to the icon too, but a distinct-colour count measures
// what a mark depicts rather than how well it is made: across this portfolio the
// icons run from 10 to 118 colours purely because some draw scattered points or
// graded fills while a tree diagram is inherently two-tone - boxes and
// connectors, one ink on one ground. The icon here is drawn as whole-pixel
// axis-aligned rectangles with no curve or diagonal anywhere, so it has nothing
// to antialias and resolves to exactly two colours by construction. A floor
// would only force fractional geometry and blur edges that are currently
// pixel-exact, which is the metric driving the artwork rather than the reverse.
//
// The icon is not ungated: it is checked for exact dimensions, real PNG
// structure, and that pbiviz.json packages the very file inspected here, and
// tests/package.test.ts re-renders it and compares pixels - which catches
// corruption, drift or a silent revert regardless of colour count, and is
// strictly stronger than counting for that purpose.
//
// 16 sits below the healthiest-known simple logo in the portfolio (20), so a
// legitimately simpler redesign is not tripped, while a two-tone upscale fails
// by 8x. `npm run brand-assets` reports the committed count.
const MIN_LOGO_COLORS = 16;
const MIN_SCREENSHOT_COLORS = 64;

const failures = [];
const fail = (message) => failures.push(message);

const requireText = (relativePath, label) => {
  const absolute = path.join(root, relativePath);
  if (!fs.existsSync(absolute)) {
    fail(`${label} is required but ${relativePath} is missing`);
    return null;
  }
  const contents = fs.readFileSync(absolute, "utf8");
  if (contents.trim().length === 0) {
    fail(`${label} at ${relativePath} is empty`);
    return null;
  }
  return contents;
};

const checkPng = (relativePath, { width, height, maxBytes, minColors, label }) => {
  let metadata;
  try {
    metadata = readPngMetadata(path.join(root, relativePath));
  } catch (error) {
    fail(`${label} ${relativePath}: ${error.message}`);
    return null;
  }
  if (metadata.width !== width || metadata.height !== height) {
    fail(
      `${label} ${relativePath} must be exactly ${width}x${height}; found ${metadata.width}x${metadata.height}`
    );
  }
  if (!metadata.chunkTypes.includes("IDAT") || !metadata.chunkTypes.includes("IEND")) {
    fail(`${label} ${relativePath} is not a complete PNG (chunks: ${metadata.chunkTypes.join(", ")})`);
  }
  if (typeof maxBytes === "number" && metadata.bytes > maxBytes) {
    fail(`${label} ${relativePath} is ${metadata.bytes} bytes; the limit is ${maxBytes} bytes`);
  }
  // minColors is optional: assets whose colour count reflects their subject
  // rather than their quality carry no floor. See the MIN_LOGO_COLORS comment.
  if (typeof minColors === "number" && metadata.distinctColors < minColors) {
    fail(
      `${label} ${relativePath} looks like a placeholder: only ${metadata.distinctColors} distinct colours (expected at least ${minColors})`
    );
  }
  return metadata;
};

// --- pbiviz.json submission metadata -----------------------------------------

const manifest = JSON.parse(fs.readFileSync(path.join(root, "pbiviz.json"), "utf8"));
const visual = manifest.visual ?? {};
const author = manifest.author ?? {};

for (const field of ["name", "displayName", "guid", "description"]) {
  if (typeof visual[field] !== "string" || visual[field].trim().length === 0) {
    fail(`pbiviz.json visual.${field} is required and must be a non-empty string`);
  }
}
if (!/^\d+\.\d+\.\d+\.\d+$/.test(visual.version ?? "")) {
  fail(`pbiviz.json visual.version must be a four-part x.x.x.x version; found ${visual.version}`);
}
if (typeof visual.description === "string" && visual.description.trim().length < 30) {
  fail("pbiviz.json visual.description is too short to describe the visual on a store listing");
}
if (visual.supportUrl !== SUPPORT_URL) {
  fail(`pbiviz.json visual.supportUrl must be ${SUPPORT_URL}; found ${visual.supportUrl}`);
}
for (const [label, url] of [
  ["support URL", visual.supportUrl],
  ["privacy policy URL", PRIVACY_POLICY_URL]
]) {
  if (typeof url !== "string" || !url.startsWith("https://")) {
    fail(`the ${label} must start with https://; found ${url}`);
  }
}
if (typeof author.name !== "string" || author.name.trim().length === 0) {
  fail("pbiviz.json author.name is required");
}
if (typeof author.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(author.email)) {
  fail(`pbiviz.json author.email must be a real contact address; found ${author.email}`);
}
if (typeof author.email === "string" && /(\.example|example\.|noreply|no-reply)/i.test(author.email)) {
  fail(`pbiviz.json author.email must not be a placeholder or noreply address; found ${author.email}`);
}

// --- Logo and icon ------------------------------------------------------------

const logo = checkPng(LOGO.path, {
  width: LOGO.width,
  height: LOGO.height,
  minColors: MIN_LOGO_COLORS,
  label: "Partner Center logo"
});

// The icon is the one brand mark that ships inside the .pbiviz, embedded as
// content.iconBase64, so a wrong path here means Power BI packages something
// other than the file this gate just inspected.
if (manifest.assets?.icon !== ICON.path) {
  fail(`pbiviz.json assets.icon must be ${ICON.path}; found ${manifest.assets?.icon}`);
}
const icon = checkPng(ICON.path, {
  width: ICON.width,
  height: ICON.height,
  label: "Visualization pane icon"
});

// --- Screenshots --------------------------------------------------------------

const screenshotDirectory = path.join(root, SCREENSHOTS.directory);
const screenshots = [];
if (!fs.existsSync(screenshotDirectory)) {
  fail(`${SCREENSHOTS.directory} is required but is missing`);
} else {
  const entries = fs.readdirSync(screenshotDirectory).sort();
  const files = entries.filter((file) => file.toLowerCase().endsWith(".png"));
  const stray = entries.filter((file) => !file.toLowerCase().endsWith(".png"));
  if (stray.length > 0) {
    fail(`${SCREENSHOTS.directory} must contain PNG screenshots only; found ${stray.join(", ")}`);
  }
  if (files.length < SCREENSHOTS.min || files.length > SCREENSHOTS.max) {
    fail(
      `${SCREENSHOTS.directory} must hold between ${SCREENSHOTS.min} and ${SCREENSHOTS.max} screenshots; found ${files.length}`
    );
  }
  for (const file of files) {
    const relativePath = `${SCREENSHOTS.directory}/${file}`;
    const metadata = checkPng(relativePath, {
      width: SCREENSHOTS.width,
      height: SCREENSHOTS.height,
      maxBytes: SCREENSHOTS.maxBytes,
      minColors: MIN_SCREENSHOT_COLORS,
      label: "Screenshot"
    });
    if (metadata) {
      screenshots.push({ path: relativePath, ...metadata });
    }
  }
}

// --- EULA and submission dossier ----------------------------------------------

requireText(EULA, "The AppSource EULA");
const dossier = requireText(DOSSIER, "The Partner Center submission dossier");
if (dossier) {
  for (const value of [
    SUPPORT_URL,
    PRIVACY_POLICY_URL,
    visual.guid,
    visual.version,
    EULA,
    LISTING_PRICING,
    SAMPLE_PROJECT
  ]) {
    if (typeof value === "string" && !dossier.includes(value)) {
      fail(`${DOSSIER} must record "${value}" so the submission form and the repository cannot drift`);
    }
  }
}

// Partner Center requires an offline sample report. The .pbix itself is produced
// by the owner in Power BI Desktop, but the project it is saved from lives here.
if (!fs.existsSync(path.join(root, SAMPLE_PROJECT))) {
  fail(`the offline sample report project is required but ${SAMPLE_PROJECT} is missing`);
}

// --- Report -------------------------------------------------------------------

if (failures.length > 0) {
  throw new Error(`Publication assets are not submission ready:\n  - ${failures.join("\n  - ")}`);
}

console.log(
  `Validated ${LOGO.path} ${logo.width}x${logo.height} ${logo.bytes} bytes ` +
    `${logo.distinctColors} distinct colours ${logo.sha256}`
);
console.log(
  `Validated ${ICON.path} ${icon.width}x${icon.height} ${icon.bytes} bytes ` +
    `${icon.distinctColors} distinct colours ${icon.sha256}`
);
for (const screenshot of screenshots) {
  console.log(
    `Validated ${screenshot.path} ${screenshot.width}x${screenshot.height} ${screenshot.bytes} bytes ${screenshot.sha256}`
  );
}
console.log(`Validated ${EULA}, ${DOSSIER}, support ${SUPPORT_URL}, privacy ${PRIVACY_POLICY_URL}`);
console.log(`Validated ${SAMPLE_PROJECT} and "${LISTING_PRICING}"`);
