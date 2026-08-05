/*
 * The compiled visual as the screenshots actually see it.
 *
 * `pbiviz package` writes .tmp/drop/pbiviz.json, whose content.js and
 * content.css are the exact payload embedded in the .pbiviz. Those two strings
 * are everything that decides what the visual draws, so their hash is the
 * identity the submission screenshots depend on.
 *
 * The hash is deliberately taken over the compiled bundle rather than over the
 * packaged .pbiviz. The package additionally embeds the 20x20 icon as
 * content.iconBase64, and this repository has already shipped a release where
 * the icon changed and the package hash moved from a6b7a9f0... to d67b134d...
 * while every screenshot pixel stayed identical - the icon appears in no
 * screenshot. Keying the screenshots to the package hash would have demanded a
 * pointless re-capture there, and needless churn is how a gate earns a reflex
 * to bypass it. The bundle hash moves when, and only when, the code that draws
 * the scenes moves.
 *
 * Both the capture and the publication gate read the identity from here so the
 * two can never compute it differently; a second implementation of "the bundle
 * hash" would be its own defect.
 */
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const dropManifestPath = path.join(root, ".tmp", "drop", "pbiviz.json");

/**
 * Length-prefixed so the two payloads cannot be confused for one another. Plain
 * concatenation would let a byte moved from the end of the script to the front
 * of the stylesheet hash the same.
 */
const hashBundle = (js, css) =>
  crypto
    .createHash("sha256")
    .update(`js:${Buffer.byteLength(js)}\n`)
    .update(js)
    .update(`css:${Buffer.byteLength(css)}\n`)
    .update(css)
    .digest("hex")
    .toUpperCase();

const readVisualBundle = () => {
  if (!fs.existsSync(dropManifestPath)) {
    throw new Error(
      `${path.relative(root, dropManifestPath).replace(/\\/g, "/")} is missing. Run "npm run package" first so the compiled visual is available.`
    );
  }
  const manifest = JSON.parse(fs.readFileSync(dropManifestPath, "utf8"));
  const js = manifest.content && manifest.content.js;
  const css = manifest.content && manifest.content.css;
  if (!js) {
    throw new Error(`${path.relative(root, dropManifestPath).replace(/\\/g, "/")} contains no compiled script`);
  }
  if (!css) {
    throw new Error(
      `${path.relative(root, dropManifestPath).replace(/\\/g, "/")} contains no compiled stylesheet; the visual would render unstyled`
    );
  }
  return {
    js,
    css,
    guid: manifest.visual.guid,
    version: manifest.visual.version,
    sha256: hashBundle(js, css)
  };
};

module.exports = { readVisualBundle, hashBundle };
