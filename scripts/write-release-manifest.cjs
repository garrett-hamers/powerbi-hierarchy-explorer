const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const packageFiles = fs.readdirSync(path.join(root, "dist")).filter((file) => file.endsWith(".pbiviz"));

if (packageFiles.length !== 1) {
  throw new Error("expected exactly one .pbiviz package for the release manifest");
}

const packageName = packageFiles[0];
const packagePath = path.join(root, "dist", packageName);
const packageBytes = fs.readFileSync(packagePath);
const sourceManifest = JSON.parse(fs.readFileSync(path.join(root, "pbiviz.json"), "utf8"));
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
  hashPolicy: "SHA-256 of the normalized .pbiviz ZIP; all local and central ZIP entry timestamps are fixed to 1980-01-01T00:00:00Z."
};

fs.writeFileSync(
  path.join(root, "dist", "release-manifest.json"),
  `${JSON.stringify(releaseManifest, null, 2)}\n`
);
console.log(`${releaseManifest.package} ${releaseManifest.sha256}`);
