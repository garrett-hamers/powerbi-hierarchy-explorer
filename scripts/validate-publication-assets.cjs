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
 *     1024 KB, and each still byte-identical to what the capture recorded
 *     asserting it
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
  record: "assets/screenshot-capture.json",
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

// Catastrophic-blankness detector, NOT a quality gate. Read this before changing
// the number.
//
// A screenshot's colour count tracks what the scene contains, so it cannot
// separate a correct render from a wrong-but-plausible one. Across this
// portfolio the correct renders span 261 (funnel, whose flat design is meant to
// be that sparse) to 3,101 (scatter, which plots many coloured points), and one
// sibling's entirely correct captures are ~95-97% white by pixel share. No
// single threshold sorts good from bad across that range.
//
// 64 is therefore set far below every one of those minima on purpose. All it can
// catch is a capture that is essentially blank - a harness that rendered nothing,
// a viewport that never painted - which is a failure mode no amount of design
// variation produces.
//
// So: never calibrate this against the screenshots in THIS repository. They
// currently sit at 771-923 colours, which makes 64 look uselessly slack and
// invites "tightening" it to something like 500 - a change that would reject a
// sibling's correct 261-colour renders outright. Raising it toward local numbers
// converts a safe liveness check into exactly the kind of false-positive gate
// that shipping-a-flat-logo taught us to avoid, only in the other direction.
//
// What actually verifies screenshot content is the capture harness, which
// asserts per-scene expectations at capture time while the DOM and scenario
// state are still available, and hard-fails before writing a PNG. Those
// assertions are pinned to the committed bytes through
// assets/screenshot-capture.json, which this script re-checks below. That is the
// strongest check available for browser-rendered assets, which - unlike the
// deterministically generated brand marks above - cannot be re-rendered and
// pixel-diffed because font rasterisation and browser version vary by machine.
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

/*
 * The capture record is what makes a screenshot re-checkable after the fact.
 *
 * The assertions that gate `npm run screenshots` are strong but ephemeral: they
 * prove a scene rendered at the instant its PNG was written, print, and are
 * gone. A screenshot edited, reverted or swapped afterwards satisfies every
 * other check here - it is still a 1366x768 PNG under the byte cap - so without
 * this comparison the repository would record an assertion it could never
 * re-verify.
 *
 * This is a hash comparison against the bytes the capture published, not a
 * re-render. It must never become one. Two captures of the same commit on the
 * same machine differ by a handful of pixels at a single channel value, and the
 * Linux runner produces PNGs some 45% larger from the same source, so a golden
 * image or pixel diff would fail for reasons unrelated to correctness. What is
 * asserted is only that the committed file is still the file the scene
 * assertions were applied to.
 */
const captureRecordPath = path.join(root, SCREENSHOTS.record);
let captureRecord = null;
if (!fs.existsSync(captureRecordPath)) {
  fail(
    `${SCREENSHOTS.record} is required so the committed screenshots can be checked against the capture that asserted them; run "npm run screenshots"`
  );
} else {
  try {
    captureRecord = JSON.parse(fs.readFileSync(captureRecordPath, "utf8"));
  } catch (error) {
    fail(`${SCREENSHOTS.record} is not readable JSON: ${error.message}`);
  }
}

if (captureRecord) {
  const scenes = Array.isArray(captureRecord.scenes) ? captureRecord.scenes : [];
  if (scenes.length === 0) {
    fail(`${SCREENSHOTS.record} records no scenes`);
  }
  if (captureRecord.capturedWith?.viewport !== `${SCREENSHOTS.width}x${SCREENSHOTS.height}`) {
    fail(
      `${SCREENSHOTS.record} was captured at viewport ${captureRecord.capturedWith?.viewport}; the submission requires ${SCREENSHOTS.width}x${SCREENSHOTS.height}`
    );
  }
  if (captureRecord.capturedWith?.visualVersion !== visual.version) {
    fail(
      `${SCREENSHOTS.record} was captured from version ${captureRecord.capturedWith?.visualVersion} but pbiviz.json declares ${visual.version}; re-capture so the listing shows what ships`
    );
  }

  const committed = new Map(screenshots.map((screenshot) => [screenshot.path, screenshot]));
  for (const scene of scenes) {
    const screenshot = committed.get(scene.path);
    if (!screenshot) {
      fail(
        `${SCREENSHOTS.record} records ${scene.id} at ${scene.path}, but that file is not committed; a scene whose capture failed leaves its image deleted on purpose`
      );
      continue;
    }
    committed.delete(scene.path);
    if (screenshot.sha256 !== scene.sha256) {
      fail(
        `${scene.path} has changed since it was captured: recorded ${scene.sha256} (${scene.bytes} bytes), committed ${screenshot.sha256} (${screenshot.bytes} bytes). ` +
          `Its content assertions no longer apply to these bytes; re-run "npm run screenshots".`
      );
    }
    // Guards a record written from a degenerate render. The per-scene
    // expectations live with the scenes in the harness and are not repeated
    // here; this only refuses evidence that asserts nothing.
    const asserted = scene.asserted ?? {};
    if (!(asserted.cards > 0) || !(asserted.visual?.width > 0) || !(asserted.visual?.height > 0)) {
      fail(
        `${SCREENSHOTS.record} records no usable evidence for ${scene.id}: ${JSON.stringify(asserted)}`
      );
    }
  }
  for (const orphan of committed.keys()) {
    fail(`${orphan} is committed but no scene in ${SCREENSHOTS.record} accounts for it`);
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
  const scene = (captureRecord?.scenes ?? []).find((entry) => entry.path === screenshot.path);
  console.log(
    `Validated ${screenshot.path} ${screenshot.width}x${screenshot.height} ${screenshot.bytes} bytes ${screenshot.sha256}` +
      (scene
        ? ` - unchanged since capture asserted ${scene.asserted.cards} cards, ${scene.asserted.edges} connectors, ` +
          `${scene.asserted.search.matches} search matches, ${scene.asserted.diagnostics.lines} diagnostics`
        : "")
  );
}
console.log(`Validated ${EULA}, ${DOSSIER}, support ${SUPPORT_URL}, privacy ${PRIVACY_POLICY_URL}`);
console.log(`Validated ${SAMPLE_PROJECT} and "${LISTING_PRICING}"`);
