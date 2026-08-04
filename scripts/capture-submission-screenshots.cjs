/*
 * Captures the AppSource submission screenshots by rendering the packaged
 * visual in a real browser.
 *
 * The compiled stylesheet and script are read straight out of .tmp/drop, which
 * `npm run package` produces and which is the exact payload embedded in the
 * .pbiviz. Nothing is drawn by hand and no image is post-processed: each PNG is
 * a viewport screenshot of the rendered visual at exactly 1366x768.
 *
 * Playwright is deliberately not a dependency of this package. CI never renders
 * - it validates the committed PNGs with `npm run validate-publication-assets`,
 * which needs nothing beyond Node. Install Playwright only when you need to
 * regenerate the images:
 *
 *   npm install --no-save playwright
 *   npx playwright install chromium
 *   npm run package
 *   npm run screenshots
 */
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const harnessDirectory = path.join(__dirname, "screenshot-harness");
const dropManifestPath = path.join(root, ".tmp", "drop", "pbiviz.json");
const outputDirectory = path.join(root, "assets", "screenshots");
const resourcesPath = path.join(root, "stringResources", "en-US", "resources.resjson");

const WIDTH = 1366;
const HEIGHT = 768;
const MAX_BYTES = 1024 * 1024;

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, "utf8"));

const loadPackagedVisual = () => {
  if (!fs.existsSync(dropManifestPath)) {
    throw new Error(
      `${path.relative(root, dropManifestPath)} is missing. Run "npm run package" first so the compiled visual is available.`
    );
  }
  const manifest = readJson(dropManifestPath);
  const js = manifest.content && manifest.content.js;
  const css = manifest.content && manifest.content.css;
  if (!js) {
    throw new Error(`${path.relative(root, dropManifestPath)} contains no compiled script`);
  }
  if (!css) {
    throw new Error(
      `${path.relative(root, dropManifestPath)} contains no compiled stylesheet; the visual would render unstyled`
    );
  }
  return { js, css, guid: manifest.visual.guid, version: manifest.visual.version };
};

const loadPlaywright = () => {
  try {
    return require("playwright");
  } catch {
    throw new Error(
      [
        "Playwright is not installed, so the screenshots cannot be rendered.",
        "It is intentionally not a dependency of this package: CI only validates the committed PNGs.",
        "To regenerate them, run:",
        "  npm install --no-save playwright",
        "  npx playwright install chromium",
        "  npm run package",
        "  npm run screenshots"
      ].join("\n")
    );
  }
};

/**
 * Prefers Playwright's own Chromium build and falls back to an installed
 * Chrome or Edge so a machine without downloaded browsers can still render.
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
  throw new Error(`no Chromium build could be launched.\n${failures.join("\n")}`);
};

const capture = async () => {
  const packaged = loadPackagedVisual();
  const strings = readJson(resourcesPath);
  const playwright = loadPlaywright();
  const { browser, channel } = await launchBrowser(playwright);
  const results = [];

  try {
    const context = await browser.newContext({
      viewport: { width: WIDTH, height: HEIGHT },
      deviceScaleFactor: 1,
      reducedMotion: "reduce",
      locale: "en-US",
      colorScheme: "light"
    });
    // Belt and braces: the harness is entirely local, so any outbound request
    // is a defect rather than something to quietly allow.
    await context.route("**/*", (route) =>
      route.request().url().startsWith("file:") ? route.continue() : route.abort()
    );

    const page = await context.newPage();
    page.on("pageerror", (error) => {
      throw error;
    });

    await page.goto(pathToFileURL(path.join(harnessDirectory, "index.html")).href, {
      waitUntil: "load"
    });
    await page.evaluate((value) => {
      window.ATLYN_STRINGS = value;
    }, strings);
    await page.addStyleTag({ content: packaged.css });
    await page.addScriptTag({ content: packaged.js });

    const scenarios = await page.evaluate(() =>
      window.ATLYN_SCENARIOS.map(({ id, input }) => ({ id, input }))
    );
    fs.mkdirSync(outputDirectory, { recursive: true });

    for (const { id, input } of scenarios) {
      await page.evaluate((scenarioId) => window.__atlynMount(scenarioId), id);

      // Everything below is native input delivered by the browser, so the
      // visual's own handlers produce the state that gets captured.
      if (input.enterTree) {
        await page.evaluate(() => window.__atlynEnterTree());
      }
      for (const key of input.keys ?? []) {
        await page.keyboard.press(key);
      }
      if (input.type) {
        await page.locator(input.type.selector).pressSequentially(input.type.text);
      }

      const summary = await page.evaluate(() => window.__atlynSummary());
      const file = path.join(outputDirectory, `${id}.png`);
      await page.screenshot({ path: file, type: "png", scale: "css", fullPage: false });
      const { size } = fs.statSync(file);
      if (size > MAX_BYTES) {
        throw new Error(`${id}.png is ${size} bytes, above the ${MAX_BYTES} byte Partner Center limit`);
      }
      results.push({ id, size, summary });
    }
  } finally {
    await browser.close();
  }

  console.log(`Rendered ${packaged.guid} ${packaged.version} with ${channel} at ${WIDTH}x${HEIGHT}`);
  for (const { id, size, summary } of results) {
    console.log(
      `  ${id}.png ${size} bytes - ${summary.nodes} nodes, ${summary.treeItems} tree items, ` +
        `tree ${summary.treeVisible ? "focused" : "hidden"}, ${summary.searchMatches} search matches, ` +
        `${summary.diagnostics} diagnostics`
    );
    console.log(`    ${summary.status.trim()}`);
    console.log(`    ${summary.breadcrumb.trim()}`);
  }
};

capture().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
