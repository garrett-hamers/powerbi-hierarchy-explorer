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
const { readVisualBundle } = require("./read-visual-bundle.cjs");

const root = path.resolve(__dirname, "..");
const harnessDirectory = path.join(__dirname, "screenshot-harness");
const outputDirectory = path.join(root, "assets", "screenshots");
const stagingDirectory = path.join(root, ".tmp", "screenshots");
const captureRecordPath = path.join(root, "assets", "screenshot-capture.json");
const resourcesPath = path.join(root, "stringResources", "en-US", "resources.resjson");

const verifyOnly = process.argv.includes("--verify");

const WIDTH = 1366;
const HEIGHT = 768;
const MAX_BYTES = 1024 * 1024;

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, "utf8"));

const readRecord = () =>
  fs.existsSync(captureRecordPath) ? readJson(captureRecordPath) : null;

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
 * channel value - one pair came back at identical byte length with a different
 * hash - and the Linux runner produces PNGs some 45% larger from the same
 * source. Re-rendering and comparing images would fail constantly for reasons
 * that have nothing to do with correctness. The same holds for bundleSha256:
 * it identifies the code the scenes were drawn from, and is compared against
 * the bundle on disk, never used to predict image bytes.
 *
 * What a hash does prove is that the file in the repository is still the file
 * the assertions were applied to, and that the visual has not moved underneath
 * it. A screenshot edited, reverted or swapped after capture passes every other
 * gate; so does a screenshot left behind by a change to the visual. Neither can
 * pass this one.
 */
const writeCaptureRecord = (bundle, channel, results) => {
  const record = {
    documentation:
      "Written by npm run screenshots. Each sha256 pins the committed bytes the assertions were applied to; " +
      "it is not a golden image. Renders are not bit-stable, so this must never become a re-render comparison. " +
      "bundleSha256 is the compiled visual those bytes were drawn from, and is compared against the bundle on " +
      "disk so a screenshot cannot outlive the build it shows.",
    capturedWith: {
      visualGuid: bundle.guid,
      visualVersion: bundle.version,
      // The version is far too coarse to stand alone: 1.0.1.0 has already
      // shipped as more than one package in this repository.
      bundleSha256: bundle.sha256,
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
 * Whether the committed PNG for a scene can stand rather than being rewritten.
 *
 * Renders are not bit-stable, so re-running the capture against a build that
 * has not changed would otherwise rewrite every image with a few pixels of
 * noise. That churn is pure cost, and a gate that dirties the tree for no
 * reason teaches people to route around it.
 *
 * The condition is deliberately the bundle hash and not the measured values.
 * Equal measurements do not mean an equal picture: recolour every node and the
 * counts, the geometry and the text are all untouched while the committed image
 * stops showing the product. Retaining on unchanged measurements would reopen
 * precisely the gap bundleSha256 exists to close. Keying retention to the
 * bundle keeps one clean guarantee - every committed screenshot was rendered
 * from the bundle the record names.
 */
const canRetainCommitted = (previous, bundle, id, probe) => {
  if (!previous || previous.capturedWith?.bundleSha256 !== bundle.sha256) {
    return false;
  }
  const scene = (previous.scenes ?? []).find((entry) => entry.id === id);
  const committed = path.join(outputDirectory, `${id}.png`);
  if (!scene || !fs.existsSync(committed)) {
    return false;
  }
  if (JSON.stringify(scene.asserted) !== JSON.stringify(evidenceFor(probe))) {
    return false;
  }
  const bytes = fs.readFileSync(committed);
  return crypto.createHash("sha256").update(bytes).digest("hex").toUpperCase() === scene.sha256;
};

/**
 * --verify re-renders, so it can also tell whether the committed record still
 * describes what the current source draws. Only the measured content and the
 * bundle identity are compared: image bytes and their hashes are excluded on
 * purpose, because they are expected to differ on any machine other than the
 * one that captured.
 */
const findRecordDrift = (bundle, results) => {
  if (!fs.existsSync(captureRecordPath)) {
    return [`${path.relative(root, captureRecordPath)} is missing; run "npm run screenshots" to record the capture`];
  }
  const record = readJson(captureRecordPath);
  const recorded = new Map((record.scenes ?? []).map((scene) => [scene.id, scene]));
  const drift = [];
  if (record.capturedWith?.bundleSha256 !== bundle.sha256) {
    drift.push(
      `the committed screenshots were captured from compiled visual ${record.capturedWith?.bundleSha256}, ` +
        `but this source compiles to ${bundle.sha256}`
    );
  }
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
  const bundle = readVisualBundle();
  const previousRecord = readRecord();
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
    await page.addStyleTag({ content: bundle.css });
    await page.addScriptTag({ content: bundle.js });

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
    for (const result of results) {
      result.retained = canRetainCommitted(previousRecord, bundle, result.id, result.probe);
      if (!result.retained) {
        fs.copyFileSync(result.staged, path.join(outputDirectory, `${result.id}.png`));
      }
    }
    writeCaptureRecord(bundle, channel, results);
  }
  fs.rmSync(stagingDirectory, { recursive: true, force: true });

  const drift = verifyOnly ? findRecordDrift(bundle, results) : [];

  console.log(
    `${verifyOnly ? "Verified" : "Rendered"} ${bundle.guid} ${bundle.version} with ${channel} at ${WIDTH}x${HEIGHT}`
  );
  console.log(`  compiled visual ${bundle.sha256}`);
  for (const { id, size, probe, retained } of results) {
    const published = verifyOnly ? size : fs.statSync(path.join(outputDirectory, `${id}.png`)).size;
    console.log(
      `  ${id}.png ${published} bytes - ${summarise(probe)}` +
        (retained ? " (committed bytes kept: same bundle, same measurements)" : "")
    );
    console.log(`    ${probe.status}`);
    console.log(`    ${probe.breadcrumb}`);
  }
  if (drift.length > 0) {
    throw new Error(
      [
        `The committed capture record no longer matches what the source renders:`,
        ...drift.map((entry) => `  - ${entry}`),
        `  Re-run "npm run screenshots" so ${path.relative(root, captureRecordPath).replace(/\\/g, "/")} describes the current build.`
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
