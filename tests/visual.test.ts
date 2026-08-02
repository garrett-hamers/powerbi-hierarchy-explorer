import { Visual } from "../src/visual";

function makeHost() {
  const selectionManager = {
    select: jest.fn().mockResolvedValue(undefined),
    clear: jest.fn().mockResolvedValue(undefined)
  };
  const host = {
    locale: "en-US",
    colorPalette: { isHighContrast: false },
    createSelectionManager: jest.fn(() => selectionManager),
    createSelectionIdBuilder: jest.fn(() => ({
      withTable: jest.fn().mockReturnThis(),
      createSelectionId: jest.fn(() => ({ key: "node-row" }))
    })),
    tooltipService: {
      show: jest.fn().mockResolvedValue(undefined),
      hide: jest.fn().mockResolvedValue(undefined)
    },
    contextMenuService: {
      show: jest.fn().mockResolvedValue(undefined)
    },
    eventService: {
      renderingStarted: jest.fn(),
      renderingFinished: jest.fn(),
      renderingFailed: jest.fn()
    }
  };
  return { host, selectionManager };
}

function tableDataView() {
  return {
    table: {
      columns: [
        { displayName: "Node", roles: { NodeId: true } },
        { displayName: "Parent", roles: { ParentId: true } },
        { displayName: "Label", roles: { Label: true } },
        { displayName: "Role", roles: { Subtitle: true } },
        { displayName: "Details", roles: { Tooltips: true } }
      ],
      rows: [
        ["a", null, "A", "Root", "first"],
        ["b", "a", "B", "Child", "second"],
        ["c", "a", "C", "Child", "third"]
      ]
    }
  };
}

describe("Visual interactions and lifecycle", () => {
  test("renders diagnostics, semantic tree, search, selection, tooltip, and context menu", () => {
    const { host, selectionManager } = makeHost();
    const element = document.createElement("div");
    const visual = new Visual({ element, host } as any);
    visual.update({ dataViews: [tableDataView()], viewport: { width: 400, height: 300 } } as any);

    expect(element.querySelector('[role="tree"]')).not.toBeNull();
    expect(element.querySelectorAll('[role="treeitem"]').length).toBeGreaterThanOrEqual(3);
    expect(host.eventService.renderingStarted).toHaveBeenCalled();
    expect(host.eventService.renderingFinished).toHaveBeenCalled();

    const label = Array.from(element.querySelectorAll(".atlyn-semantic-label")).find(
      (item) => item.textContent?.startsWith("B")
    ) as HTMLButtonElement;
    label.click();
    expect(selectionManager.select).toHaveBeenCalled();

    const search = element.querySelector(".atlyn-search") as HTMLInputElement;
    search.value = "C";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    expect(element.querySelector('[data-node-id="c"]')).not.toBeNull();

    const node = element.querySelector('[data-node-id="a"]') as Element;
    node.dispatchEvent(new MouseEvent("mouseenter", { clientX: 10, clientY: 20 }));
    node.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 20 }));
    expect(host.tooltipService.show).toHaveBeenCalled();
    expect(host.contextMenuService.show).toHaveBeenCalled();
  });

  test("supports collapse and keyboard tree navigation and cleans up", () => {
    const { host } = makeHost();
    const element = document.createElement("div");
    const visual = new Visual({ element, host } as any);
    visual.update({ dataViews: [tableDataView()], viewport: { width: 400, height: 300 } } as any);

    const toggle = element.querySelector(".atlyn-semantic-toggle") as HTMLButtonElement;
    toggle.click();
    expect(element.querySelectorAll('[role="treeitem"]').length).toBe(2);
    const rootItem = element.querySelector('[data-semantic-node-id="a"]') as HTMLElement;
    rootItem.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    rootItem.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    visual.destroy();
    expect(element.querySelector(".atlyn-root")).toBeNull();
  });
});
