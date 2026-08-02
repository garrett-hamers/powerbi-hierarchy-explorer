const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const npmExecPath = process.env.npm_execpath;
const packageCommand = npmExecPath
  ? [process.execPath, npmExecPath, "run", "package"]
  : [process.platform === "win32" ? "npm.cmd" : "npm", "run", "package"];
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "atlyn-hierarchy-repro-"));

function packageSnapshot() {
  const packageFiles = fs
    .readdirSync(path.join(root, "dist"))
    .filter((file) => file.endsWith(".pbiviz"));
  assert.equal(packageFiles.length, 1, "expected exactly one fresh .pbiviz package");

  const name = packageFiles[0];
  const bytes = fs.readFileSync(path.join(root, "dist", name));
  return {
    name,
    bytes,
    hash: crypto.createHash("sha256").update(bytes).digest("hex"),
  };
}

function runPackage() {
  const result = spawnSync(packageCommand[0], packageCommand.slice(1), {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  assert.equal(result.status, 0, "package command must succeed");
  return packageSnapshot();
}

try {
  const first = runPackage();
  const firstPath = path.join(temporaryDirectory, first.name);
  fs.writeFileSync(firstPath, first.bytes, { flag: "wx" });
  const second = runPackage();

  assert.equal(second.name, first.name, "reproducible packages must keep the exact filename");
  assert.deepEqual(
    second.bytes,
    fs.readFileSync(firstPath),
    "two clean package runs must produce identical PBIVIZ bytes"
  );
  assert.equal(second.hash, first.hash, "two clean package runs must produce the same SHA-256");
  console.log(`Reproducibility verified: ${second.name} (${second.bytes.length} bytes, SHA-256 ${second.hash})`);
} finally {
  fs.rmSync(temporaryDirectory, { force: true, recursive: true });
}
