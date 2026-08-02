const fs = require("node:fs");
const path = require("node:path");
const JSZip = require("jszip");

const root = path.resolve(__dirname, "..");
const packageFiles = fs
  .readdirSync(path.join(root, "dist"))
  .filter((file) => file.endsWith(".pbiviz"));

if (packageFiles.length !== 1) {
  throw new Error(`expected exactly one package to normalize, found ${packageFiles.length}`);
}

const packagePath = path.join(root, "dist", packageFiles[0]);
const fixedDate = new Date("1980-01-01T00:00:00.000Z");
const compressionOptions = { level: 9 };

async function normalizePackage() {
  const source = await fs.promises.readFile(packagePath);
  const sourceZip = await JSZip.loadAsync(source);
  const entries = [];

  sourceZip.forEach((name, entry) => {
    entries.push({ entry, name });
  });
  entries.sort((left, right) =>
    Buffer.compare(Buffer.from(left.name, "utf8"), Buffer.from(right.name, "utf8"))
  );

  const normalizedZip = new JSZip();
  for (const { entry, name } of entries) {
    normalizedZip.file(name, await entry.async("nodebuffer"), {
      date: fixedDate,
      dir: entry.dir,
      createFolders: false,
      compression: "DEFLATE",
      compressionOptions,
      dosPermissions: entry.dir ? 0x10 : 0,
    });
  }

  const normalized = await normalizedZip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions,
    platform: "DOS",
    streamFiles: false,
    comment: "",
  });
  const temporaryPath = path.join(
    path.dirname(packagePath),
    `${path.basename(packagePath)}.${process.pid}.${Date.now()}.tmp`
  );

  try {
    const handle = await fs.promises.open(temporaryPath, "wx");
    try {
      await handle.writeFile(normalized);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.promises.rename(temporaryPath, packagePath);
  } finally {
    await fs.promises.rm(temporaryPath, { force: true });
  }

  console.log(`Normalized ${packageFiles[0]} (${normalized.length} bytes)`);
}

normalizePackage().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
