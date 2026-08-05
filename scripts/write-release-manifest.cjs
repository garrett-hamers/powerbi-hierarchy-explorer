const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { readPngMetadata } = require("./read-png-metadata.cjs");

// The privacy policy is a Partner Center form value rather than a pbiviz field,
// so the validator owns it and the manifest records what was submitted.
const PRIVACY_POLICY_URL = "https://atlyn.io/legal/privacy";

const root = path.resolve(__dirname, "..");
const packageFiles = fs.readdirSync(path.join(root, "dist")).filter((file) => file.endsWith(".pbiviz"));

if (packageFiles.length !== 1) {
  throw new Error("expected exactly one .pbiviz package for the release manifest");
}

const packageName = packageFiles[0];
const packagePath = path.join(root, "dist", packageName);
const packageBytes = fs.readFileSync(packagePath);
const sourceManifest = JSON.parse(fs.readFileSync(path.join(root, "pbiviz.json"), "utf8"));
const screenshotDirectory = path.join(root, "assets", "screenshots");
const captureRecord = JSON.parse(
  fs.readFileSync(path.join(root, "assets", "screenshot-capture.json"), "utf8")
);
const capturedScenes = new Map(captureRecord.scenes.map((scene) => [scene.path, scene]));
const screenshots = fs
  .readdirSync(screenshotDirectory)
  .filter((file) => file.toLowerCase().endsWith(".png"))
  .sort()
  .map((file) => {
    const relativePath = `assets/screenshots/${file}`;
    const metadata = readPngMetadata(path.join(screenshotDirectory, file));
    const scene = capturedScenes.get(relativePath);
    // validate-publication-assets has already compared these, and package runs
    // it first. Repeating the comparison here keeps the manifest from ever
    // recording a hash that disagrees with the capture it claims to carry -
    // recording without asserting is how a wrong value survives a build.
    if (!scene) {
      throw new Error(`${relativePath} has no entry in assets/screenshot-capture.json`);
    }
    if (scene.sha256 !== metadata.sha256) {
      throw new Error(
        `${relativePath} is ${metadata.sha256} but was captured as ${scene.sha256}; re-run "npm run screenshots"`
      );
    }
    return { path: relativePath, ...metadata, capture: { id: scene.id, asserted: scene.asserted } };
  });
let sourceCommit = process.env.GITHUB_SHA;
if (!sourceCommit) {
  sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
}

const releaseManifest = {
  package: packageName,
  bytes: packageBytes.length,
  sha256: crypto.createHash("sha256").update(packageBytes).digest("hex").toUpperCase(),
  sourceCommit,
  visualGuid: sourceManifest.visual.guid,
  visualVersion: sourceManifest.visual.version,
  supportUrl: sourceManifest.visual.supportUrl,
  privacyPolicyUrl: PRIVACY_POLICY_URL,
  authorEmail: sourceManifest.author.email,
  publicationAssets: {
    partnerCenterLogo: {
      path: "assets/partner-center-logo.png",
      ...readPngMetadata(path.join(root, "assets", "partner-center-logo.png"))
    },
    // The one brand mark that ships inside the package, embedded as
    // content.iconBase64, so its hash is part of the packaged bytes.
    icon: {
      path: "assets/icon.png",
      ...readPngMetadata(path.join(root, "assets", "icon.png"))
    },
    // Each screenshot carries the measurements its scene was accepted on and
    // the hash of the bytes those assertions were applied to. The hash pins
    // committed bytes; it is not a golden image and must never be turned into
    // a re-render comparison. Renders are not bit-stable - two captures of one
    // commit on one machine differ by a few pixels at a single channel value,
    // and the Linux runner produces PNGs some 45% larger - so an image
    // comparison would fail for reasons unrelated to correctness, while a hash
    // still catches a file edited or swapped after capture.
    screenshots,
    screenshotCapture: captureRecord.capturedWith,
    eula: "EULA.md",
    submissionDossier: "docs/partner-center-submission.md"
  },
  hashPolicy:
    "SHA-256 of the normalized .pbiviz ZIP; entries are sorted and use fixed timestamps, DOS permissions, DOS platform, and DEFLATE level 9."
};

fs.writeFileSync(
  path.join(root, "dist", "release-manifest.json"),
  `${JSON.stringify(releaseManifest, null, 2)}\n`
);
console.log(`${releaseManifest.package} ${releaseManifest.sha256}`);
