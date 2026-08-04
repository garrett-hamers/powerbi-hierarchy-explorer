import { Visual } from "../src/visual";

interface HostHarness {
  host: Record<string, unknown>;
  selectionManager: {
    select: jest.Mock;
    clear: jest.Mock;
    showContextMenu: jest.Mock;
  };
  selectionIds: Array<{ key: string }>;
}

interface SelectionBuilder {
  withTable: jest.Mock;
  createSelectionId: jest.Mock;
}

function makeHost(locale = "en-US", highContrast = false): HostHarness {
  const selectionIds: Array<{ key: string }> = [];
  const selectionManager = {
    select: jest.fn().mockResolvedValue(undefined),
    clear: jest.fn().mockResolvedValue(undefined),
    showContextMenu: jest.fn().mockResolvedValue(undefined),
    registerOnSelectCallback: jest.fn()
  };
  const host = {
    locale,
    colorPalette: {
      isHighContrast: highContrast,
      foreground: { value: "#f0f0f0" },
      background: { value: "#101010" },
      foregroundSelected: { value: "#00ff00" }
    },
    createSelectionManager: jest.fn(() => selectionManager),
    createSelectionIdBuilder: jest.fn(() => {
      let rowIndex: number | undefined;
      const builder: SelectionBuilder = {
        withTable: jest.fn(),
        createSelectionId: jest.fn()
      };
      builder.withTable.mockImplementation((_table: unknown, index: number) => {
          rowIndex = index;
          return builder;
        });
      builder.createSelectionId.mockImplementation(() => {
        const selectionId = { key: rowIndex === undefined ? "empty" : `row-${rowIndex}` };
        selectionIds.push(selectionId);
        return selectionId;
      });
      return builder;
    }),
    createLocalizationManager: jest.fn(() => ({
      getDisplayName: jest.fn((key: string) => (locale.startsWith("ar") && key === "UI_Search" ? "بحث" : key))
    })),
    tooltipService: {
      show: jest.fn().mockResolvedValue(undefined),
      hide: jest.fn().mockResolvedValue(undefined)
    },
    eventService: {
      renderingStarted: jest.fn(),
      renderingFinished: jest.fn(),
      renderingFailed: jest.fn()
    }
  };
  return { host, selectionManager, selectionIds };
}

function tableDataView(rows = [
  ["a", null, "A", "Root", "first"],
  ["b", "a", "B", "Child", "second"],
  ["c", "a", "C", "Child", "third"]
]) {
  return {
    table: {
      columns: [
        { displayName: "Node", roles: { NodeId: true } },
        { displayName: "Parent", roles: { ParentId: true } },
        { displayName: "Label", roles: { Label: true } },
        { displayName: "Role", roles: { Subtitle: true } },
        { displayName: "Details", roles: { Tooltips: true } }
      ],
      rows
    }
  };
}

function updateVisual(
  host: Record<string, unknown>,
  dataView: Record<string, unknown>,
  viewport = { width: 400, height: 300 }
) {
  const element = document.createElement("div");
  const visual = new Visual({ element, host } as any);
  visual.update({ dataViews: [dataView], viewport } as any);
  return { element, visual };
}

describe("Visual interactions and lifecycle", () => {
  test("keeps the caret in the search box while typing", () => {
    const { host } = makeHost();
    // Focus only moves for elements attached to the document in jsdom.
    const element = document.createElement("div");
    document.body.appendChild(element);
    const visual = new Visual({ element, host } as any);
    visual.update({ dataViews: [tableDataView()], viewport: { width: 400, height: 300 } } as any);
    const search = element.querySelector(".atlyn-search") as HTMLInputElement;

    // Search reveals the first match on every keystroke. It must not pull DOM
    // focus into the tree, or the caret leaves the box after one character.
    search.focus();
    for (const character of "Chi") {
      search.value += character;
      search.dispatchEvent(new Event("input", { bubbles: true }));
      expect(document.activeElement).toBe(search);
    }

    expect(search.value).toBe("Chi");
    expect(element.querySelectorAll('[data-search-match="true"]').length).toBe(2);
    visual.destroy();
    element.remove();
  });

  test("keeps the accessible tree beside the canvas rather than inside it", () => {
    const { host } = makeHost();
    const { element, visual } = updateVisual(host, tableDataView());
    const tree = element.querySelector('[role="tree"]') as HTMLElement;
    const canvas = element.querySelector(".atlyn-canvas-wrap") as HTMLElement;

    // Nested inside the scrolling canvas the focused tree renders below the
    // full-height graph, pushing it outside the clipped bounds of the visual.
    expect(canvas.contains(tree)).toBe(false);
    expect(tree.parentElement).toBe(element.querySelector(".atlyn-root"));
    visual.destroy();
  });

  test("uses one semantic tree and documented selection/context-menu contracts", () => {
    const { host, selectionManager } = makeHost();
    const { element, visual } = updateVisual(host, tableDataView());

    expect(element.querySelectorAll('[role="tree"]').length).toBe(1);
    expect(element.querySelector('[role="tree"]')?.getAttribute("aria-label")).toBe("Hierarchy tree");
    expect(element.querySelector(".atlyn-graph")?.getAttribute("aria-hidden")).toBe("true");
    expect(element.querySelectorAll('[role="treeitem"]').length).toBe(3);
    expect((host.eventService as any).renderingStarted).toHaveBeenCalled();
    expect((host.eventService as any).renderingFinished).toHaveBeenCalled();

    const child = element.querySelector('[data-semantic-node-id="b"]') as HTMLElement;
    child.click();
    expect(selectionManager.select).toHaveBeenCalledWith({ key: "row-1" }, false);

    const node = element.querySelector('[data-node-id="a"]') as Element;
    node.dispatchEvent(new MouseEvent("mouseenter", { clientX: 10, clientY: 20 }));
    expect((host.tooltipService as any).show).toHaveBeenCalledWith(
      expect.objectContaining({
        identities: [{ key: "row-0" }],
        dataItems: expect.arrayContaining([
          expect.objectContaining({ displayName: "Retained table row", value: "1" })
        ])
      })
    );

    node.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 20 }));
    expect(selectionManager.showContextMenu).toHaveBeenCalledWith({ key: "row-0" }, { x: 10, y: 20 });

    const canvas = element.querySelector(".atlyn-canvas-wrap") as Element;
    canvas.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 30, clientY: 40 }));
    expect(selectionManager.showContextMenu).toHaveBeenCalledWith({ key: "empty" }, { x: 30, y: 40 });

    child.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 50, clientY: 60 }));
    expect(selectionManager.showContextMenu).toHaveBeenCalledWith({ key: "row-1" }, { x: 50, y: 60 });
    visual.destroy();
  });

  test("retains first duplicate row identity and never selects a conflicting row", () => {
    const { host, selectionManager } = makeHost();
    const { element, visual } = updateVisual(
      host,
      tableDataView([
        ["same", null, "First", "retained", "first tooltip"],
        ["same", "other", "Later", "conflict", "conflicting tooltip"],
        ["other", null, "Other", "", "other tooltip"]
      ])
    );

    const retained = element.querySelector('[data-semantic-node-id="same"]') as HTMLElement;
    expect(retained.textContent).toContain("First");
    expect(element.textContent).toContain("Conflicting duplicate NodeId rows are never selectable");
    retained.click();
    expect(selectionManager.select).toHaveBeenCalledWith({ key: "row-0" }, false);
    expect(selectionManager.select).not.toHaveBeenCalledWith({ key: "row-1" }, expect.anything());

    const svgNode = element.querySelector('[data-node-id="same"]') as Element;
    svgNode.dispatchEvent(new MouseEvent("mouseenter", { clientX: 1, clientY: 2 }));
    expect((host.tooltipService as any).show).toHaveBeenLastCalledWith(
      expect.objectContaining({ identities: [{ key: "row-0" }] })
    );
    visual.destroy();
  });

  test("supports collapse, keyboard tree navigation, and cleanup", () => {
    const { host } = makeHost();
    const { element, visual } = updateVisual(host, tableDataView());

    const toggle = element.querySelector(".atlyn-semantic-toggle") as HTMLButtonElement;
    toggle.click();
    expect(element.querySelectorAll('[role="treeitem"]').length).toBe(1);
    expect(element.querySelector('[data-semantic-node-id="a"]')?.getAttribute("aria-expanded")).toBe("false");

    const rootItem = element.querySelector('[data-semantic-node-id="a"]') as HTMLElement;
    rootItem.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(element.querySelectorAll('[role="treeitem"]').length).toBe(3);
    const expandedRoot = element.querySelector('[data-semantic-node-id="a"]') as HTMLElement;
    expandedRoot.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(element.querySelector('[data-semantic-node-id="b"]')?.getAttribute("tabindex")).toBe("0");
    expandedRoot.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    visual.destroy();
    expect(element.querySelector(".atlyn-root")).toBeNull();
    expect((host.eventService as any).renderingFailed).not.toHaveBeenCalled();
  });

  test("localizes, mirrors RTL geometry, and uses the host high-contrast palette", () => {
    const { host } = makeHost("ar-SA", true);
    const { element, visual } = updateVisual(host, tableDataView());

    const root = element.querySelector(".atlyn-root") as HTMLElement;
    expect(root.dir).toBe("rtl");
    expect(root.dataset.highContrast).toBe("true");
    expect(root.style.getPropertyValue("--atlyn-background")).toBe("#101010");
    expect(root.style.getPropertyValue("--atlyn-selected")).toBe("#00ff00");
    expect(element.querySelector(".atlyn-search")?.getAttribute("aria-label")).toBe("بحث");
    expect(element.querySelector(".atlyn-node-label")?.getAttribute("text-anchor")).toBe("end");
    visual.destroy();
  });

  test("shows bounded segment diagnostics and handles empty, partial, and matrix data", () => {
    const { host } = makeHost();
    const segmented = tableDataView();
    (segmented as any).metadata = { segment: { objects: [] } };
    const segmentedResult = updateVisual(host, segmented);
    expect(segmentedResult.element.textContent).toContain("bounded contract");
    segmentedResult.visual.destroy();

    const partial = {
      table: {
        columns: [
          { displayName: "Node", roles: { NodeId: true } },
          { displayName: "Label", roles: { Label: true } }
        ],
        rows: [["a", "A"]]
      }
    };
    const partialResult = updateVisual(host, partial);
    expect(partialResult.element.textContent).toContain("Required field(s) missing: ParentId");
    partialResult.visual.destroy();

    const emptyResult = updateVisual(host, {} as Record<string, unknown>);
    expect(emptyResult.element.querySelector(".atlyn-empty")?.textContent).toContain("Add NodeId");
    emptyResult.visual.destroy();

    const matrixResult = updateVisual(host, { matrix: { rows: [] } });
    expect(matrixResult.element.textContent).toContain("Matrix mode is not enabled");
    matrixResult.visual.destroy();
  });

  test("accumulates host segments and requests more data under a bounded contract", () => {
    const { host } = makeHost();
    const fetchMoreData = jest.fn().mockReturnValue(true);
    (host as any).fetchMoreData = fetchMoreData;
    const first = tableDataView([["a", null, "A", "", "first"]]);
    (first as any).metadata = { segment: { objects: [] } };
    const result = updateVisual(host, first);

    expect(fetchMoreData).toHaveBeenCalledWith(false);
    expect(result.element.textContent).toContain("loading more data");

    const second = tableDataView([["b", "a", "B", "", "second"]]);
    result.visual.update({ dataViews: [second], viewport: { width: 400, height: 300 }, operationKind: 1 } as any);
    expect(result.element.querySelectorAll('[role="treeitem"]')).toHaveLength(2);
    expect(result.element.querySelector('[data-semantic-node-id="b"]')).not.toBeNull();
    result.visual.destroy();
  });

  test("rejects invalid required cardinality and exposes a diagnostic", () => {
    const { host } = makeHost();
    const invalid = {
      table: {
        columns: [
          { displayName: "Node 1", roles: { NodeId: true } },
          { displayName: "Node 2", roles: { NodeId: true } },
          { displayName: "Parent", roles: { ParentId: true } },
          { displayName: "Label", roles: { Label: true } }
        ],
        rows: [["a", "a", null, "A"]]
      }
    };
    const result = updateVisual(host, invalid);

    expect(result.element.querySelectorAll('[role="treeitem"]')).toHaveLength(0);
    expect(result.element.textContent).toContain("NodeId accepts at most 1 field");
    result.visual.destroy();
  });

  test("gates host interactions and completes the tooltip lifecycle", () => {
    const { host, selectionManager } = makeHost();
    const tooltipService = host.tooltipService as any;
    tooltipService.enabled = jest.fn().mockReturnValue(true);
    tooltipService.move = jest.fn();
    (host as any).hostCapabilities = { allowInteractions: false };
    const disabled = updateVisual(host, tableDataView());
    const disabledNode = disabled.element.querySelector('[data-node-id="a"]') as Element;
    disabledNode.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    disabledNode.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true, clientX: 1, clientY: 2 }));
    expect(disabled.element.querySelector('[role="tree"]')?.getAttribute("aria-disabled")).toBe("true");
    expect(selectionManager.select).not.toHaveBeenCalled();
    expect(tooltipService.show).not.toHaveBeenCalled();
    disabled.visual.destroy();

    const enabledHost = makeHost().host;
    const enabledTooltip = enabledHost.tooltipService as any;
    enabledTooltip.enabled = jest.fn().mockReturnValue(true);
    enabledTooltip.move = jest.fn();
    const enabled = updateVisual(enabledHost, tableDataView());
    const enabledNode = enabled.element.querySelector('[data-node-id="a"]') as Element;
    enabledNode.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true, clientX: 1, clientY: 2 }));
    enabledNode.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 3, clientY: 4 }));
    enabledNode.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
    expect(enabledTooltip.show).toHaveBeenCalled();
    expect(enabledTooltip.move).toHaveBeenCalledWith(
      expect.objectContaining({ coordinates: [3, 4], isTouchEvent: false })
    );
    expect(enabledTooltip.hide).toHaveBeenCalled();
    enabled.visual.destroy();
  });

  test("restores semantic focus after a data rerender", () => {
    const { host } = makeHost();
    const result = updateVisual(host, tableDataView());
    document.body.appendChild(result.element);
    const item = result.element.querySelector('[data-semantic-node-id="b"]') as HTMLElement;
    item.focus();
    result.visual.update({ dataViews: [tableDataView()], viewport: { width: 400, height: 300 } } as any);
    const refreshed = result.element.querySelector('[data-semantic-node-id="b"]') as HTMLElement;

    expect(refreshed.tabIndex).toBe(0);
    expect(document.activeElement).toBe(refreshed);
    result.visual.destroy();
    result.element.remove();
  });

  test("opens context menus from touch long press", () => {
    jest.useFakeTimers();
    try {
      const { host, selectionManager } = makeHost();
      const { element, visual } = updateVisual(host, tableDataView());
      const node = element.querySelector('[data-node-id="a"]') as Element;
      const start = new Event("touchstart", { bubbles: true });
      Object.defineProperty(start, "touches", { value: [{ clientX: 7, clientY: 8 }] });
      node.dispatchEvent(start);
      jest.advanceTimersByTime(550);
      expect(selectionManager.showContextMenu).toHaveBeenCalledWith({ key: "row-0" }, { x: 7, y: 8 });
      visual.destroy();
    } finally {
      jest.useRealTimers();
    }
  });

  test("does not open an empty-space menu for semantic-tree long press", () => {
    jest.useFakeTimers();
    try {
      const { host, selectionManager } = makeHost();
      const { element, visual } = updateVisual(host, tableDataView());
      const node = element.querySelector('[data-semantic-node-id="a"]') as Element;
      const start = new Event("touchstart", { bubbles: true });
      Object.defineProperty(start, "touches", { value: [{ clientX: 9, clientY: 10 }] });
      node.dispatchEvent(start);
      jest.advanceTimersByTime(550);
      expect(selectionManager.showContextMenu).toHaveBeenCalledTimes(1);
      expect(selectionManager.showContextMenu).toHaveBeenCalledWith({ key: "row-0" }, { x: 9, y: 10 });
      visual.destroy();
    } finally {
      jest.useRealTimers();
    }
  });
});
