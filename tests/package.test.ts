import fs from "node:fs";
import path from "node:path";

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
    expect(packageJson.scripts["release-manifest"]).toBe("node scripts/write-release-manifest.cjs");
    expect(packageJson.scripts["verify-reproducible-package"]).toBe(
      "node scripts/verify-reproducible-package.cjs"
    );
    expect(packageJson.devDependencies["eslint-plugin-powerbi-visuals"]).toBe("1.1.1");
    expect(packageJson.devDependencies.jszip).toBe("3.10.1");
    expect(packageJson.dependencies["powerbi-visuals-api"]).toBe("5.11.0");
    expect(packageJson.devDependencies["powerbi-visuals-tools"]).toBe("7.2.1");
    expect(packageJson.overrides.uuid).toBe("11.1.1");
    expect(pbiviz.visual.version).toBe(`${packageJson.version}.0`);
    expect(pbiviz.author.email).not.toContain(".example");
    expect(pbiviz.visual.supportUrl).toMatch(/^https:\/\//);
    expect(pbiviz.visual.gitHubUrl).toBe(pbiviz.visual.supportUrl);
    expect(fs.existsSync(path.join(root, "assets", "partner-center-logo.png"))).toBe(true);
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
