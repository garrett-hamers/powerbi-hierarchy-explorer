/*
 * Deterministic gate for everything Microsoft requires in an AppSource /
 * Partner Center submission for a Power BI custom visual.
 *
 * Requirements enforced here (docs/partner-center-submission.md holds the
 * filled-in submission form values):
 *   - pbiviz.json carries name, display name, GUID, a four-part version,
 *     description, support URL, author name and author email
 *   - the Partner Center logo is a real 300x300 PNG
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

// A single flat rectangle is what a fabricated placeholder looks like; genuine
// artwork always clears these thresholds. Screenshots contain antialiased text,
// so they sit far above the logo's flat two-colour brand mark.
const MIN_LOGO_COLORS = 2;
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
  if (metadata.distinctColors < minColors) {
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

// --- Logo ---------------------------------------------------------------------

const logo = checkPng(LOGO.path, {
  width: LOGO.width,
  height: LOGO.height,
  minColors: MIN_LOGO_COLORS,
  label: "Partner Center logo"
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

console.log(`Validated ${LOGO.path} ${logo.width}x${logo.height} ${logo.sha256}`);
for (const screenshot of screenshots) {
  console.log(
    `Validated ${screenshot.path} ${screenshot.width}x${screenshot.height} ${screenshot.bytes} bytes ${screenshot.sha256}`
  );
}
console.log(`Validated ${EULA}, ${DOSSIER}, support ${SUPPORT_URL}, privacy ${PRIVACY_POLICY_URL}`);
console.log(`Validated ${SAMPLE_PROJECT} and "${LISTING_PRICING}"`);
