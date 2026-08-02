const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const packageFiles = fs.readdirSync(path.join(root, "dist")).filter((file) => file.endsWith(".pbiviz"));

if (packageFiles.length !== 1) {
  throw new Error("expected exactly one .pbiviz package to normalize");
}

const packagePath = path.join(root, "dist", packageFiles[0]);
const archive = fs.readFileSync(packagePath);
const localHeader = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const centralHeader = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
const endOfCentralDirectory = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
const fixedTime = 0;
const fixedDate = 33;

let offset = 0;
while (offset < archive.length && archive.subarray(offset, offset + 4).equals(localHeader)) {
  archive.writeUInt16LE(fixedTime, offset + 10);
  archive.writeUInt16LE(fixedDate, offset + 12);
  const fileNameLength = archive.readUInt16LE(offset + 26);
  const extraLength = archive.readUInt16LE(offset + 28);
  const compressedSize = archive.readUInt32LE(offset + 18);
  offset += 30 + fileNameLength + extraLength + compressedSize;
}

const endOffset = archive.lastIndexOf(endOfCentralDirectory);
if (endOffset < 0) {
  throw new Error("missing ZIP end-of-central-directory record");
}

const centralOffset = archive.readUInt32LE(endOffset + 16);
const entryCount = archive.readUInt16LE(endOffset + 10);
offset = centralOffset;
for (let index = 0; index < entryCount; index += 1) {
  if (!archive.subarray(offset, offset + 4).equals(centralHeader)) {
    throw new Error(`invalid ZIP central-directory entry at offset ${offset}`);
  }
  archive.writeUInt16LE(fixedTime, offset + 12);
  archive.writeUInt16LE(fixedDate, offset + 14);
  const fileNameLength = archive.readUInt16LE(offset + 28);
  const extraLength = archive.readUInt16LE(offset + 30);
  const commentLength = archive.readUInt16LE(offset + 32);
  offset += 46 + fileNameLength + extraLength + commentLength;
}

fs.writeFileSync(packagePath, archive);
