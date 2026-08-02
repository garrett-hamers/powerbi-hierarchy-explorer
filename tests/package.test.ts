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
    expect(capabilities.objects.layout.properties.direction.displayNameKey).toBe("Format_Direction");
    expect(resources.UI_BoundedContract).toBe("bounded table contract active");
    expect(resources["Diagnostic_conflicting-duplicate"]).toContain("never selectable");
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
