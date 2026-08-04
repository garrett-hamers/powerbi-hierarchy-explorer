import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const samples = path.join(root, "samples");
const project = "AtlynHierarchyExplorerSample";
const reportDirectory = path.join(samples, `${project}.Report`);
const modelDirectory = path.join(samples, `${project}.SemanticModel`);
const definition = path.join(reportDirectory, "definition");
const pageName = "pageHierarchyOverview";
const visualName = "visualHierarchyOverview";

const readJson = (...segments: string[]) =>
  JSON.parse(fs.readFileSync(path.join(...segments), "utf8"));

describe("offline AppSource sample report", () => {
  test("ships every part a Power BI Project needs", () => {
    const required = [
      path.join(samples, `${project}.pbip`),
      path.join(samples, "hierarchy-data.json"),
      path.join(reportDirectory, "definition.pbir"),
      path.join(definition, "version.json"),
      path.join(definition, "report.json"),
      path.join(definition, "pages", "pages.json"),
      path.join(definition, "pages", pageName, "page.json"),
      path.join(definition, "pages", pageName, "visuals", visualName, "visual.json"),
      path.join(modelDirectory, "definition.pbism"),
      path.join(modelDirectory, "definition", "database.tmdl"),
      path.join(modelDirectory, "definition", "model.tmdl"),
      path.join(modelDirectory, "definition", "tables", "Hierarchy.tmdl")
    ];
    for (const file of required) {
      expect(fs.existsSync(file)).toBe(true);
    }

    const pbip = readJson(samples, `${project}.pbip`);
    expect(pbip.artifacts[0].report.path).toBe(`${project}.Report`);

    // A relative byPath reference is what makes Desktop open the model beside
    // the report; a byConnection reference would need a Fabric workspace.
    const pbir = readJson(reportDirectory, "definition.pbir");
    expect(pbir.datasetReference.byPath.path).toBe(`../${project}.SemanticModel`);
    expect(pbir.datasetReference.byConnection).toBeUndefined();

    // The report *definition* version, not the "4.0" report *item* version.
    expect(readJson(definition, "version.json").version).toBe("2.0.0");

    const pages = readJson(definition, "pages", "pages.json");
    expect(pages.pageOrder).toEqual([pageName]);
    expect(pages.activePageName).toBe(pageName);
    expect(readJson(definition, "pages", pageName, "page.json").name).toBe(pageName);
  });

  test("binds the visual by GUID to roles the visual actually declares", () => {
    const pbiviz = readJson(root, "pbiviz.json");
    const capabilities = readJson(root, "capabilities.json");
    const visual = readJson(definition, "pages", pageName, "visuals", visualName, "visual.json");

    expect(visual.name).toBe(visualName);
    expect(visual.visual.visualType).toBe(pbiviz.visual.guid);

    const roleNames: string[] = capabilities.dataRoles.map((role: { name: string }) => role.name);
    const bound = Object.keys(visual.visual.query.queryState);
    // Every binding must name a real data role, and the sample exercises all of
    // them so a reviewer sees the visual fully configured.
    for (const role of bound) {
      expect(roleNames).toContain(role);
    }
    expect(bound.sort()).toEqual([...roleNames].sort());

    for (const role of bound) {
      const projections = visual.visual.query.queryState[role].projections;
      expect(projections).toHaveLength(1);
      expect(projections[0].queryRef).toEqual(expect.any(String));
    }

    // The Measure role has to be aggregated rather than projected as a column.
    const value = visual.visual.query.queryState.Value.projections[0];
    expect(value.field.Aggregation.Function).toBe(0);
    expect(value.field.Aggregation.Expression.Column.Property).toBe("Revenue");
  });

  test("embeds the visual as a private custom visual instead of resolving AppSource", () => {
    const guid = readJson(root, "pbiviz.json").visual.guid;
    const report = readJson(definition, "report.json");

    // publicCustomVisuals resolves from the AppSource store at open time, so it
    // would break the "works offline with no external connections" requirement.
    expect(report.publicCustomVisuals).toBeUndefined();
    expect(report.organizationCustomVisuals).toBeUndefined();

    const custom = report.resourcePackages.find(
      (pack: { type: string }) => pack.type === "CustomVisual"
    );
    expect(custom.name).toBe(guid);
    expect(custom.items).toEqual([
      { name: `${guid}.pbiviz.json`, path: `${guid}.pbiviz.json`, type: "CustomVisualMetadata" }
    ]);

    const embedded = path.join(reportDirectory, "CustomVisuals", guid);
    expect(fs.existsSync(path.join(embedded, "package.json"))).toBe(true);
    expect(fs.existsSync(path.join(embedded, "resources", `${guid}.pbiviz.json`))).toBe(true);

    const resource = readJson(embedded, "resources", `${guid}.pbiviz.json`);
    expect(resource.visual.guid).toBe(guid);
    expect(resource.visual.version).toBe(readJson(root, "pbiviz.json").visual.version);
    expect(typeof resource.content.js).toBe("string");
    expect(resource.content.css).toContain(".atlyn-root");
  });

  test("holds its data in a DAX calculated table with no data source", () => {
    const table = fs.readFileSync(
      path.join(modelDirectory, "definition", "tables", "Hierarchy.tmdl"),
      "utf8"
    );
    const model = fs.readFileSync(path.join(modelDirectory, "definition", "model.tmdl"), "utf8");
    const data = readJson(samples, "hierarchy-data.json");

    // A calculated table declares no data source at all, so there is nothing to
    // authenticate against. A Power Query partition, even one over an inline
    // #table, still goes through the mashup engine.
    expect(table).toContain("partition Hierarchy = calculated");
    expect(table).toContain("mode: import");
    expect(table).toContain("DATATABLE(");
    expect(table).not.toContain("= m\n");
    expect(table).not.toContain("#table");
    expect(table).not.toContain("Source =");
    // No Power Query queries exist, so there is nothing to order.
    expect(model).not.toContain("PBI_QueryOrder");

    // Anything that would prompt for credentials or reach the network on
    // refresh disqualifies the sample. URL schemes are assembled rather than
    // written literally so the repository's own no-http-string lint rule, which
    // exists to keep URLs out of the visual, does not flag this guard.
    const connectors = [
      "Sql.Database",
      "Web.Contents",
      "File.Contents",
      "Excel.Workbook",
      "Csv.Document",
      "Folder.Files",
      "Odbc.",
      "OData.",
      "SharePoint.",
      "AzureStorage.",
      "dataSource",
      ...["http", "https", "ftp"].map((scheme) => `${scheme}${String.fromCharCode(58)}//`)
    ];
    const definitionText = [
      table,
      model,
      fs.readFileSync(path.join(modelDirectory, "definition", "database.tmdl"), "utf8")
    ].join("\n");
    for (const connector of connectors) {
      expect(definitionText).not.toContain(connector);
    }

    // DATATABLE takes literal constants only, so a missing ParentId is an empty
    // string. normalizeId trims and returns null for that, so the visual still
    // reads the row as a root.
    expect(data.rows[0][1]).toBeNull();
    expect(table).toContain(`{"${data.rows[0][0]}", "",`);

    // Every row survives into the partition, so the sample renders a real
    // multi-level hierarchy rather than a stub.
    for (const row of data.rows) {
      expect(table).toContain(`"${row[0]}"`);
    }
    expect(data.rows.length).toBeGreaterThanOrEqual(10);
    const depths = new Set(data.rows.map((row: string[]) => row[4]));
    expect(depths.size).toBeGreaterThanOrEqual(4);
  });

  test("declares folder-format versions the definition folders require", () => {
    // Microsoft documents version 1.0 as meaning the report must be PBIR-Legacy
    // in report.json and the model must be TMSL in model.bim. This project uses
    // the definition/ folders for both, which needs 4.0 or above.
    expect(readJson(reportDirectory, "definition.pbir").version).toBe("4.0");
    expect(
      fs.existsSync(path.join(reportDirectory, "definition", "report.json"))
    ).toBe(true);

    expect(Number(readJson(modelDirectory, "definition.pbism").version)).toBeGreaterThanOrEqual(4);
    expect(fs.existsSync(path.join(modelDirectory, "model.bim"))).toBe(false);
    expect(fs.existsSync(path.join(modelDirectory, "definition", "model.tmdl"))).toBe(true);
  });

  test("is regenerated by a committed script rather than hand-maintained", () => {
    const packageJson = readJson(root, "package.json");
    expect(packageJson.scripts["sample-report"]).toBe("node scripts/build-sample-report.cjs");
    expect(fs.existsSync(path.join(root, "scripts", "build-sample-report.cjs"))).toBe(true);

    // Opening the project in Desktop writes an Analysis Services cache of the
    // model and its data; it must never be committed.
    const gitignore = fs.readFileSync(path.join(root, ".gitignore"), "utf8");
    expect(gitignore).toContain("**/.pbi/cache.abf");
    expect(gitignore).toContain("**/.pbi/localSettings.json");
  });
});
