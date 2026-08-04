const path = require("node:path");
const { readPngMetadata } = require("./read-png-metadata.cjs");

const root = path.resolve(__dirname, "..");
const partnerCenterLogoPath = path.join(root, "assets", "partner-center-logo.png");
const partnerCenterLogo = readPngMetadata(partnerCenterLogoPath);

if (partnerCenterLogo.width !== 300 || partnerCenterLogo.height !== 300) {
  throw new Error(
    `assets/partner-center-logo.png must be exactly 300x300; found ${partnerCenterLogo.width}x${partnerCenterLogo.height}`
  );
}

console.log(
  `Validated assets/partner-center-logo.png ${partnerCenterLogo.width}x${partnerCenterLogo.height} ${partnerCenterLogo.sha256}`
);
