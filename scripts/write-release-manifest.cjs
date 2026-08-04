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
const screenshots = fs
  .readdirSync(screenshotDirectory)
  .filter((file) => file.toLowerCase().endsWith(".png"))
  .sort()
  .map((file) => ({
    path: `assets/screenshots/${file}`,
    ...readPngMetadata(path.join(screenshotDirectory, file))
  }));
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
    // Screenshot bytes are not reproducible across machines because font
    // rasterisation differs, so these hashes record provenance only; the
    // enforced contract is dimensions, byte ceiling and PNG structure.
    screenshots,
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
