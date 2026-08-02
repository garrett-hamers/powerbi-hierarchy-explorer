const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const readJson = (relativePath) => JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
const sourceManifest = readJson("pbiviz.json");
const generatedManifest = readJson(".tmp/drop/pbiviz.json");
const sourceCapabilities = readJson("capabilities.json");
const sourceDependencies = readJson("dependencies.json");
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

console.log(`Verified ${packageName} (${fs.statSync(packagePath).size} bytes)`);
