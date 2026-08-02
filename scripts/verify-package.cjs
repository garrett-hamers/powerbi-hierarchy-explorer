const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

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
}

console.log(`Verified ${packageName} (${fs.statSync(packagePath).size} bytes)`);
