/*
 * Layout containment probe for the packaged visual.
 *
 * A Power BI custom visual renders inside a host tile with overflow: hidden.
 * Anything laid out beyond that tile is not scrolled to and not scrollbarred -
 * it is silently discarded, and nothing on screen says so. This script loads
 * the packaged bundle in real headless Chromium, measures every element's
 * getBoundingClientRect against the box that actually clips it, and reports
 * what the tile would eat.
 *
 * Three choices are deliberate:
 *
 *  - It reads content.js and content.css back out of dist/*.pbiviz rather than
 *    from the source tree or the staging drop. The archive is what the host
 *    runs, and defects have lived in the gap between compiled and packaged
 *    bytes before.
 *
 *  - The tile fills the browser viewport, so width-based media queries in the
 *    packaged stylesheet resolve against the tile, exactly as they do inside
 *    the per-visual iframe a real host creates. Probing a small tile inside a
 *    large window would silently probe the wrong stylesheet branch.
 *
 *  - Every scrollable region is actually scrolled - top, middle and maximum -
 *    and the full escape walk runs again at each offset. A scroll container
 *    that is detected but never scrolled turns every scroll-time assertion
 *    into dead weight.
 *
 * Playwright is not a dependency of this package, for the same reason it is not
 * one for the screenshot capture: it would enlarge the audited dependency
 * surface of a certification submission. Install it to run the probe:
 *
 *   npm install --no-save playwright
 *   npx playwright install chromium
 *   npm run package
 *   npm run probe-layout
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { pathToFileURL } = require("node:url");
const JSZip = require("jszip");

const rules = require("./layout-probe/rules.cjs");

const root = path.resolve(__dirname, "..");
const harnessDirectory = path.join(__dirname, "layout-probe", "harness");
const expectations = JSON.parse(fs.readFileSync(path.join(__dirname, "layout-probe", "expected-regions.json"), "utf8"));
const reportPath = path.join(root, ".tmp", "layout-probe", "report.json");

const TILES = [
  { name: "1280x620", width: 1280, height: 620 },
  { name: "398x298", width: 398, height: 298 },
  { name: "258x198", width: 258, height: 198 },
  { name: "178x138", width: 178, height: 138 },
  { name: "80x80", width: 80, height: 80 }
];

/*
 * Expansion state changes content height, which is what makes a scroll
 * container appear or overflow, so each state is a different layout problem
 * rather than the same one with different data.
 */
const STATES = [
  { id: "expanded", label: "fully expanded", fixture: "org", locale: "en-US", collapse: [] },
  { id: "partial", label: "partially expanded", fixture: "org", locale: "en-US", collapse: ["na-ent", "emea"] },
  { id: "collapsed", label: "fully collapsed", fixture: "org", locale: "en-US", collapse: "all" },
  { id: "tree-focused", label: "accessible tree focused", fixture: "org", locale: "en-US", collapse: [], focusTree: true },
  { id: "long-labels", label: "long labels", fixture: "longLabels", locale: "en-US", collapse: [] },
  { id: "rtl", label: "RTL (ar-SA)", fixture: "arabicLabels", locale: "ar-SA", collapse: [] },
  { id: "rtl-latin", label: "RTL (ar-SA) with Latin labels", fixture: "org", locale: "ar-SA", collapse: [] },
  /*
   * The diagnostics strip is display:none until the data has something wrong
   * with it, so a probe fed clean data never lays it out at all. These two
   * states are where the chrome and the chart compete for a short tile: every
   * strip present at once, and then the accessible tree pane on top of them.
   */
  { id: "diagnostics", label: "diagnostics present", fixture: "diagnostics", locale: "en-US", collapse: [] },
  {
    id: "diagnostics-tree-focused",
    label: "diagnostics present, accessible tree focused",
    fixture: "diagnostics",
    locale: "en-US",
    collapse: [],
    focusTree: true
  }
];

/*
 * "natural" is whatever offset the browser itself settled on after the state
 * was applied - which is where a focus-driven scroll shows up. The other three
 * force every scrollable region to an offset and re-run the whole walk, because
 * a scroll container that is detected but never scrolled turns every
 * scroll-time assertion into dead weight.
 */
const SCROLL_OFFSETS = ["natural", "top", "middle", "max"];

const loadPlaywright = () => {
  try {
    return require("playwright");
  } catch {
    throw new Error(
      [
        "Playwright is not installed, so the layout probe cannot run.",
        "It is intentionally not a dependency of this package.",
        "To run the probe:",
        "  npm install --no-save playwright",
        "  npx playwright install chromium",
        "  npm run package",
        "  npm run probe-layout"
      ].join("\n")
    );
  }
};

/**
 * Prefers Playwright's own Chromium and falls back to an installed Chrome or
 * Edge. If none of them launch this throws: a probe that skips when it cannot
 * find a browser reports success for a run in which it measured nothing.
 */
const launchBrowser = async (playwright) => {
  const attempts = [undefined, "chromium", "msedge", "chrome"];
  const failures = [];
  for (const channel of attempts) {
    try {
      const browser = await playwright.chromium.launch(channel ? { channel } : {});
      return { browser, channel: channel ?? "playwright-chromium" };
    } catch (error) {
      failures.push(`${channel ?? "bundled"}: ${error.message.split("\n")[0]}`);
    }
  }
  throw new Error(`no Chromium build could be launched, so nothing was measured.\n${failures.join("\n")}`);
};

/**
 * The packaged artifact, not the source tree and not the staging drop.
 */
const readPackagedBundle = async () => {
  const distDirectory = path.join(root, "dist");
  if (!fs.existsSync(distDirectory)) {
    throw new Error('dist/ is missing. Run "npm run package" first so there is a packaged artifact to probe.');
  }
  const packages = fs.readdirSync(distDirectory).filter((file) => file.endsWith(".pbiviz"));
  if (packages.length !== 1) {
    throw new Error(`expected exactly one .pbiviz in dist/, found ${packages.length}`);
  }
  const packagePath = path.join(distDirectory, packages[0]);
  const bytes = fs.readFileSync(packagePath);
  const archive = await JSZip.loadAsync(bytes);
  const manifestEntry = archive.file("package.json");
  if (!manifestEntry) {
    throw new Error(`${packages[0]} contains no package.json`);
  }
  const manifest = JSON.parse(await manifestEntry.async("string"));
  const resource = (manifest.resources || []).find((entry) => entry.file && entry.file.endsWith(".pbiviz.json"));
  if (!resource) {
    throw new Error(`${packages[0]} declares no pbiviz.json resource`);
  }
  const resourceEntry = archive.file(resource.file);
  if (!resourceEntry) {
    throw new Error(`${packages[0]} is missing the declared resource ${resource.file}`);
  }
  const drop = JSON.parse(await resourceEntry.async("string"));
  const js = drop.content && drop.content.js;
  const css = drop.content && drop.content.css;
  if (!js) {
    throw new Error(`${resource.file} inside ${packages[0]} carries no compiled script`);
  }
  if (!css) {
    throw new Error(
      `${resource.file} inside ${packages[0]} carries no compiled stylesheet, so the visual would render unstyled`
    );
  }
  return {
    name: packages[0],
    bytes: bytes.length,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    guid: drop.visual.guid,
    version: drop.visual.version,
    js,
    css
  };
};

/* Everything in the flex column that is not the drawing area. */
const CHROME_LABELS = ["toolbar", "status strip", "breadcrumb", "diagnostics", "accessible tree"];

const evaluateCase = (measurement, context) => {  const violations = [];
  const canvas = measurement.regions.find((region) => region.label === "drawing canvas");
  const expectedForDensity = expectations.byDensity[measurement.density];
  if (!expectedForDensity) {
    throw new Error(
      `the visual reported density "${measurement.density}", which scripts/layout-probe/expected-regions.json ` +
        "says nothing about, so this case would be measured against no expectations at all"
    );
  }
  violations.push(...rules.checkRootWithinTile(measurement));
  violations.push(...rules.findEscapes(measurement.elements));
  violations.push(...rules.checkScreenReaderRegions(measurement.screenReaderRegions, measurement.tile));
  violations.push(...rules.checkTextWithinOwner(measurement.textPairs));
  /*
   * Only at the offset the browser itself chose. Once the probe has forced a
   * scroll container to its maximum, the focused row being off screen is what
   * scrolling means, not a defect - and a rule that fires there would drown the
   * real finding, which is a focused row clipped where nobody scrolled at all.
   */
  if (context.offset === "natural") {
    violations.push(...rules.checkFocusWithinTile(measurement.focus, measurement.tile));
    violations.push(...rules.checkFocusFullyVisible(measurement.focus));
  }
  violations.push(
    ...rules.checkScrollRegions(measurement.scrollRegions, {
      expected: expectedForDensity.scrollRegions,
      mustOverflow: expectedForDensity.mustOverflow
    })
  );
  violations.push(...rules.checkStickyStacking(measurement.sticky));
  violations.push(...rules.checkHiddenScroll(measurement.hiddenScrollRegions));
  violations.push(
    ...rules.checkDeclaredCounts(
      { sticky: measurement.counts.sticky, fixed: measurement.counts.fixed },
      expectations.counts
    )
  );
  if (canvas) {
    violations.push(
      ...rules.checkMinimumSizes([
        {
          path: canvas.path,
          label: "the drawing canvas",
          width: canvas.clientWidth,
          height: canvas.clientHeight,
          minWidth: expectations.minimumSizes.canvasWidth,
          minHeight: expectations.minimumSizes.canvasHeight
        }
      ])
    );
    violations.push(
      ...rules.checkChromeOutlivesChart({
        chart: { path: canvas.path, height: canvas.clientHeight },
        minimumChartHeight: expectations.minimumSizes.canvasHeight,
        chrome: measurement.regions
          .filter((region) => CHROME_LABELS.includes(region.label))
          .map((region) => ({ path: region.path, label: region.label, height: region.height }))
      })
    );
  }
  violations.push(
    ...rules.checkChartVisibility(measurement.chart, {
      minimumVisibleHeight: Math.min(
        expectations.minimumSizes.visibleChartHeight,
        Math.floor(measurement.tile.height * expectations.minimumSizes.visibleChartFractionOfTile)
      )
    })
  );
  return violations.map((item) => Object.assign({}, item, context));
};

const describeCase = (tile, state, offset) => `${tile.name} / ${state.id} / scroll:${offset}`;

const runCase = async (page, tile, state) => {
  await page.setViewportSize({ width: tile.width, height: tile.height });
  await page.evaluate(
    (settings) => window.__probeMount(settings),
    { fixture: state.fixture, locale: state.locale }
  );
  if (state.collapse === "all") {
    await page.evaluate(() => window.__probeCollapse(window.__probeFixtures.parents));
  } else if (Array.isArray(state.collapse) && state.collapse.length > 0) {
    await page.evaluate((ids) => window.__probeCollapse(ids), state.collapse);
  }
  if (state.focusTree) {
    await page.evaluate(() => window.__probeFocusTree());
  }

  const results = [];
  for (const offset of SCROLL_OFFSETS) {
    const scrolled =
      offset === "natural" ? [] : await page.evaluate((where) => window.__probeScrollAll(where), offset);
    const measurement = await page.evaluate(() => window.__probeMeasure());
    if (!measurement.styled) {
      throw new Error(
        `${describeCase(tile, state, offset)}: the packaged stylesheet did not apply, so nothing measured here means anything`
      );
    }
    results.push({
      tile: tile.name,
      state: state.id,
      stateLabel: state.label,
      offset,
      scrolled,
      measurement,
      violations: evaluateCase(measurement, {
        case: describeCase(tile, state, offset),
        tile: tile.name,
        state: state.id,
        offset
      })
    });
  }
  return results;
};

/*
 * The state machinery dispatches double-click events instead of clicking,
 * because at small tiles a node card can sit far outside the canvas viewport.
 * This proves the two paths agree, at a tile where a native click is possible,
 * so the cheap path used everywhere else is not quietly testing a different
 * code path from the one a user drives.
 */
const verifyNativeInteractionMatches = async (page) => {
  await page.setViewportSize({ width: 1280, height: 620 });
  await page.evaluate(() => window.__probeMount({ fixture: "org", locale: "en-US" }));
  const before = await page.evaluate(() =>
    document.querySelector('[role="treeitem"][data-semantic-node-id="na-ent"]').getAttribute("aria-expanded")
  );
  await page.dblclick('.atlyn-node[data-node-id="na-ent"] .atlyn-node-card');
  const afterNative = await page.evaluate(() =>
    document.querySelector('[role="treeitem"][data-semantic-node-id="na-ent"]').getAttribute("aria-expanded")
  );
  await page.evaluate(() => window.__probeMount({ fixture: "org", locale: "en-US" }));
  await page.evaluate(() => window.__probeCollapse(["na-ent"]));
  const afterDispatched = await page.evaluate(() =>
    document.querySelector('[role="treeitem"][data-semantic-node-id="na-ent"]').getAttribute("aria-expanded")
  );
  if (before !== "true" || afterNative !== "false" || afterDispatched !== afterNative) {
    throw new Error(
      "the dispatched double click no longer matches a native one " +
        `(before=${before}, native=${afterNative}, dispatched=${afterDispatched}), ` +
        "so every collapsed and partially expanded case would be probing a state no user can reach"
    );
  }
  return { before, afterNative, afterDispatched };
};

const formatViolation = (item) => `    ${item.rule}: ${item.target}\n      ${item.detail}`;

/**
 * Measures every case and returns the raw results. Kept separate from main so
 * scripts/prove-layout-regressions.cjs can drive the same probe against a
 * deliberately broken build and read the violations back.
 */
const collectResults = async () => {
  const bundle = await readPackagedBundle();
  const playwright = loadPlaywright();
  const { browser, channel } = await launchBrowser(playwright);
  const results = [];
  let nativeCheck = null;
  try {
    const page = await browser.newPage({ viewport: { width: TILES[0].width, height: TILES[0].height } });
    page.on("pageerror", (error) => {
      throw new Error(`the packaged bundle threw during the probe: ${error.message}`);
    });
    await page.goto(pathToFileURL(path.join(harnessDirectory, "index.html")).href);
    await page.addStyleTag({ content: bundle.css });
    await page.addScriptTag({ content: bundle.js });
    nativeCheck = await verifyNativeInteractionMatches(page);
    for (const tile of TILES) {
      for (const state of STATES) {
        results.push(...(await runCase(page, tile, state)));
      }
    }
  } finally {
    await browser.close();
  }
  return { bundle, channel, results, nativeCheck };
};

const main = async () => {
  const { bundle, channel, results, nativeCheck } = await collectResults();

  const violations = results.flatMap((result) => result.violations);
  const summary = rules.summarize(violations);
  const triage = results[0].measurement;

  process.stdout.write(
    [
      `Probed ${bundle.name} (${bundle.bytes} bytes, sha256 ${bundle.sha256})`,
      `Browser: ${channel}`,
      `Root computed position: ${triage.rootPosition}`,
      `position: sticky elements: ${triage.counts.sticky}`,
      `position: fixed elements: ${triage.counts.fixed}`,
      `position: absolute elements: ${triage.counts.absolute}`,
      `Native double click matches the dispatched one: ${JSON.stringify(nativeCheck)}`,
      ""
    ].join("\n")
  );

  const failingCases = results.filter((result) => result.violations.length > 0);
  const worstFill = results.reduce(
    (worst, result) =>
      (result.measurement.textFit?.worstFill ?? 0) > worst.fill
        ? { fill: result.measurement.textFit.worstFill, path: result.measurement.textFit.worstFillPath }
        : worst,
    { fill: 0, path: null }
  );
  process.stdout.write(
    `Widest label fills ${(worstFill.fill * 100).toFixed(1)}% of the space its card reserves ` +
      `(${worstFill.path ?? "no labels drawn"}); the remainder is the headroom a wider font stack has.\n`
  );
  process.stdout.write(`Cases: ${results.length}, failing: ${failingCases.length}\n\n`);

  const byTile = new Map();
  results.forEach((result) => {
    const bucket = byTile.get(result.tile) || { cases: 0, failing: 0, violations: 0, worst: 0 };
    bucket.cases += 1;
    if (result.violations.length > 0) {
      bucket.failing += 1;
    }
    bucket.violations += result.violations.length;
    result.violations.forEach((item) => {
      bucket.worst = Math.max(bucket.worst, item.escape || 0);
    });
    byTile.set(result.tile, bucket);
  });
  process.stdout.write("Per tile size:\n");
  byTile.forEach((bucket, tile) => {
    process.stdout.write(
      `  ${tile.padEnd(9)} ${String(bucket.failing).padStart(2)}/${bucket.cases} cases failing, ` +
        `${String(bucket.violations).padStart(4)} violations, worst escape ${bucket.worst.toFixed(2)}px\n`
    );
  });
  process.stdout.write("\n");

  /*
   * The four numbers the chrome-versus-chart question turns on, reported
   * whether or not any rule fired. A table of measurements is the answer to
   * "does the chart survive"; a pass/fail is not.
   */
  const heightOf = (result, label) => {
    const region = result.measurement.regions.find((item) => item.label === label);
    return region ? region.height : null;
  };
  const format = (value) => (value === null ? "   -" : value.toFixed(0).padStart(4));
  const chromeCases = results.filter(
    (result) => result.offset === "natural" && result.state.startsWith("diagnostics")
  );
  if (chromeCases.length > 0) {
    process.stdout.write("Chrome versus chart, with diagnostics present (rendered heights, px):\n");
    process.stdout.write(
      "  tile      state                       graph  wrap  visible  scrolls?  tree toolbar diags  root.scrollTop\n"
    );
    chromeCases.forEach((result) => {
      const chart = result.measurement.chart;
      const rootScroll = (result.measurement.hiddenScrollRegions || []).find((item) =>
        item.path.endsWith("div.atlyn-root")
      );
      process.stdout.write(
        `  ${result.tile.padEnd(9)} ${result.state.padEnd(26)} ` +
          `${format(chart ? chart.graphHeight : null)} ${format(chart ? chart.viewportHeight : null)} ` +
          `${format(chart ? chart.visibleHeight : null)}    ` +
          `${(chart && chart.isScrollContainer ? "yes" : "no").padEnd(8)} ` +
          `${format(heightOf(result, "accessible tree"))} ${format(heightOf(result, "toolbar"))}  ` +
          `${format(heightOf(result, "diagnostics"))}  ${rootScroll ? rootScroll.scrollTop.toFixed(0) : "n/a"}\n`
      );
    });
    process.stdout.write("\n");
  }

  if (failingCases.length > 0) {
    process.stdout.write("Violations:\n");
    failingCases.forEach((result) => {
      process.stdout.write(`  ${describeCase({ name: result.tile }, { id: result.state }, result.offset)}\n`);
      const seen = new Set();
      result.violations.forEach((item) => {
        const key = `${item.rule}|${item.target}`;
        if (seen.has(key)) {
          return;
        }
        seen.add(key);
        process.stdout.write(`${formatViolation(item)}\n`);
      });
      const hidden = result.violations.length - seen.size;
      if (hidden > 0) {
        process.stdout.write(`      ... and ${hidden} more on sibling elements\n`);
      }
    });
    process.stdout.write("\n");
  }

  process.stdout.write(`Summary: ${JSON.stringify(summary)}\n`);

  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(
    reportPath,
    `${JSON.stringify(
      {
        package: bundle.name,
        bytes: bundle.bytes,
        sha256: bundle.sha256,
        browser: channel,
        triage: {
          rootPosition: triage.rootPosition,
          rootOverflow: triage.rootOverflow,
          sticky: triage.counts.sticky,
          fixed: triage.counts.fixed,
          absolute: triage.counts.absolute
        },
        summary,
        cases: results.map((result) => ({
          tile: result.tile,
          state: result.state,
          offset: result.offset,
          scrolled: result.scrolled,
          root: result.measurement.root,
          counts: result.measurement.counts,
          chart: result.measurement.chart,
          regions: result.measurement.regions,
          scrollRegions: result.measurement.scrollRegions,
          violations: result.violations
        }))
      },
      null,
      2
    )}\n`
  );
  process.stdout.write(`Report written to ${path.relative(root, reportPath)}\n`);

  if (violations.length > 0) {
    process.exitCode = 1;
  }
  return { results, violations };
};

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { main, collectResults, TILES, STATES, readPackagedBundle };
