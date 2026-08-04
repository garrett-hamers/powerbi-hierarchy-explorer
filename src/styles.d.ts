/**
 * The packaged bundle only receives the stylesheet when it is imported from the
 * visual entry point; the legacy `style` field in pbiviz.json is not enough for
 * the webpack build in powerbi-visuals-tools 7.x. This declaration lets the
 * import typecheck without pulling in a loader-specific type package.
 */
declare module "*.less";
