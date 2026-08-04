/*
 * Builds the offline AppSource sample report as a Power BI Project (PBIP).
 *
 * Why PBIP and not PBIX: a .pbix stores its model as a binary Analysis Services
 * backup image, so it cannot be produced without Power BI Desktop. PBIP stores
 * the report in PBIR and the model in TMSL - both plain JSON with published
 * schemas that Microsoft explicitly supports generating externally. The owner
 * opens the .pbip once in Desktop and does File > Save As > .pbix; that step is
 * documented in docs/partner-center-submission.md.
 *
 * Why not PBIT: a PBIT carries its report as Report/Layout in PBIR-Legacy, which
 * Microsoft documents as a format that "doesn't support external editing" and
 * publishes no schema for.
 *
 * Everything that could drift is derived rather than restated:
 *   - visualType and the resource package come from pbiviz.json
 *   - queryState keys come from capabilities.json dataRoles
 *   - the embedded visual is unzipped from the freshly built dist/*.pbiviz
 *   - the model partition is built from samples/hierarchy-data.json
 *
 * Usage: npm run package && npm run sample-report
 */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const JSZip = require("jszip");

const root = path.resolve(__dirname, "..");
const samplesDirectory = path.join(root, "samples");
const PROJECT = "AtlynHierarchyExplorerSample";
const PAGE_NAME = "pageHierarchyOverview";
const VISUAL_NAME = "visualHierarchyOverview";

/*
 * Schema versions and formats are pinned to match the peer sample project in the
 * sibling powerbi-scatter-chart repository, so the Atlyn samples stay mutually
 * consistent rather than each picking versions off the schema index. That is
 * consistency evidence only: no generated project here has been opened in Power
 * BI Desktop, so nothing below is proof that Desktop loads it.
 *
 * The report *definition* version "2.0.0" is the one value confirmed against
 * real published PBIR reports; do not confuse it with the "4.0" in
 * definition.pbir, which versions the report *item*.
 */
const SCHEMA = {
  pbip: "https://developer.microsoft.com/json-schemas/fabric/pbip/pbipProperties/1.0.0/schema.json",
  pbir: "https://developer.microsoft.com/json-schemas/fabric/item/report/definitionProperties/1.0.0/schema.json",
  pbism:
    "https://developer.microsoft.com/json-schemas/fabric/item/semanticModel/definitionProperties/1.0.0/schema.json",
  version:
    "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/versionMetadata/1.0.0/schema.json",
  report: "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/report/2.1.0/schema.json",
  pages:
    "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/pagesMetadata/1.1.0/schema.json",
  page: "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/page/2.1.0/schema.json",
  visual:
    "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/visualContainer/2.7.0/schema.json"
};
const REPORT_ITEM_VERSION = "4.0";
const REPORT_DEFINITION_VERSION = "2.0.0";
const SEMANTIC_MODEL_ITEM_VERSION = "4.2";
const COMPATIBILITY_LEVEL = 1550;
const BASE_THEME = { name: "CY24SU10", reportVersionAtImport: "5.55", type: "SharedResources" };
// Aggregation function ordinals in the semantic query grammar. Sum is 0.
const AGGREGATE_FUNCTIONS = { Sum: 0, Avg: 1, Min: 2, Max: 3, Count: 4, CountNonNull: 5 };

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, "utf8"));

const writeJson = (filePath, value) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
};

const DAX_TYPES = { string: "STRING", double: "DOUBLE", int64: "INTEGER", boolean: "BOOLEAN" };

/**
 * Renders a DATATABLE literal.
 *
 * DATATABLE accepts constant values only. Rather than depend on BLANK() being
 * accepted in its value list - a failure that would surface only when the
 * project is opened in Power BI Desktop - a missing ParentId is emitted as an
 * empty string. That is behaviourally identical for this visual: normalizeId in
 * src/graph.ts trims and returns null for an empty string, so an empty ParentId
 * is already treated as a root.
 */
const daxLiteral = (value) => {
  if (value === null || value === undefined) {
    return '""';
  }
  if (typeof value === "number") {
    return String(value);
  }
  return `"${String(value).replace(/"/g, '""')}"`;
};

/**
 * Builds a DAX calculated table. This is deliberately not a Power Query
 * partition: a calculated table has no data source at all, so nothing can prompt
 * for credentials, there is no privacy-level or formula-firewall surface, and
 * the report has no refresh dependency. That is what "works fully offline with
 * no external connections" has to mean for a Partner Center sample.
 */
const buildPartitionExpression = (data) => {
  // Every column pair is comma-terminated, including the last, because the
  // value block follows it.
  const columnTypes = data.columns.map(
    (column) => `    "${column.name}", ${DAX_TYPES[column.dataType] ?? "STRING"},`
  );
  const rows = data.rows.map(
    (row, index) =>
      `        {${row.map(daxLiteral).join(", ")}}${index === data.rows.length - 1 ? "" : ","}`
  );
  return ["DATATABLE(", ...columnTypes, "    {", ...rows, "    }", ")"];
};

/** TMDL quotes names that are not simple words with single quotes. */
const tmdlName = (name) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : `'${name}'`);

/**
 * Stable lineage tags. Power BI expects GUIDs here, and deriving them from the
 * object name keeps regeneration byte-for-byte identical instead of churning the
 * diff with fresh random GUIDs on every run.
 */
const lineageTag = (...parts) => {
  const digest = crypto
    .createHash("sha1")
    .update(`atlyn-hierarchy-explorer-sample:${parts.join(":")}`)
    .digest("hex");
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    digest.slice(12, 16),
    digest.slice(16, 20),
    digest.slice(20, 32)
  ].join("-");
};

/**
 * Emits the semantic model as TMDL, the documented folder format for a PBIP
 * semantic model and the one the peer Atlyn sample also uses. Indentation is
 * tabs and the calculated table expression is indented with four tabs, matching
 * the convention in that peer project.
 */
const writeSemanticModel = (modelDirectory, data) => {
  const definition = path.join(modelDirectory, "definition");
  fs.rmSync(definition, { force: true, recursive: true });
  fs.mkdirSync(path.join(definition, "tables"), { recursive: true });

  fs.writeFileSync(
    path.join(definition, "database.tmdl"),
    `database ${PROJECT}\n\tcompatibilityLevel: ${COMPATIBILITY_LEVEL}\n\n`
  );

  // No PBI_QueryOrder annotation: a calculated table is not a Power Query
  // query, so there is nothing to order.
  fs.writeFileSync(
    path.join(definition, "model.tmdl"),
    [
      "model Model",
      "\tculture: en-US",
      "\tdefaultPowerBIDataSourceVersion: powerBI_V3",
      "\tsourceQueryCulture: en-US",
      "",
      `ref table ${tmdlName(data.table)}`,
      ""
    ].join("\n")
  );

  const lines = [
    `/// ${data.description}`,
    `table ${tmdlName(data.table)}`,
    `\tlineageTag: ${lineageTag("table", data.table)}`,
    ""
  ];
  for (const column of data.columns) {
    const numeric = column.dataType !== "string";
    // Calculated table columns take their type from the DATATABLE expression,
    // so they declare isNameInferred and a bracketed source column rather than
    // an explicit dataType.
    lines.push(
      `\tcolumn ${tmdlName(column.name)}`,
      `\t\tlineageTag: ${lineageTag("column", data.table, column.name)}`,
      `\t\tsummarizeBy: ${numeric ? "sum" : "none"}`,
      `\t\tisNameInferred`,
      `\t\tsourceColumn: [${column.name}]`,
      "",
      "\t\tannotation SummarizationSetBy = Automatic",
      ""
    );
  }

  lines.push(
    `\tpartition ${tmdlName(data.table)} = calculated`,
    "\t\tmode: import",
    "\t\tsource =",
    ...buildPartitionExpression(data).map((line) => `\t\t\t\t${line}`),
    "",
    "\tannotation PBI_ResultType = Table",
    ""
  );

  fs.writeFileSync(path.join(definition, "tables", `${data.table}.tmdl`), lines.join("\n"));
};

/** Column projection, used for the Grouping data roles. */
const columnProjection = (table, column) => ({
  field: {
    Column: {
      Expression: { SourceRef: { Entity: table } },
      Property: column
    }
  },
  queryRef: `${table}.${column}`,
  nativeQueryRef: column
});

/** Aggregated projection, used for the Measure and GroupingOrMeasure data roles. */
const aggregateProjection = (table, column, aggregate) => {
  const ordinal = AGGREGATE_FUNCTIONS[aggregate];
  if (ordinal === undefined) {
    throw new Error(`unsupported aggregate "${aggregate}" for ${table}.${column}`);
  }
  return {
    field: {
      Aggregation: {
        Expression: { Column: { Expression: { SourceRef: { Entity: table } }, Property: column } },
        Function: ordinal
      }
    },
    queryRef: `${aggregate}(${table}.${column})`,
    nativeQueryRef: `${aggregate} of ${column}`
  };
};

const buildQueryState = (data, roleNames) => {
  const queryState = {};
  for (const role of roleNames) {
    const binding = data.roleBindings[role];
    if (!binding) {
      throw new Error(
        `samples/hierarchy-data.json has no binding for the "${role}" data role declared in capabilities.json`
      );
    }
    const projection = binding.aggregate
      ? aggregateProjection(data.table, binding.column, binding.aggregate)
      : columnProjection(data.table, binding.column);
    queryState[role] = { projections: [projection] };
  }
  return queryState;
};

const findPackage = () => {
  const distDirectory = path.join(root, "dist");
  const packages = fs.existsSync(distDirectory)
    ? fs.readdirSync(distDirectory).filter((file) => file.endsWith(".pbiviz"))
    : [];
  if (packages.length !== 1) {
    throw new Error(
      'expected exactly one dist/*.pbiviz to embed in the sample report. Run "npm run package" first.'
    );
  }
  return path.join(distDirectory, packages[0]);
};

/**
 * Unzips our own .pbiviz into the report's CustomVisuals folder. This is what
 * makes the report offline: a private custom visual is loaded from these files,
 * whereas report.json's publicCustomVisuals would resolve from AppSource at open
 * time and would not work without a connection.
 */
const embedVisual = async (reportDirectory, guid) => {
  const archive = await JSZip.loadAsync(fs.readFileSync(findPackage()));
  const target = path.join(reportDirectory, "CustomVisuals", guid);
  fs.rmSync(target, { force: true, recursive: true });

  const entries = [];
  archive.forEach((entryPath, entry) => {
    if (!entry.dir) {
      entries.push(entryPath);
    }
  });
  entries.sort();

  for (const entryPath of entries) {
    const destination = path.join(target, entryPath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, await archive.file(entryPath).async("nodebuffer"));
  }
  return entries;
};

const build = async () => {
  const manifest = readJson(path.join(root, "pbiviz.json"));
  const capabilities = readJson(path.join(root, "capabilities.json"));
  const data = readJson(path.join(samplesDirectory, "hierarchy-data.json"));
  const guid = manifest.visual.guid;
  const roleNames = capabilities.dataRoles.map((role) => role.name);

  const reportDirectory = path.join(samplesDirectory, `${PROJECT}.Report`);
  const modelDirectory = path.join(samplesDirectory, `${PROJECT}.SemanticModel`);
  const definitionDirectory = path.join(reportDirectory, "definition");
  fs.rmSync(definitionDirectory, { force: true, recursive: true });

  writeJson(path.join(samplesDirectory, `${PROJECT}.pbip`), {
    $schema: SCHEMA.pbip,
    version: "1.0",
    artifacts: [{ report: { path: `${PROJECT}.Report` } }],
    settings: { enableAutoRecovery: true }
  });

  writeJson(path.join(modelDirectory, "definition.pbism"), {
    $schema: SCHEMA.pbism,
    version: SEMANTIC_MODEL_ITEM_VERSION,
    settings: {}
  });
  writeSemanticModel(modelDirectory, data);

  writeJson(path.join(reportDirectory, "definition.pbir"), {
    $schema: SCHEMA.pbir,
    version: REPORT_ITEM_VERSION,
    datasetReference: { byPath: { path: `../${PROJECT}.SemanticModel` } }
  });

  writeJson(path.join(definitionDirectory, "version.json"), {
    $schema: SCHEMA.version,
    version: REPORT_DEFINITION_VERSION
  });

  writeJson(path.join(definitionDirectory, "report.json"), {
    $schema: SCHEMA.report,
    themeCollection: { baseTheme: BASE_THEME },
    resourcePackages: [
      {
        name: guid,
        type: "CustomVisual",
        items: [
          {
            name: `${guid}.pbiviz.json`,
            path: `${guid}.pbiviz.json`,
            type: "CustomVisualMetadata"
          }
        ]
      }
    ]
  });

  const pagesDirectory = path.join(definitionDirectory, "pages");
  writeJson(path.join(pagesDirectory, "pages.json"), {
    $schema: SCHEMA.pages,
    pageOrder: [PAGE_NAME],
    activePageName: PAGE_NAME
  });
  writeJson(path.join(pagesDirectory, PAGE_NAME, "page.json"), {
    $schema: SCHEMA.page,
    name: PAGE_NAME,
    displayName: "Hierarchy overview",
    displayOption: "FitToPage",
    height: 900,
    width: 1600
  });

  writeJson(path.join(pagesDirectory, PAGE_NAME, "visuals", VISUAL_NAME, "visual.json"), {
    $schema: SCHEMA.visual,
    name: VISUAL_NAME,
    position: { x: 40, y: 40, z: 0, height: 800, width: 1520, tabOrder: 0 },
    visual: {
      visualType: guid,
      query: { queryState: buildQueryState(data, roleNames) },
      visualContainerObjects: {
        title: [
          {
            properties: {
              text: { expr: { Literal: { Value: `'${manifest.visual.displayName}'` } } }
            }
          }
        ]
      },
      drillFilterOtherVisuals: true
    }
  });

  const embedded = await embedVisual(reportDirectory, guid);

  console.log(`Generated samples/${PROJECT}.pbip for ${guid} ${manifest.visual.version}`);
  console.log(`  roles bound: ${roleNames.join(", ")}`);
  console.log(`  data: DAX calculated table "${data.table}", ${data.rows.length} literal rows, no data source`);
  console.log(`  embedded visual: ${embedded.map((entry) => `CustomVisuals/${guid}/${entry}`).join(", ")}`);
};

build().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
