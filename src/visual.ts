import type powerbi from "powerbi-visuals-api";
import {
  buildHierarchy,
  Diagnostic,
  flattenVisibleIds,
  getAncestorIds,
  getDescendantIds,
  GraphModel,
  HierarchyRow,
  normalizeId,
  TABLE_ROW_CAP
} from "./graph";
import { computeLayout, LayoutResult } from "./layout";
import { getLocaleStrings, isRtlLocale, LocalizedStrings } from "./localization";

type VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;

interface TableColumn {
  displayName?: string;
  queryName?: string;
  roles?: Record<string, boolean>;
}

interface ParsedTable {
  rows: HierarchyRow[];
  rolesPresent: Partial<Record<"NodeId" | "ParentId" | "Label", boolean>>;
  selectionIds: Map<string, unknown>;
  receivedCount: number;
  truncated: boolean;
}

const ROLE_ORDER = ["NodeId", "ParentId", "Label", "Subtitle", "Category", "Value", "Tooltips"] as const;

export class Visual implements powerbi.extensibility.visual.IVisual {
  public readonly allowInteractions = true;
  private readonly host: any;
  private readonly root: HTMLDivElement;
  private readonly toolbar: HTMLDivElement;
  private readonly searchInput: HTMLInputElement;
  private readonly status: HTMLDivElement;
  private readonly diagnosticsElement: HTMLDivElement;
  private readonly breadcrumbElement: HTMLElement;
  private readonly canvasWrap: HTMLDivElement;
  private readonly graphSvg: SVGSVGElement;
  private readonly semanticTree: HTMLDivElement;
  private readonly selectDescendantsButton: HTMLButtonElement;
  private readonly clearSelectionButton: HTMLButtonElement;
  private strings: LocalizedStrings;
  private readonly cleanup: Array<() => void> = [];
  private readonly selectionManager: any;
  private graph: GraphModel = buildHierarchy([]);
  private selectionIds = new Map<string, unknown>();
  private collapsed = new Set<string>();
  private selected = new Set<string>();
  private semanticItems = new Map<string, HTMLElement>();
  private focusedId: string | null = null;
  private searchQuery = "";
  private locale: string;
  private direction: "ltr" | "rtl";
  private destroyed = false;
  private lastUpdateOptions: any;

  constructor(options?: VisualConstructorOptions) {
    if (!options) {
      throw new Error("Atlyn Hierarchy Explorer requires a visual host element.");
    }
    this.host = options.host;
    this.selectionManager = this.host.createSelectionManager?.();
    this.host.createLocalizationManager?.();
    this.locale = this.host.locale ?? "en-US";
    this.direction = isRtlLocale(this.locale) ? "rtl" : "ltr";
    this.strings = getLocaleStrings(this.locale);
    this.root = document.createElement("div");
    this.root.className = "atlyn-root";
    this.root.dir = this.direction;
    this.root.setAttribute("role", "application");
    this.root.setAttribute("aria-label", "Atlyn Hierarchy Explorer");
    this.root.dataset.highContrast = String(this.host.colorPalette?.isHighContrast === true);
    options.element.appendChild(this.root);

    this.toolbar = document.createElement("div");
    this.toolbar.className = "atlyn-toolbar";
    this.toolbar.setAttribute("role", "toolbar");
    this.searchInput = document.createElement("input");
    this.searchInput.className = "atlyn-search";
    this.searchInput.type = "search";
    this.searchInput.placeholder = this.strings.searchPlaceholder;
    this.searchInput.setAttribute("aria-label", this.strings.searchLabel);
    this.searchInput.addEventListener("input", this.onSearchInput);
    this.cleanup.push(() => this.searchInput.removeEventListener("input", this.onSearchInput));
    const searchLabel = document.createElement("label");
    searchLabel.textContent = `${this.strings.searchLabel}:`;
    searchLabel.htmlFor = "atlyn-hierarchy-search";
    this.searchInput.id = "atlyn-hierarchy-search";
    this.toolbar.append(searchLabel, this.searchInput);

    this.selectDescendantsButton = this.createButton(this.strings.selectDescendants, () => {
      this.selectDescendants();
    });
    this.selectDescendantsButton.disabled = true;
    this.selectDescendantsButton.classList.add("atlyn-select-descendants");
    this.clearSelectionButton = this.createButton(this.strings.clearSelection, () => {
      this.clearSelection();
    });
    this.toolbar.append(this.selectDescendantsButton, this.clearSelectionButton);
    this.root.appendChild(this.toolbar);

    this.status = document.createElement("div");
    this.status.className = "atlyn-status";
    this.status.setAttribute("role", "status");
    this.status.setAttribute("aria-live", "polite");
    this.root.appendChild(this.status);

    this.diagnosticsElement = document.createElement("div");
    this.diagnosticsElement.className = "atlyn-diagnostics";
    this.diagnosticsElement.setAttribute("role", "region");
    this.diagnosticsElement.setAttribute("aria-label", this.strings.diagnostics);
    this.root.appendChild(this.diagnosticsElement);

    this.breadcrumbElement = document.createElement("nav");
    this.breadcrumbElement.className = "atlyn-breadcrumb";
    this.breadcrumbElement.setAttribute("aria-label", this.strings.breadcrumb);
    this.root.appendChild(this.breadcrumbElement);

    this.canvasWrap = document.createElement("div");
    this.canvasWrap.className = "atlyn-canvas-wrap";
    this.canvasWrap.addEventListener("contextmenu", this.onCanvasContextMenu);
    this.cleanup.push(() => this.canvasWrap.removeEventListener("contextmenu", this.onCanvasContextMenu));
    this.canvasWrap.addEventListener("click", this.onCanvasClick);
    this.cleanup.push(() => this.canvasWrap.removeEventListener("click", this.onCanvasClick));
    this.graphSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.graphSvg.classList.add("atlyn-graph");
    this.graphSvg.setAttribute("role", "img");
    this.graphSvg.setAttribute("aria-label", "Hierarchy graph");
    this.canvasWrap.appendChild(this.graphSvg);
    this.semanticTree = document.createElement("div");
    this.semanticTree.className = "atlyn-semantic-tree";
    this.semanticTree.setAttribute("role", "tree");
    this.semanticTree.setAttribute("aria-label", "Hierarchy list");
    this.canvasWrap.appendChild(this.semanticTree);
    this.root.appendChild(this.canvasWrap);

    this.root.addEventListener("keydown", this.onRootKeyDown);
    this.cleanup.push(() => this.root.removeEventListener("keydown", this.onRootKeyDown));
    this.render();
  }

  public update(options: powerbi.extensibility.visual.VisualUpdateOptions): void {
    if (this.destroyed) {
      return;
    }
    this.lastUpdateOptions = options;
    this.fireRenderingEvent("renderingStarted", options);
    try {
      const locale = this.host.locale ?? this.locale;
      this.locale = locale;
      this.direction = isRtlLocale(locale) ? "rtl" : "ltr";
      this.strings = getLocaleStrings(locale);
      this.searchInput.placeholder = this.strings.searchPlaceholder;
      const searchLabel = this.toolbar.querySelector("label");
      if (searchLabel) {
        searchLabel.textContent = `${this.strings.searchLabel}:`;
      }
      this.selectDescendantsButton.textContent = this.strings.selectDescendants;
      this.clearSelectionButton.textContent = this.strings.clearSelection;
      this.diagnosticsElement.setAttribute("aria-label", this.strings.diagnostics);
      this.root.dir = this.direction;
      this.root.dataset.highContrast = String(this.host.colorPalette?.isHighContrast === true);
      const dataView: any = (options as any).dataViews?.[0];
      const table: any = dataView?.table;
      if (table) {
        const parsed = this.parseTable(table);
        this.graph = buildHierarchy(
          {
            rows: parsed.rows,
            receivedCount: parsed.receivedCount,
            truncated: parsed.truncated,
            rolesPresent: parsed.rolesPresent
          },
          { nodeCap: 10000, depthCap: 50 }
        );
        this.graph.nodes.forEach((node) => {
          if (node.qualityFlags.includes("empty-label")) {
            node.label = this.strings.unnamed;
          }
        });
        this.selectionIds = parsed.selectionIds;
      } else {
        this.graph = buildHierarchy({
          rows: [],
          rolesPresent: { NodeId: false, ParentId: false, Label: false }
        });
        this.selectionIds.clear();
      }
      this.selected = new Set(Array.from(this.selected).filter((id) => this.graph.nodes.has(id)));
      this.collapsed = new Set(Array.from(this.collapsed).filter((id) => this.graph.nodes.has(id)));
      this.render();
      this.fireRenderingEvent("renderingFinished", options);
    } catch (error) {
      this.showRenderFailure(error);
      this.fireRenderingEvent("renderingFailed", options, error);
    }
  }

  public destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.cleanup.splice(0).forEach((dispose) => dispose());
    this.root.remove();
    this.selectionIds.clear();
    this.selected.clear();
    this.collapsed.clear();
    this.semanticItems.clear();
  }

  public getFormattingModel(): any {
    return { cards: [] };
  }

  private createButton(label: string, handler: () => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.className = "atlyn-button";
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", handler);
    this.cleanup.push(() => button.removeEventListener("click", handler));
    return button;
  }

  private parseTable(table: any): ParsedTable {
    const columns: TableColumn[] = Array.isArray(table.columns) ? table.columns : [];
    const rows: any[][] = Array.isArray(table.rows) ? table.rows : [];
    const roleIndices = new Map<string, number[]>();
    ROLE_ORDER.forEach((role) => {
      roleIndices.set(
        role,
        columns.reduce<number[]>((indices, column, index) => {
          if (column?.roles?.[role]) {
            indices.push(index);
          }
          return indices;
        }, [])
      );
    });
    const rolesPresent = {
      NodeId: (roleIndices.get("NodeId")?.length ?? 0) > 0,
      ParentId: (roleIndices.get("ParentId")?.length ?? 0) > 0,
      Label: (roleIndices.get("Label")?.length ?? 0) > 0
    };
    const valueAt = (row: any[], role: string): unknown => {
      const index = roleIndices.get(role)?.[0];
      return index === undefined ? undefined : row[index];
    };
    const tooltipIndices = roleIndices.get("Tooltips") ?? [];
    const selectionIds = new Map<string, unknown>();
    const parsedRows = rows.map((row, index) => {
      const tooltips: Record<string, unknown> = {};
      tooltipIndices.forEach((columnIndex) => {
        tooltips[columns[columnIndex]?.displayName ?? `Tooltip ${columnIndex + 1}`] = row[columnIndex];
      });
      const nodeId = valueAt(row, "NodeId");
      const selectionId = this.createSelectionId(table, index);
      const normalizedNodeId = normalizeId(nodeId);
      if (selectionId !== undefined && normalizedNodeId) {
        selectionIds.set(normalizedNodeId, selectionId);
      }
      const highlighted =
        (row as any).highlighted === true ||
        (row as any).highlight === true ||
        Array.isArray((row as any).objects) &&
          (row as any).objects.some((object: any) => object?.highlighted === true || object?.highlight === true) ||
        Array.isArray(table.highlights) && table.highlights[index] !== undefined;
      return {
        nodeId,
        parentId: valueAt(row, "ParentId"),
        label: valueAt(row, "Label"),
        subtitle: valueAt(row, "Subtitle"),
        category: valueAt(row, "Category"),
        value: valueAt(row, "Value"),
        tooltips,
        sourceRow: index,
        highlighted
      };
    });
    return {
      rows: parsedRows,
      rolesPresent,
      selectionIds,
      receivedCount: rows.length,
      truncated: rows.length >= TABLE_ROW_CAP
    };
  }

  private createSelectionId(table: any, rowIndex: number): unknown {
    try {
      const builder = this.host.createSelectionIdBuilder?.();
      if (!builder) {
        return undefined;
      }
      return builder.withTable(table, rowIndex).createSelectionId();
    } catch {
      return undefined;
    }
  }

  private render(): void {
    if (this.destroyed) {
      return;
    }
    const visibleIds = flattenVisibleIds(this.graph, this.collapsed);
    this.graphSvg.replaceChildren();
    this.semanticTree.replaceChildren();
    this.semanticItems.clear();
    const width = Math.max(160, (this.lastUpdateOptions as any)?.viewport?.width ?? this.canvasWrap.clientWidth ?? 320);
    const height = Math.max(150, (this.lastUpdateOptions as any)?.viewport?.height ?? 280);
    const layout = computeLayout(this.graph, visibleIds, {
      width,
      height,
      direction: this.direction
    });
    this.graphSvg.setAttribute("viewBox", `0 0 ${layout.width} ${layout.height}`);
    this.graphSvg.setAttribute("width", String(layout.width));
    this.graphSvg.setAttribute("height", String(layout.height));
    this.renderEdges(layout, visibleIds);
    visibleIds.forEach((id) => this.renderSvgNode(id, layout));
    this.renderSemanticTree(visibleIds);
    this.renderDiagnostics();
    this.renderBreadcrumb();
    this.renderStatus(visibleIds.length);
    const activeId = this.focusedId && this.graph.nodes.has(this.focusedId) ? this.focusedId : visibleIds[0];
    this.selectDescendantsButton.disabled = !activeId;
    if (activeId) {
      this.semanticItems.get(activeId)?.focus({ preventScroll: true });
    }
  }

  private renderEdges(layout: LayoutResult, visibleIds: readonly string[]): void {
    const visible = new Set(visibleIds);
    visibleIds.forEach((id) => {
      const node = this.graph.nodes.get(id);
      const point = layout.points.get(id);
      if (!node?.parentId || !visible.has(node.parentId) || !point) {
        return;
      }
      const parentPoint = layout.points.get(node.parentId);
      if (!parentPoint) {
        return;
      }
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.classList.add("atlyn-edge");
      line.setAttribute("x1", String(parentPoint.x + parentPoint.width / 2));
      line.setAttribute("y1", String(parentPoint.y + parentPoint.height));
      line.setAttribute("x2", String(point.x + point.width / 2));
      line.setAttribute("y2", String(point.y));
      this.graphSvg.appendChild(line);
    });
  }

  private renderSvgNode(id: string, layout: LayoutResult): void {
    const node = this.graph.nodes.get(id);
    const point = layout.points.get(id);
    if (!node || !point) {
      return;
    }
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.classList.add("atlyn-node");
    group.setAttribute("role", "treeitem");
    group.setAttribute("tabindex", this.focusedId === id ? "0" : "-1");
    group.setAttribute("aria-level", String(node.depth + 1));
    group.setAttribute("aria-selected", String(this.selected.has(id)));
    group.setAttribute("aria-expanded", String(node.children.length > 0 && !this.collapsed.has(id)));
    group.setAttribute("aria-label", this.nodeAriaLabel(node));
    group.dataset.nodeId = id;
    group.addEventListener("click", (event) => this.onNodeClick(id, event as MouseEvent));
    group.addEventListener("dblclick", (event) => {
      event.preventDefault();
      this.toggleCollapsed(id);
    });
    group.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      this.showContextMenu(id, event.clientX, event.clientY);
    });
    group.addEventListener("mouseenter", (event) => this.showTooltip(id, event.clientX, event.clientY));
    group.addEventListener("mouseleave", () => this.hideTooltip());

    const card = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    card.classList.add("atlyn-node-card");
    card.dataset.selected = String(this.selected.has(id));
    card.dataset.highlighted = String(node.highlighted);
    card.dataset.searchMatch = String(this.matchesSearch(node));
    card.setAttribute("x", String(point.x));
    card.setAttribute("y", String(point.y));
    card.setAttribute("width", String(point.width));
    card.setAttribute("height", String(point.height));
    card.setAttribute("rx", "4");
    group.appendChild(card);
    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.classList.add("atlyn-node-label");
    label.setAttribute("x", String(point.x + 8));
    label.setAttribute("y", String(point.y + 19));
    label.textContent = node.label;
    group.appendChild(label);
    if (node.subtitle) {
      const subtitle = document.createElementNS("http://www.w3.org/2000/svg", "text");
      subtitle.classList.add("atlyn-node-subtitle");
      subtitle.setAttribute("x", String(point.x + 8));
      subtitle.setAttribute("y", String(point.y + 36));
      subtitle.textContent = node.subtitle;
      group.appendChild(subtitle);
    }
    this.graphSvg.appendChild(group);
  }

  private renderSemanticTree(visibleIds: readonly string[]): void {
    visibleIds.forEach((id) => {
      const node = this.graph.nodes.get(id);
      if (!node) {
        return;
      }
      const item = document.createElement("div");
      item.className = "atlyn-semantic-item";
      item.dataset.semanticNodeId = id;
      item.style.setProperty("--atlyn-level", String(node.depth + 1));
      item.setAttribute("role", "treeitem");
      item.setAttribute("tabindex", this.focusedId === id ? "0" : "-1");
      item.setAttribute("aria-level", String(node.depth + 1));
      item.setAttribute("aria-selected", String(this.selected.has(id)));
      item.setAttribute("aria-expanded", String(node.children.length > 0 && !this.collapsed.has(id)));
      item.setAttribute("aria-label", this.nodeAriaLabel(node));
      item.addEventListener("keydown", (event) => this.onTreeItemKeyDown(id, event));
      const toggle = document.createElement("button");
      toggle.className = "atlyn-semantic-toggle";
      toggle.type = "button";
      toggle.disabled = node.children.length === 0;
      toggle.textContent = node.children.length > 0 && !this.collapsed.has(id) ? "−" : "+";
      toggle.setAttribute(
        "aria-label",
        node.children.length > 0 && !this.collapsed.has(id) ? `${this.strings.collapse} ${node.label}` : `${this.strings.expand} ${node.label}`
      );
      toggle.addEventListener("click", (event) => {
        event.stopPropagation();
        this.toggleCollapsed(id);
      });
      const label = document.createElement("button");
      label.className = "atlyn-semantic-label";
      label.type = "button";
      label.textContent = node.subtitle ? `${node.label} — ${node.subtitle}` : node.label;
      label.addEventListener("click", (event) => this.onNodeClick(id, event as MouseEvent));
      item.append(toggle, label);
      this.semanticTree.appendChild(item);
      this.semanticItems.set(id, item);
    });
  }

  private renderDiagnostics(): void {
    this.diagnosticsElement.replaceChildren();
    if (this.graph.diagnostics.length === 0) {
      return;
    }
    this.graph.diagnostics.forEach((item) => {
      const line = document.createElement("div");
      line.className = "atlyn-diagnostic";
      line.dataset.severity = item.severity;
      line.textContent = this.localizeDiagnostic(item);
      this.diagnosticsElement.appendChild(line);
    });
  }

  private renderBreadcrumb(): void {
    this.breadcrumbElement.replaceChildren();
    const activeId = this.focusedId ?? Array.from(this.selected)[0];
    const path = activeId ? getAncestorIds(this.graph, activeId, true) : [];
    const text = document.createElement("span");
    text.textContent = path.length > 0 ? `${this.strings.breadcrumb}: ${path.map((id) => this.graph.nodes.get(id)?.label ?? id).join(" / ")}` : `${this.strings.breadcrumb}: —`;
    this.breadcrumbElement.appendChild(text);
  }

  private renderStatus(visibleCount: number): void {
    const selectedCount = this.selected.size;
    const selectedText = selectedCount > 0 ? `, ${selectedCount} ${this.strings.selected}` : "";
    this.status.textContent = `${this.graph.receivedCount.toLocaleString()} ${this.strings.received}, ${visibleCount.toLocaleString()} ${this.strings.visible}, ${this.graph.excludedCount.toLocaleString()} ${this.strings.excluded}${selectedText}`;
    if (this.graph.nodes.size === 0) {
      const empty = document.createElement("div");
      empty.className = "atlyn-empty";
      empty.textContent = this.strings.noData;
      this.canvasWrap.prepend(empty);
    }
  }

  private localizeDiagnostic(item: Diagnostic): string {
    const count = item.count > 0 ? ` (${item.count.toLocaleString()})` : "";
    return `${item.message}${count}`;
  }

  private nodeAriaLabel(node: GraphModel["nodes"] extends Map<string, infer T> ? T : never): string {
    const childText = node.children.length === 1 ? `1 ${this.strings.child}` : `${node.children.length} ${this.strings.children}`;
    const flags = node.qualityFlags.length > 0 ? `; ${node.qualityFlags.join(", ")}` : "";
    return `${node.label}${node.subtitle ? `, ${node.subtitle}` : ""}; ${childText}; ${node.id}${flags}`;
  }

  private matchesSearch(node: GraphModel["nodes"] extends Map<string, infer T> ? T : never): boolean {
    if (!this.searchQuery) {
      return false;
    }
    const query = this.searchQuery.toLocaleLowerCase();
    return [node.id, node.label, node.subtitle, node.category].some((value) => value.toLocaleLowerCase().includes(query));
  }

  private onSearchInput = (): void => {
    this.searchQuery = this.searchInput.value.trim();
    const match = Array.from(this.graph.nodes.keys())
      .sort((left, right) => left.localeCompare(right, "en", { numeric: true }))
      .find((id) => this.matchesSearch(this.graph.nodes.get(id)!));
    if (match) {
      this.focusedId = match;
      getAncestorIds(this.graph, match).forEach((ancestorId) => this.collapsed.delete(ancestorId));
    }
    this.render();
  };

  private onNodeClick(id: string, event: MouseEvent): void {
    this.focusedId = id;
    this.selectNode(id, event.ctrlKey || event.metaKey);
  }

  private selectNode(id: string, multiSelect: boolean): void {
    if (!multiSelect) {
      this.selected.clear();
    }
    if (multiSelect && this.selected.has(id)) {
      this.selected.delete(id);
    } else {
      this.selected.add(id);
    }
    const selectionId = this.selectionIds.get(id);
    if (selectionId !== undefined && this.selectionManager?.select) {
      const ids = Array.from(this.selected)
        .map((selectedId) => this.selectionIds.get(selectedId))
        .filter((value) => value !== undefined);
      void this.selectionManager.select(ids, multiSelect);
    }
    this.render();
  }

  private selectDescendants(): void {
    const activeId = this.focusedId ?? Array.from(this.selected)[0];
    if (!activeId || !this.graph.nodes.has(activeId)) {
      return;
    }
    const ids = getDescendantIds(this.graph, activeId, true);
    this.selected = new Set(ids);
    const selectionIds = ids.map((id) => this.selectionIds.get(id)).filter((value) => value !== undefined);
    if (selectionIds.length > 0 && this.selectionManager?.select) {
      void this.selectionManager.select(selectionIds, true);
    }
    this.render();
  }

  private clearSelection(): void {
    this.selected.clear();
    if (this.selectionManager?.clear) {
      void this.selectionManager.clear();
    }
    this.render();
  }

  private toggleCollapsed(id: string): void {
    if (!this.graph.nodes.get(id)?.children.length) {
      return;
    }
    if (this.collapsed.has(id)) {
      this.collapsed.delete(id);
    } else {
      this.collapsed.add(id);
    }
    this.focusedId = id;
    this.render();
  }

  private onTreeItemKeyDown(id: string, event: KeyboardEvent): void {
    const visibleIds = flattenVisibleIds(this.graph, this.collapsed);
    const index = visibleIds.indexOf(id);
    let nextId: string | undefined;
    switch (event.key) {
      case "ArrowDown":
        nextId = visibleIds[Math.min(visibleIds.length - 1, index + 1)];
        break;
      case "ArrowUp":
        nextId = visibleIds[Math.max(0, index - 1)];
        break;
      case "Home":
        nextId = visibleIds[0];
        break;
      case "End":
        nextId = visibleIds[visibleIds.length - 1];
        break;
      case "ArrowRight":
        if (this.collapsed.has(id)) {
          this.toggleCollapsed(id);
          event.preventDefault();
          return;
        }
        nextId = this.graph.nodes.get(id)?.children[0];
        break;
      case "ArrowLeft":
        if (!this.collapsed.has(id) && (this.graph.nodes.get(id)?.children.length ?? 0) > 0) {
          this.toggleCollapsed(id);
          event.preventDefault();
          return;
        }
        nextId = this.graph.nodes.get(id)?.parentId ?? undefined;
        break;
      case "Enter":
      case " ":
        this.selectNode(id, event.ctrlKey || event.metaKey);
        event.preventDefault();
        return;
      case "Escape":
        this.clearSelection();
        event.preventDefault();
        return;
      default:
        return;
    }
    if (nextId) {
      this.focusNode(nextId);
      event.preventDefault();
    }
  }

  private onRootKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      this.searchInput.value = "";
      this.searchQuery = "";
      this.clearSelection();
    }
  };

  private focusNode(id: string): void {
    if (!this.graph.nodes.has(id)) {
      return;
    }
    this.focusedId = id;
    this.render();
    this.semanticItems.get(id)?.focus({ preventScroll: true });
  }

  private onCanvasContextMenu = (event: MouseEvent): void => {
    if ((event.target as Element)?.closest?.("[data-node-id]")) {
      return;
    }
    event.preventDefault();
    this.showContextMenu(undefined, event.clientX, event.clientY);
  };

  private onCanvasClick = (event: MouseEvent): void => {
    if (event.target === this.canvasWrap || event.target === this.graphSvg) {
      this.clearSelection();
    }
  };

  private showContextMenu(id: string | undefined, x: number, y: number): void {
    const contextMenuService = this.host.contextMenuService;
    if (!contextMenuService?.show) {
      return;
    }
    void contextMenuService.show({ x, y }, id ? this.selectionIds.get(id) : undefined);
  }

  private showTooltip(id: string, x: number, y: number): void {
    const node = this.graph.nodes.get(id);
    if (!node || !this.host.tooltipService?.show) {
      return;
    }
    const dataItems = [
      { displayName: "Label", value: node.label },
      { displayName: "NodeId", value: node.id },
      { displayName: "ParentId", value: node.parentId ?? "" },
      { displayName: "Depth", value: String(node.depth) },
      { displayName: "Children", value: String(node.children.length) },
      { displayName: "Category", value: node.category },
      { displayName: "Value", value: node.value === undefined || node.value === null ? "" : String(node.value) },
      ...Object.entries(node.tooltips).map(([displayName, value]) => ({ displayName, value: String(value ?? "") })),
      ...(node.qualityFlags.length > 0 ? [{ displayName: "Data quality", value: node.qualityFlags.join(", ") }] : [])
    ];
    void this.host.tooltipService.show({
      dataItems,
      identities: this.selectionIds.has(id) ? [this.selectionIds.get(id)] : [],
      coordinates: [x, y],
      isTouchEvent: false
    });
  }

  private hideTooltip(): void {
    if (this.host.tooltipService?.hide) {
      void this.host.tooltipService.hide({ immediately: true });
    }
  }

  private showRenderFailure(error: unknown): void {
    this.graphSvg.replaceChildren();
    this.semanticTree.replaceChildren();
    const line = document.createElement("div");
    line.className = "atlyn-diagnostic";
    line.dataset.severity = "error";
    line.textContent = `Unable to render hierarchy: ${error instanceof Error ? error.message : "unknown error"}`;
    this.diagnosticsElement.replaceChildren(line);
  }

  private fireRenderingEvent(name: "renderingStarted" | "renderingFinished" | "renderingFailed", options: any, error?: unknown): void {
    const service = this.host?.eventService;
    if (name === "renderingStarted" && typeof service?.renderingStarted === "function") {
      service.renderingStarted(options);
    } else if (name === "renderingFinished" && typeof service?.renderingFinished === "function") {
      service.renderingFinished(options);
    } else if (name === "renderingFailed" && typeof service?.renderingFailed === "function") {
      service.renderingFailed(options, error);
    }
  }
}
