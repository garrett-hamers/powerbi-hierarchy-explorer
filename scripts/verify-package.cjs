const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const JSZip = require("jszip");
const { readVisualBundle } = require("./read-visual-bundle.cjs");

const root = path.resolve(__dirname, "..");
const readJson = (relativePath) => JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
const sourceManifest = readJson("pbiviz.json");
const generatedManifest = readJson(".tmp/drop/pbiviz.json");
const sourceCapabilities = readJson("capabilities.json");
const sourceDependencies = readJson("dependencies.json");
const releaseManifestPath = path.join(root, "dist", "release-manifest.json");
const generatedPackageFiles = fs
  .readdirSync(path.join(root, "dist"))
  .filter((file) => file.endsWith(".pbiviz"));

assert.equal(generatedPackageFiles.length, 1, "expected exactly one fresh .pbiviz package");
const packageName = generatedPackageFiles[0];
const packagePath = path.join(root, "dist", packageName);
const expectedName = `${sourceManifest.visual.guid}.${sourceManifest.visual.version}.pbiviz`;
assert.equal(packageName, expectedName, "package filename must match stable visual metadata");
assert.deepEqual(generatedManifest.visual, {
  ...sourceManifest.visual,
  gitHubUrl: sourceManifest.visual.gitHubUrl
});
assert.deepEqual(generatedManifest.author, sourceManifest.author);
assert.equal(generatedManifest.apiVersion, sourceManifest.apiVersion);
assert.deepEqual(generatedManifest.capabilities, sourceCapabilities);
assert.deepEqual(generatedManifest.dependencies, sourceDependencies);
assert.equal(Buffer.from(fs.readFileSync(packagePath).subarray(0, 4)).toString("binary"), "PK\u0003\u0004");

const status = fs.readFileSync(path.join(root, ".tmp/drop/status"), "utf8").trim().split(/\r?\n/);
assert.equal(status[1], sourceManifest.visual.guid, "staging status must match the packaged visual");

const archive = fs.readFileSync(packagePath);
const localHeader = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const centralHeader = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
const endOfCentralDirectory = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
let offset = 0;
while (offset < archive.length && archive.subarray(offset, offset + 4).equals(localHeader)) {
  assert.equal(archive.readUInt16LE(offset + 10), 0, "local ZIP timestamps must be normalized");
  assert.equal(archive.readUInt16LE(offset + 12), 33, "local ZIP dates must be normalized");
  const fileNameLength = archive.readUInt16LE(offset + 26);
  const extraLength = archive.readUInt16LE(offset + 28);
  const compressedSize = archive.readUInt32LE(offset + 18);
  offset += 30 + fileNameLength + extraLength + compressedSize;
}
const endOffset = archive.lastIndexOf(endOfCentralDirectory);
assert.notEqual(endOffset, -1, "package must contain a ZIP end-of-central-directory record");
const centralOffset = archive.readUInt32LE(endOffset + 16);
const entryCount = archive.readUInt16LE(endOffset + 10);
offset = centralOffset;
for (let index = 0; index < entryCount; index += 1) {
  assert.ok(archive.subarray(offset, offset + 4).equals(centralHeader), "invalid ZIP central-directory entry");
  assert.equal(archive.readUInt16LE(offset + 12), 0, "central ZIP timestamps must be normalized");
  assert.equal(archive.readUInt16LE(offset + 14), 33, "central ZIP dates must be normalized");
  const fileNameLength = archive.readUInt16LE(offset + 28);
  const extraLength = archive.readUInt16LE(offset + 30);
  const commentLength = archive.readUInt16LE(offset + 32);
  offset += 46 + fileNameLength + extraLength + commentLength;
}
if (fs.existsSync(releaseManifestPath)) {
  const releaseManifest = readJson("dist/release-manifest.json");
  assert.equal(releaseManifest.package, packageName);
  assert.equal(releaseManifest.bytes, archive.length);
  assert.equal(
    releaseManifest.sha256,
    crypto.createHash("sha256").update(archive).digest("hex").toUpperCase()
  );
  assert.equal(releaseManifest.visualGuid, sourceManifest.visual.guid);
  assert.equal(releaseManifest.visualVersion, sourceManifest.visual.version);
  assert.equal(releaseManifest.supportUrl, sourceManifest.visual.supportUrl);
  assert.equal(releaseManifest.authorEmail, sourceManifest.author.email);
  assert.match(releaseManifest.privacyPolicyUrl, /^https:\/\//);
  assert.equal(releaseManifest.publicationAssets.partnerCenterLogo.path, "assets/partner-center-logo.png");
  assert.equal(releaseManifest.publicationAssets.partnerCenterLogo.width, 300);
  assert.equal(releaseManifest.publicationAssets.partnerCenterLogo.height, 300);
  assert.equal(releaseManifest.publicationAssets.icon.path, sourceManifest.assets.icon);
  assert.equal(releaseManifest.publicationAssets.icon.width, 20);
  assert.equal(releaseManifest.publicationAssets.icon.height, 20);
  assert.equal(releaseManifest.publicationAssets.eula, "EULA.md");
  assert.equal(
    releaseManifest.publicationAssets.submissionDossier,
    "docs/partner-center-submission.md"
  );

  const screenshots = releaseManifest.publicationAssets.screenshots;
  assert.ok(
    Array.isArray(screenshots) && screenshots.length >= 1 && screenshots.length <= 5,
    "the release manifest must record between 1 and 5 Partner Center screenshots"
  );
  const captureRecord = readJson("assets/screenshot-capture.json");
  const capturedScenes = new Map(captureRecord.scenes.map((scene) => [scene.path, scene]));
  for (const screenshot of screenshots) {
    assert.match(screenshot.path, /^assets\/screenshots\/.+\.png$/);
    assert.equal(screenshot.width, 1366, `${screenshot.path} must be 1366 wide`);
    assert.equal(screenshot.height, 768, `${screenshot.path} must be 768 tall`);
    assert.ok(
      screenshot.bytes <= 1024 * 1024,
      `${screenshot.path} must stay within the 1024 KB Partner Center limit`
    );

    // The manifest carries the capture's evidence, so it must agree with the
    // capture record rather than quietly restate a hash of whatever happens to
    // be on disk. A recorded value nothing compares is how a wrong one survives.
    const scene = capturedScenes.get(screenshot.path);
    assert.ok(scene, `${screenshot.path} has no entry in assets/screenshot-capture.json`);
    assert.equal(
      screenshot.sha256,
      scene.sha256,
      `${screenshot.path} does not hash to the bytes its scene assertions were applied to`
    );
    assert.deepEqual(
      screenshot.capture?.asserted,
      scene.asserted,
      `${screenshot.path} must carry the measurements its scene was accepted on`
    );
    assert.ok(
      screenshot.capture.asserted.cards > 0,
      `${screenshot.path} was recorded with no rendered nodes`
    );
  }
  assert.equal(
    releaseManifest.publicationAssets.screenshotCapture.visualVersion,
    sourceManifest.visual.version,
    "the screenshots must have been captured from the version being released"
  );
  // The version is a hand-written string that has already covered more than one
  // package in this repository, so the compiled bundle is what actually ties
  // the screenshots to a build.
  assert.equal(
    releaseManifest.publicationAssets.screenshotCapture.bundleSha256,
    readVisualBundle().sha256,
    "the screenshots must have been captured from the compiled visual being released"
  );
}

// A visual whose compiled stylesheet is missing renders unstyled in the host,
// so the packaged CSS payload is part of the release contract.
const packagedResources = JSON.parse(
  fs.readFileSync(path.join(root, ".tmp/drop/pbiviz.json"), "utf8")
);
assert.ok(
  typeof packagedResources.content?.css === "string" && packagedResources.content.css.includes(".atlyn-root"),
  "the packaged bundle must embed the compiled stylesheet"
);
assert.ok(
  typeof packagedResources.content?.js === "string" && packagedResources.content.js.length > 0,
  "the packaged bundle must embed the compiled script"
);

// The sample report embeds a copy of this very package as a private custom
// visual. If that copy drifts, the sample would demo a different build than the
// one being submitted, so compare it against the archive just produced.
const sampleVisualDirectory = path.join(
  root,
  "samples",
  "AtlynHierarchyExplorerSample.Report",
  "CustomVisuals",
  sourceManifest.visual.guid
);
if (fs.existsSync(sampleVisualDirectory)) {
  const embeddedEntries = ["package.json", `resources/${sourceManifest.visual.guid}.pbiviz.json`];
  JSZip.loadAsync(archive)
    .then(async (zip) => {
      for (const entry of embeddedEntries) {
        const packaged = await zip.file(entry)?.async("nodebuffer");
        assert.ok(packaged, `the package must contain ${entry}`);
        const committed = fs.readFileSync(path.join(sampleVisualDirectory, ...entry.split("/")));
        assert.ok(
          packaged.equals(committed),
          `samples/.../CustomVisuals/${sourceManifest.visual.guid}/${entry} is stale; run "npm run sample-report"`
        );
      }
      console.log(`Verified the sample report embeds the current ${packageName}`);
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}

console.log(`Verified ${packageName} (${fs.statSync(packagePath).size} bytes)`);
