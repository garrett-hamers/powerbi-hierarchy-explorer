/*
 * Captures the AppSource submission screenshots by rendering the packaged
 * visual in a real browser.
 *
 * The compiled stylesheet and script are read straight out of .tmp/drop, which
 * `npm run package` produces and which is the exact payload embedded in the
 * .pbiviz. Nothing is drawn by hand and no image is post-processed: each PNG is
 * a viewport screenshot of the rendered visual at exactly 1366x768.
 *
 * A screenshot is only written once the scene it claims to show has been proved
 * to be on the screen. Each scenario in the harness declares its own
 * expectations - counts, state and measured geometry - and they are evaluated
 * against the live page immediately before the shutter opens. Nothing reaches
 * assets/screenshots until every scene has passed, so a broken render cannot be
 * committed as a submission asset.
 *
 * The measurements each scene was accepted on, and the SHA-256 of the bytes
 * published for it, are written to assets/screenshot-capture.json. Without that
 * record the assertions would prove only that a file was correct at the moment
 * it was written, and a screenshot edited or swapped afterwards would pass
 * every remaining gate. validate-publication-assets re-checks the committed
 * bytes against it on every build.
 *
 * Pass --verify to run every scene through the same gate without publishing
 * anything. That is the form CI uses: it proves the current source still renders
 * all three scenes and still matches the committed record, without comparing
 * image bytes, which are not reproducible even between two runs on the same
 * machine.
 *
 * Playwright is deliberately not a dependency of this package. `npm ci` and the
 * validate job never render - they check the committed PNGs with
 * `npm run validate-publication-assets`, which needs nothing beyond Node.
 * Install Playwright only when you need to render:
 *
 *   npm install --no-save playwright
 *   npx playwright install chromium
 *   npm run package
 *   npm run screenshots
 */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const harnessDirectory = path.join(__dirname, "screenshot-harness");
const dropManifestPath = path.join(root, ".tmp", "drop", "pbiviz.json");
const outputDirectory = path.join(root, "assets", "screenshots");
const stagingDirectory = path.join(root, ".tmp", "screenshots");
const captureRecordPath = path.join(root, "assets", "screenshot-capture.json");
const resourcesPath = path.join(root, "stringResources", "en-US", "resources.resjson");

const verifyOnly = process.argv.includes("--verify");

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

/**
 * A scene that fails its own expectations must not leave a plausible-looking
 * PNG behind. The previously committed file is the dangerous one: left in
 * place it still shows the old, correct render, so a broken build looks
 * healthy in the repository. Removing it makes the failure visible in
 * `git status` as well as on the console.
 *
 * --verify never publishes, so it has nothing to discard.
 */
const discardScreenshot = (id) => {
  const committed = path.join(outputDirectory, `${id}.png`);
  if (verifyOnly || !fs.existsSync(committed)) {
    return null;
  }
  fs.rmSync(committed);
  return path.relative(root, committed);
};

const describeFailure = (id, failures, discarded) =>
  [
    `${id} did not render the scene it claims to show, so no screenshot was written:`,
    ...failures.map((failure) => `  - ${failure}`),
    discarded
      ? `  ${discarded} has been deleted so the stale image cannot pass for a current one.`
      : verifyOnly
        ? "  Nothing was published: this run is --verify."
        : `  No committed ${id}.png was present to discard.`
  ].join("\n");

/**
 * The measurements a scene was accepted on, in a form that survives the run.
 * The assertions themselves are ephemeral - they pass, print, and are gone -
 * so what is kept is the evidence they were applied to, not a bare verdict.
 */
const evidenceFor = (probe) => ({
  cards: probe.graph.cards,
  edges: probe.graph.edges,
  levels: probe.graph.depthColumns,
  labels: probe.graph.labels,
  subtitles: probe.graph.subtitles,
  visual: probe.root,
  canvas: { width: probe.canvas.width, height: probe.canvas.height },
  tree: {
    onScreen: probe.tree.onScreen,
    height: probe.tree.height,
    rows: probe.tree.rows,
    expanded: probe.tree.expandedRows,
    collapsed: probe.tree.collapsedRows,
    focusedRow: probe.tree.focusedRow
  },
  search: { value: probe.search.value, matches: probe.search.matches },
  diagnostics: { lines: probe.diagnostics.lines, height: probe.diagnostics.height },
  status: probe.status,
  breadcrumb: probe.breadcrumb
});

/**
 * Writes the record that makes a committed screenshot re-checkable.
 *
 * The hashes here pin the bytes that were just published, read back off disk.
 * They are deliberately NOT an expectation that a later render will reproduce
 * them, and nothing downstream may treat them that way: two captures of the
 * same commit on the same machine differ by a handful of pixels at a single
 * channel value, and the Linux runner produces PNGs some 45% larger from the
 * same source. Re-rendering and comparing images would fail constantly for
 * reasons that have nothing to do with correctness.
 *
 * What a hash does prove is that the file in the repository is still the file
 * the assertions were applied to. A screenshot edited, reverted or swapped
 * after capture passes every other gate; it cannot pass this one.
 */
const writeCaptureRecord = (packaged, channel, results) => {
  const record = {
    documentation:
      "Written by npm run screenshots. Each sha256 pins the committed bytes the assertions were applied to; " +
      "it is not a golden image. Renders are not bit-stable, so this must never become a re-render comparison.",
    capturedWith: {
      visualGuid: packaged.guid,
      visualVersion: packaged.version,
      browser: channel,
      viewport: `${WIDTH}x${HEIGHT}`
    },
    scenes: results.map(({ id, probe }) => {
      const published = path.join(outputDirectory, `${id}.png`);
      const bytes = fs.readFileSync(published);
      return {
        id,
        path: `assets/screenshots/${id}.png`,
        bytes: bytes.length,
        sha256: crypto.createHash("sha256").update(bytes).digest("hex").toUpperCase(),
        asserted: evidenceFor(probe)
      };
    })
  };
  fs.writeFileSync(captureRecordPath, `${JSON.stringify(record, null, 2)}\n`);
  return record;
};

/**
 * --verify re-renders, so it can also tell whether the committed record still
 * describes what the current source draws. Only the measured content is
 * compared: bytes and hashes are excluded on purpose, because they are
 * expected to differ on any machine other than the one that captured.
 */
const findRecordDrift = (results) => {
  if (!fs.existsSync(captureRecordPath)) {
    return [`${path.relative(root, captureRecordPath)} is missing; run "npm run screenshots" to record the capture`];
  }
  const record = JSON.parse(fs.readFileSync(captureRecordPath, "utf8"));
  const recorded = new Map((record.scenes ?? []).map((scene) => [scene.id, scene]));
  const drift = [];
  for (const { id, probe } of results) {
    const scene = recorded.get(id);
    if (!scene) {
      drift.push(`${id} rendered but is not in the capture record`);
      continue;
    }
    const now = JSON.stringify(evidenceFor(probe));
    if (JSON.stringify(scene.asserted) !== now) {
      drift.push(
        `${id} no longer renders what the capture record describes:\n` +
          `    recorded ${JSON.stringify(scene.asserted)}\n` +
          `    rendered ${now}`
      );
    }
  }
  for (const id of recorded.keys()) {
    if (!results.some((result) => result.id === id)) {
      drift.push(`${id} is in the capture record but no scenario renders it`);
    }
  }
  return drift;
};

const summarise = (probe) =>
  [
    `${probe.graph.cards} cards`,
    `${probe.graph.edges} edges`,
    `${probe.graph.depthColumns} levels`,
    `tree ${probe.tree.onScreen ? `open ${probe.tree.height}px, ${probe.tree.rows} rows` : "collapsed"}`,
    `${probe.tree.collapsedRows.length} collapsed`,
    `${probe.search.matches} search matches`,
    `${probe.diagnostics.lines} diagnostics`
  ].join(", ");

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
    // Collected rather than thrown: a throw from this handler is swallowed by
    // the emitter, and a scene that errored while rendering must fail loudly.
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message.split("\n")[0]));

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
    fs.rmSync(stagingDirectory, { recursive: true, force: true });
    fs.mkdirSync(stagingDirectory, { recursive: true });

    for (const { id, input } of scenarios) {
      pageErrors.length = 0;
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

      // The gate. The page is measured as it stands, the scene's own
      // expectations are applied to those measurements, and only a scene that
      // satisfies them is photographed.
      const { probe, failures } = await page.evaluate(
        (scenarioId) => window.__atlynAssertScene(scenarioId),
        id
      );
      const allFailures = [
        ...pageErrors.map((message) => `the page raised an error while rendering: ${message}`),
        ...failures
      ];
      if (allFailures.length > 0) {
        throw new Error(describeFailure(id, allFailures, discardScreenshot(id)));
      }

      const staged = path.join(stagingDirectory, `${id}.png`);
      await page.screenshot({ path: staged, type: "png", scale: "css", fullPage: false });
      const { size } = fs.statSync(staged);
      if (size > MAX_BYTES) {
        throw new Error(
          describeFailure(
            id,
            [`the PNG is ${size} bytes, above the ${MAX_BYTES} byte Partner Center limit`],
            discardScreenshot(id)
          )
        );
      }
      results.push({ id, size, staged, probe });
    }
  } finally {
    await browser.close();
  }

  // Publishing happens only after every scene has passed, so a run that fails
  // late cannot leave assets/screenshots holding a mixture of renders.
  if (!verifyOnly) {
    fs.mkdirSync(outputDirectory, { recursive: true });
    for (const { id, staged } of results) {
      fs.copyFileSync(staged, path.join(outputDirectory, `${id}.png`));
    }
    writeCaptureRecord(packaged, channel, results);
  }
  fs.rmSync(stagingDirectory, { recursive: true, force: true });

  const drift = verifyOnly ? findRecordDrift(results) : [];

  console.log(
    `${verifyOnly ? "Verified" : "Rendered"} ${packaged.guid} ${packaged.version} with ${channel} at ${WIDTH}x${HEIGHT}`
  );
  for (const { id, size, probe } of results) {
    console.log(`  ${id}.png ${size} bytes - ${summarise(probe)}`);
    console.log(`    ${probe.status}`);
    console.log(`    ${probe.breadcrumb}`);
  }
  if (drift.length > 0) {
    throw new Error(
      [
        `The committed capture record no longer matches what the source renders:`,
        ...drift.map((entry) => `  - ${entry}`),
        `  Re-run "npm run screenshots" so ${path.relative(root, captureRecordPath)} describes the current build.`
      ].join("\n")
    );
  }
  console.log(
    `All ${results.length} scenes met their content expectations before capture.` +
      (verifyOnly
        ? ` The committed ${path.relative(root, captureRecordPath).replace(/\\/g, "/")} still describes this render; nothing was written.`
        : ` Recorded in ${path.relative(root, captureRecordPath).replace(/\\/g, "/")}.`)
  );
};

capture().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
