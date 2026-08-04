// Jest cannot parse LESS; src/visual.ts imports the stylesheet so webpack ships
// it inside the package. Unit tests only need the import to resolve.
module.exports = {};
