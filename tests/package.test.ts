import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(__dirname, "..");

describe("certification-first package contract", () => {
  test("keeps the visual identity, table roles, and empty privileges", () => {
    const pbiviz = JSON.parse(fs.readFileSync(path.join(root, "pbiviz.json"), "utf8"));
    const capabilities = JSON.parse(fs.readFileSync(path.join(root, "capabilities.json"), "utf8"));
    const resources = JSON.parse(
      fs.readFileSync(path.join(root, "stringResources", "en-US", "resources.resjson"), "utf8")
    );
    expect(pbiviz.visual.guid).toBe("atlynHierarchyExplorer");
    expect(pbiviz.stringResources).toEqual([]);
    expect(fs.existsSync(path.join(root, "stringResources", "en-US", "resources.resjson"))).toBe(true);
    expect(capabilities.privileges).toEqual([]);
    expect(pbiviz.apiVersion).toBe("5.11.0");
    expect(capabilities).not.toHaveProperty("supportsHighlight");
    expect(capabilities.dataRoles.map((role: { name: string }) => role.name)).toEqual(
      expect.arrayContaining(["NodeId", "ParentId", "Label", "Subtitle", "Category", "Value", "Tooltips"])
    );
    expect(capabilities.dataViewMappings[0].table.rows.select).toHaveLength(7);
    expect(capabilities.dataViewMappings[0].conditions[0]).toMatchObject({
      NodeId: { min: 1, max: 1 },
      ParentId: { min: 1, max: 1 },
      Label: { min: 1, max: 1 },
      Tooltips: { max: 10 }
    });
    expect(capabilities.dataViewMappings[0].table.dataReductionAlgorithm.window.count).toBe(30000);
    expect(capabilities.dataRoles.find((role: { name: string }) => role.name === "NodeId").requiredTypes)
      .toEqual(expect.arrayContaining([{ text: true }, { numeric: true }]));
    expect(capabilities).not.toHaveProperty("supportsLandingPage");
    expect(capabilities).not.toHaveProperty("keepAllMetadataColumns");
    expect(capabilities.objects.layout.properties.direction.displayNameKey).toBe("Format_Direction");
    expect(resources.UI_BoundedContract).toBe("bounded table contract active");
    expect(resources["Diagnostic_conflicting-duplicate"]).toContain("never selectable");
  });

  test("includes release metadata and direct certification tooling", () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    const pbiviz = JSON.parse(fs.readFileSync(path.join(root, "pbiviz.json"), "utf8"));
    expect(fs.existsSync(path.join(root, "LICENSE"))).toBe(true);
    expect(fs.existsSync(path.join(root, "CHANGELOG.md"))).toBe(true);
    expect(fs.existsSync(path.join(root, "SECURITY.md"))).toBe(true);
    expect(fs.existsSync(path.join(root, "CONTRIBUTING.md"))).toBe(true);
    expect(fs.existsSync(path.join(root, "RELEASE.md"))).toBe(true);
    expect(packageJson.scripts.eslint).toBe("eslint . --ext .js,.jsx,.ts,.tsx");
    expect(packageJson.scripts.audit).toBe("npm audit");
    expect(packageJson.scripts.package).toContain(
      "npm run clean-package && pbiviz package && npm run normalize-package"
    );
    expect(packageJson.scripts["normalize-package"]).toBe("node scripts/normalize-package.cjs");
    expect(packageJson.scripts["certification-audit"]).toContain("npm run verify-package");
    expect(packageJson.scripts["certification-audit"]).toContain("npm run verify-reproducible-package");
    expect(packageJson.scripts["clean-package"]).toBe("node scripts/clean-package-artifacts.cjs");
    expect(packageJson.scripts["normalize-package"]).toBe("node scripts/normalize-package.cjs");
    expect(packageJson.scripts["verify-package"]).toBe("node scripts/verify-package.cjs");
    expect(packageJson.scripts["validate-publication-assets"]).toBe(
      "node scripts/validate-publication-assets.cjs"
    );
    expect(packageJson.scripts.screenshots).toBe("node scripts/capture-submission-screenshots.cjs");
    expect(packageJson.scripts["verify-screenshots"]).toBe(
      "node scripts/capture-submission-screenshots.cjs --verify"
    );
    expect(packageJson.scripts["brand-assets"]).toBe("node scripts/build-brand-assets.cjs");
    expect(packageJson.scripts["sample-report"]).toBe("node scripts/build-sample-report.cjs");
    expect(packageJson.scripts["release-manifest"]).toBe("node scripts/write-release-manifest.cjs");
    expect(packageJson.scripts["verify-reproducible-package"]).toBe(
      "node scripts/verify-reproducible-package.cjs"
    );
    expect(packageJson.devDependencies["eslint-plugin-powerbi-visuals"]).toBe("1.1.1");
    expect(packageJson.devDependencies.jszip).toBe("3.10.1");
    expect(packageJson.dependencies["powerbi-visuals-api"]).toBe("5.11.0");
    expect(packageJson.devDependencies["powerbi-visuals-tools"]).toBe("7.2.1");
    expect(packageJson.overrides.uuid).toBe("11.1.1");
    // hono reaches the tree through powerbi-visuals-tools -> @modelcontextprotocol/sdk.
    // 4.12.34 is the smallest version that fixes GHSA-8j4g-w8fx-2239.
    expect(packageJson.overrides.hono).toBe("4.12.34");
    // Rendering needs a browser, so Playwright is installed only in the job
    // that renders and never recorded in the manifest. That keeps it off the
    // dependency surface `npm audit` and `npm ci` see.
    expect(packageJson.devDependencies).not.toHaveProperty("playwright");
    expect(packageJson.dependencies).not.toHaveProperty("playwright");
    expect(pbiviz.visual.version).toBe(`${packageJson.version}.0`);
    expect(pbiviz.author.email).not.toContain(".example");
    expect(pbiviz.visual.supportUrl).toMatch(/^https:\/\//);
    expect(pbiviz.visual.gitHubUrl).toBe("https://github.com/garrett-hamers/powerbi-hierarchy-explorer");
    expect(fs.existsSync(path.join(root, "assets", "partner-center-logo.png"))).toBe(true);
  });

  test("carries the metadata and assets an AppSource submission requires", () => {
    const pbiviz = JSON.parse(fs.readFileSync(path.join(root, "pbiviz.json"), "utf8"));

    // The GUID is already recorded in the storefront release manifest and in
    // published download paths, so it must never move.
    expect(pbiviz.visual.guid).toBe("atlynHierarchyExplorer");
    expect(pbiviz.visual.name).toBe("AtlynHierarchyExplorer");
    expect(pbiviz.visual.displayName).toBe("Atlyn Hierarchy Explorer");
    expect(pbiviz.visual.version).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
    expect(pbiviz.visual.description.length).toBeGreaterThanOrEqual(30);
    expect(pbiviz.visual.supportUrl).toBe("https://atlyn.io/contact");
    expect(pbiviz.author.name).toBe("Atlyn");
    expect(pbiviz.author.email).toBe("atlyn.help@gmail.com");
    expect(pbiviz.author.email).not.toMatch(/noreply|no-reply/i);

    expect(fs.existsSync(path.join(root, "EULA.md"))).toBe(true);
    expect(fs.existsSync(path.join(root, "docs", "partner-center-submission.md"))).toBe(true);
    expect(
      fs.existsSync(path.join(root, "samples", "AtlynHierarchyExplorerSample.pbip"))
    ).toBe(true);

    const screenshots = fs
      .readdirSync(path.join(root, "assets", "screenshots"))
      .filter((file) => file.endsWith(".png"));
    expect(screenshots.length).toBeGreaterThanOrEqual(1);
    expect(screenshots.length).toBeLessThanOrEqual(5);

    // The dossier is the submission form in text; drift between it and the
    // manifest is how a wrong URL reaches Partner Center.
    const dossier = fs.readFileSync(path.join(root, "docs", "partner-center-submission.md"), "utf8");
    for (const value of [
      pbiviz.visual.guid,
      pbiviz.visual.version,
      pbiviz.visual.supportUrl,
      pbiviz.author.email,
      "https://atlyn.io/legal/privacy",
      "EULA.md",
      "AppSource listing: Free",
      "samples/AtlynHierarchyExplorerSample.pbip"
    ]) {
      expect(dossier).toContain(value);
    }
  });

  test("ships brand marks that are reproducible from their generator", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readPngMetadata, readPngPixels } = require("../scripts/read-png-metadata.cjs");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ASSETS, renderMark, MIN_COLORS } = require("../scripts/build-brand-assets.cjs");

    // The colour floor is a logo-only gate, because it catches one specific
    // defect: a 300x300 logo produced by upscaling the icon, which arrives as a
    // valid PNG at the right size carrying only the inks it was drawn with.
    // A 20x20 icon gets no floor - a distinct-colour count measures what a mark
    // depicts rather than how well it is made, and this one is whole-pixel
    // rectangles with nothing to antialias, so two colours is correct rather
    // than degenerate. Pixel parity below is the gate that actually protects it.
    expect(MIN_COLORS).toEqual({ 300: 16 });
    expect(ASSETS.map((asset: { relativePath: string }) => asset.relativePath)).toEqual([
      "assets/partner-center-logo.png",
      "assets/icon.png"
    ]);

    for (const asset of ASSETS) {
      const file = path.join(root, ...asset.relativePath.split("/"));
      const metadata = readPngMetadata(file);
      expect(metadata.width).toBe(asset.size);
      expect(metadata.height).toBe(asset.size);

      const floor = MIN_COLORS[asset.size];
      if (floor !== undefined) {
        expect(metadata.distinctColors).toBeGreaterThanOrEqual(floor);
      }

      // Re-rendering from the committed geometry must reproduce the committed
      // pixels, so neither asset can drift away from the script that made it.
      // Pixels rather than file bytes, because zlib output is allowed to differ
      // between Node versions while the image it encodes may not.
      const committed = readPngPixels(file);
      expect(committed.channels).toBe(4);
      const rendered = renderMark(asset);
      expect(rendered.rgba).toHaveLength(asset.size * asset.size * 4);
      expect(Buffer.from(rendered.rgba).equals(committed.pixels)).toBe(true);
    }
  });

  test("draws the 20x20 icon on whole pixels so nothing is antialiased", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readPngPixels } = require("../scripts/read-png-metadata.cjs");

    // The icon is axis-aligned rectangles only. Antialiasing exists to smooth
    // curves and diagonals, so here it could only soften edges that are
    // otherwise pixel-exact. Asserting the two inks keeps that property from
    // being lost to a well-meaning "improvement" that moves a coordinate off a
    // whole pixel: any fractional edge would immediately introduce a blend.
    const { pixels, channels } = readPngPixels(path.join(root, "assets", "icon.png"));
    const inks = new Set<string>();
    for (let offset = 0; offset + channels <= pixels.length; offset += channels) {
      inks.add(`${pixels[offset]},${pixels[offset + 1]},${pixels[offset + 2]},${pixels[offset + 3]}`);
    }
    expect([...inks].sort()).toEqual(["255,255,255,255", "39,100,196,255"]);
  });

  test("packages the icon this repository generates and gates", () => {
    const pbiviz = JSON.parse(fs.readFileSync(path.join(root, "pbiviz.json"), "utf8"));
    // pbiviz embeds this file into the .pbiviz as content.iconBase64, so if the
    // manifest pointed elsewhere the packaged icon would never be validated.
    expect(pbiviz.assets.icon).toBe("assets/icon.png");
    expect(fs.existsSync(path.join(root, "assets", "icon.png"))).toBe(true);
  });

  test("ships the compiled stylesheet inside the package", () => {
    const source = fs.readFileSync(path.join(root, "src", "visual.ts"), "utf8");
    // powerbi-visuals-tools 7.x only bundles LESS reached from the entry point;
    // the legacy `style` field alone produces an empty stylesheet and the visual
    // renders unstyled in the host.
    expect(source).toContain('import "./../style/visual.less";');
    expect(JSON.parse(fs.readFileSync(path.join(root, "pbiviz.json"), "utf8")).style).toBe(
      "style/visual.less"
    );
  });

  test("pins embedded text assets to LF so the package cannot depend on checkout", () => {
    const gitattributes = fs.readFileSync(path.join(root, ".gitattributes"), "utf8");

    // core.autocrlf hands Windows a CRLF working copy of files the repository
    // stores as LF. Any asset that reaches the package verbatim rather than
    // being parsed would then hash differently on Windows and Linux from the
    // same commit, and verify-reproducible-package cannot catch it because it
    // only compares two builds on one machine.
    for (const rule of ["*.resjson text eol=lf", "*.svg text eol=lf", "*.less text eol=lf"]) {
      expect(gitattributes).toContain(rule);
    }
    // The sample report's embedded copy of the package is compared byte for
    // byte, so it must never be converted at all.
    expect(gitattributes).toContain("samples/**/CustomVisuals/** -text");
  });

  test("every screenshot scene declares what it must contain before it can be captured", () => {
    // The harness scenarios are plain page scripts, so running the file here
    // exercises the same definitions the capture drives. Nothing in this test
    // measures geometry - jsdom has no layout - it only holds the rule that a
    // scene without expectations cannot be photographed.
    const sandbox: { window: { ATLYN_SCENARIOS?: Record<string, unknown>[] } } = { window: {} };
    vm.createContext(sandbox);
    vm.runInContext(
      fs.readFileSync(path.join(root, "scripts", "screenshot-harness", "data.js"), "utf8"),
      sandbox
    );
    const scenarios = sandbox.window.ATLYN_SCENARIOS ?? [];

    expect(scenarios.map((scenario) => scenario.id)).toEqual([
      "01-hierarchy-overview",
      "02-expand-collapse",
      "03-search-diagnostics"
    ]);
    for (const scenario of scenarios) {
      expect(typeof scenario.assert).toBe("function");
      expect(String(scenario.caption).length).toBeGreaterThan(40);
    }

    // Distinct expectations, not one shared check: each scene demonstrates a
    // different thing, so identical bodies would verify none of them.
    const bodies = scenarios.map((scenario) => String(scenario.assert));
    expect(new Set(bodies).size).toBe(scenarios.length);

    const capture = fs.readFileSync(
      path.join(root, "scripts", "capture-submission-screenshots.cjs"),
      "utf8"
    );
    // The gate runs before the shutter, and a failing scene takes its stale
    // image with it.
    expect(capture.indexOf("__atlynAssertScene")).toBeLessThan(capture.indexOf("page.screenshot"));
    expect(capture).toContain("discardScreenshot");
  });

  test("CI verifies the screenshot scenes without publishing images", () => {
    const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "ci.yml"), "utf8");
    expect(workflow).toContain("npm run verify-screenshots");
    // Image bytes are not reproducible between runs, so CI must never compare
    // them; it re-renders and applies the scenes' own expectations instead.
    expect(workflow).not.toContain("npm run screenshots\n");
  });

  test("does not use network, unsafe DOM, unsupported highlights, or undocumented context menus", () => {
    const source = fs
      .readdirSync(path.join(root, "src"))
      .filter((file) => file.endsWith(".ts"))
      .map((file) => fs.readFileSync(path.join(root, "src", file), "utf8"))
      .join("\n");
    expect(source).not.toMatch(/\b(fetch|XMLHttpRequest|WebSocket|eval|Function)\s*\(/);
    expect(source).not.toContain("innerHTML");
    expect(source).not.toContain("insertAdjacentHTML");
    expect(source).not.toContain("contextMenuService");
    expect(source).not.toMatch(/\bhighlight(?:ed|s)?\b/);
  });
});
