import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");

describe("certification-first package contract", () => {
  test("keeps the visual identity, table roles, and empty privileges", () => {
    const pbiviz = JSON.parse(fs.readFileSync(path.join(root, "pbiviz.json"), "utf8"));
    const capabilities = JSON.parse(fs.readFileSync(path.join(root, "capabilities.json"), "utf8"));
    expect(pbiviz.visual.guid).toBe("atlynHierarchyExplorer");
    expect(capabilities.privileges).toEqual([]);
    expect(capabilities.dataRoles.map((role: { name: string }) => role.name)).toEqual(
      expect.arrayContaining(["NodeId", "ParentId", "Label", "Subtitle", "Category", "Value", "Tooltips"])
    );
  });

  test("does not use network, unsafe DOM, or dynamic code in visual sources", () => {
    const source = ["graph.ts", "layout.ts", "localization.ts", "visual.ts"]
      .map((file) => fs.readFileSync(path.join(root, "src", file), "utf8"))
      .join("\n");
    expect(source).not.toMatch(/\b(fetch|XMLHttpRequest|WebSocket|eval|Function)\s*\(/);
    expect(source).not.toContain("innerHTML");
    expect(source).not.toContain("insertAdjacentHTML");
  });
});
