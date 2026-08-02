const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

for (const relativePath of ["dist", ".tmp", "webpack.statistics.prod.html"]) {
  fs.rmSync(path.join(root, relativePath), { force: true, recursive: true });
}
