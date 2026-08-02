import {
  buildHierarchy,
  flattenVisibleIds,
  getAncestorIds,
  getDescendantIds
} from "../src/graph";
import { computeLayout } from "../src/layout";

describe("buildHierarchy", () => {
  test("retains a deterministic forest and exposes paths and descendants", () => {
    const graph = buildHierarchy([
      { nodeId: "b", parentId: "a", label: "B" },
      { nodeId: "a", parentId: null, label: "A" },
      { nodeId: "root-2", parentId: null, label: "Second" },
      { nodeId: "c", parentId: "b", label: "C" }
    ]);

    expect(graph.roots).toEqual(["a", "root-2"]);
    expect(graph.nodes.get("a")?.children).toEqual(["b"]);
    expect(getDescendantIds(graph, "a", true)).toEqual(["a", "b", "c"]);
    expect(getAncestorIds(graph, "c", true)).toEqual(["a", "b", "c"]);
    expect(graph.diagnostics.map((item) => item.code)).toContain("multiple-roots");
    expect(flattenVisibleIds(graph, new Set(["b"]))).toEqual(["a", "b", "root-2"]);
  });

  test("uses NodeId identity and diagnoses duplicate and conflicting rows", () => {
    const graph = buildHierarchy([
      { nodeId: "same", parentId: null, label: "First", sourceRow: 10 },
      { nodeId: "same", parentId: null, label: "First", sourceRow: 11 },
      { nodeId: "same", parentId: "other", label: "Conflicting", sourceRow: 12 },
      { nodeId: "other", parentId: null, label: "Other" }
    ]);

    expect(graph.nodes.size).toBe(2);
    expect(graph.nodes.get("same")?.label).toBe("First");
    expect(graph.nodes.get("same")?.sourceRow).toBe(10);
    expect(graph.nodes.get("same")?.parentId).toBeNull();
    expect(graph.diagnostics.map((item) => item.code)).toEqual(
      expect.arrayContaining(["duplicate-id", "conflicting-duplicate"])
    );
  });

  test("keeps orphan and empty-label components while excluding empty identities", () => {
    const graph = buildHierarchy([
      { nodeId: "orphan", parentId: "missing", label: "Orphan" },
      { nodeId: "empty-label", parentId: null, label: " " },
      { nodeId: "", parentId: null, label: "Invalid" },
      { nodeId: null, parentId: null, label: "Invalid" }
    ]);

    expect(graph.nodes.get("orphan")?.parentId).toBeNull();
    expect(graph.nodes.get("empty-label")?.label).toBe("Unnamed node");
    expect(graph.roots).toEqual(["empty-label", "orphan"]);
    expect(graph.diagnostics.map((item) => item.code)).toEqual(
      expect.arrayContaining(["empty-id", "empty-label", "orphan"])
    );
    expect(graph.excludedCount).toBe(2);
  });

  test("breaks self and long cycles without dropping the component", () => {
    const graph = buildHierarchy([
      { nodeId: "self", parentId: "self", label: "Self" },
      { nodeId: "z", parentId: "y", label: "Z" },
      { nodeId: "x", parentId: "z", label: "X" },
      { nodeId: "y", parentId: "x", label: "Y" }
    ]);

    expect(graph.nodes.size).toBe(4);
    expect(graph.nodes.get("self")?.parentId).toBeNull();
    expect(graph.roots).toContain("x");
    expect(graph.diagnostics.map((item) => item.code)).toEqual(
      expect.arrayContaining(["self-cycle", "cycle"])
    );
  });

  test("reports missing required roles, truncation, node caps, and depth caps", () => {
    const graph = buildHierarchy(
      {
        rows: [
          { nodeId: "a", parentId: null, label: "A" },
          { nodeId: "b", parentId: "a", label: "B" },
          { nodeId: "c", parentId: "b", label: "C" }
        ],
        receivedCount: 30_005,
        truncated: true,
        rolesPresent: { NodeId: true, ParentId: false, Label: true }
      },
      { nodeCap: 2, depthCap: 0 }
    );

    expect(graph.nodes.size).toBe(1);
    expect(graph.diagnostics.map((item) => item.code)).toEqual(
      expect.arrayContaining(["missing-required-fields", "data-reduction", "node-cap", "depth-cap"])
    );
    expect(graph.excludedCount).toBeGreaterThan(0);
    expect(graph.nodes.get("b")).toBeUndefined();
  });

  test("recomputes depth after capped ancestors are promoted to roots", () => {
    const graph = buildHierarchy(
      [
        { nodeId: "z-root", parentId: null, label: "Root" },
        { nodeId: "a-child", parentId: "z-root", label: "Child" }
      ],
      { nodeCap: 1 }
    );

    expect(graph.roots).toEqual(["a-child"]);
    expect(graph.nodes.get("a-child")?.depth).toBe(0);
  });

  test("layout is bounded, stable, and mirrors in RTL", () => {
    const graph = buildHierarchy([
      { nodeId: "root", parentId: null, label: "Root" },
      { nodeId: "child", parentId: "root", label: "Child" }
    ]);
    const ids = flattenVisibleIds(graph, new Set());
    const ltr = computeLayout(graph, ids, { width: 220, height: 120, direction: "ltr" });
    const rtl = computeLayout(graph, ids, { width: 220, height: 120, direction: "rtl" });

    expect(ltr.points.get("root")?.x).toBeLessThan(ltr.points.get("child")?.x ?? 0);
    expect(rtl.points.get("root")?.x).toBeGreaterThan(rtl.points.get("child")?.x ?? 0);
    expect(ltr.width).toBeGreaterThanOrEqual(220);
    expect(ltr.height).toBeGreaterThanOrEqual(120);
    const formatted = computeLayout(graph, ids, {
      width: 220,
      height: 120,
      direction: "ltr",
      nodeWidth: 96,
      nodeHeight: 32
    });
    expect(formatted.points.get("root")?.width).toBe(96);
    expect(formatted.points.get("root")?.height).toBe(32);
  });
});
