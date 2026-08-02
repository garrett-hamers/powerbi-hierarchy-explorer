import type powerbi from "powerbi-visuals-api";
import {
  buildHierarchy,
  Diagnostic,
  flattenVisibleIds,
  getAncestorIds,
  getDescendantIds,
  GraphModel,
  HierarchyRow,
  TABLE_ROW_CAP
} from "./graph";
import {
  buildFormattingModel,
  DEFAULT_FORMATTING,
  FormattingValues,
  LayoutDirection,
  readFormattingValues
} from "./formatting";
import { getLocaleStrings, isRtlLocale, LocalizedStrings } from "./localization";
import { computeLayout, LayoutResult } from "./layout";

type VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
type VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
type VisualHost = powerbi.extensibility.visual.IVisualHost;
type SelectionId = powerbi.visuals.ISelectionId;
type SelectionManager = ReturnType<VisualHost["createSelectionManager"]>;
type LocalizationManager = powerbi.extensibility.ILocalizationManager;

interface RuntimeSelectionManager {
  select?: (selectionId: SelectionId | SelectionId[], multiSelect?: boolean) => Promise<unknown>;
  clear?: () => Promise<unknown>;
  getSelectionIds?: () => SelectionId[];
  showContextMenu?: (
    selectionId: SelectionId,
    position: powerbi.extensibility.IPoint,
    dataRoles?: string
  ) => Promise<unknown>;
  registerOnSelectCallback?: (callback: (ids: SelectionId[]) => void) => void;
}

interface ParsedTable {
  rows: HierarchyRow[];
  rolesPresent: Partial<Record<"NodeId" | "ParentId" | "Label", boolean>>;
  selectionIdsBySourceKey: Map<string, SelectionId>;
  receivedCount: number;
  truncated: boolean;
  boundedContract: boolean;
  partial: boolean;
  contractDiagnostics: Diagnostic[];
}

const ROLE_ORDER = ["NodeId", "ParentId", "Label", "Subtitle", "Category", "Value", "Tooltips"] as const;
const NODE_CAP = 10000;
const DEPTH_CAP = 50;
const RENDER_NODE_CAP = 2000;
const MAX_SEGMENT_REQUESTS = 32;
const LONG_PRESS_MS = 550;

type RequiredRole = "NodeId" | "ParentId" | "Label";

function stableValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (value instanceof Date) {
    return `date:${value.toISOString()}`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${key}:${stableValue(record[key])}`)
      .join("|")}}`;
  }
  return `${typeof value}:${String(value)}`;
}

function text(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value);
}

function selectionKey(selectionId: SelectionId): string {
  const candidate = selectionId as unknown as {
    getKey?: () => string;
    key?: unknown;
  };
  if (typeof candidate.getKey === "function") {
    return candidate.getKey();
  }
  return candidate.key === undefined ? String(selectionId) : String(candidate.key);
}

export class Visual implements powerbi.extensibility.visual.IVisual {
  private static instanceCount = 0;

  private readonly host: VisualHost;
  private readonly root: HTMLDivElement;
  private readonly toolbar: HTMLDivElement;
  private readonly searchLabel: HTMLLabelElement;
  private readonly searchInput: HTMLInputElement;
  private readonly status: HTMLDivElement;
  private readonly diagnosticsElement: HTMLDivElement;
  private readonly breadcrumbElement: HTMLElement;
  private readonly canvasWrap: HTMLDivElement;
  private readonly emptyElement: HTMLDivElement;
  private readonly graphSvg: SVGSVGElement;
  private readonly semanticTree: HTMLDivElement;
  private readonly selectDescendantsButton: HTMLButtonElement;
  private readonly clearSelectionButton: HTMLButtonElement;
  private readonly cleanup: Array<() => void> = [];
  private readonly selectionManager: SelectionManager;
  private readonly localizationManager?: LocalizationManager;
  private readonly instanceId: number;
  private strings: LocalizedStrings;
  private formatting: FormattingValues = { ...DEFAULT_FORMATTING };
  private graph: GraphModel = buildHierarchy([]);
  private selectionIds = new Map<string, SelectionId>();
  private collapsed = new Set<string>();
  private selected = new Set<string>();
  private semanticItems = new Map<string, HTMLElement>();
  private focusedId: string | null = null;
  private searchQuery = "";
  private locale: string;
  private direction: "ltr" | "rtl";
  private dataMode: "empty" | "table" | "matrix" = "empty";
  private modeMessage = "";
  private dataState: "empty" | "ready" | "loading" | "partial" = "empty";
  private readonly interactionsEnabled: boolean;
  private accumulatedRows: HierarchyRow[] = [];
  private accumulatedSelectionIds = new Map<string, SelectionId>();
  private accumulatedDiagnostics: Diagnostic[] = [];
  private segmentOrdinal = 0;
  private segmentRequestCount = 0;
  private partialData = false;
  private tooltipNodeId: string | null = null;
  private typeaheadBuffer = "";
  private typeaheadTimer: ReturnType<typeof setTimeout> | undefined;
  private suppressedClickTimer: ReturnType<typeof setTimeout> | undefined;
  private destroyed = false;
  private lastUpdateOptions: VisualUpdateOptions | undefined;
  private longPressTimer: ReturnType<typeof setTimeout> | undefined;
  private suppressNextClick = false;

  constructor(options?: VisualConstructorOptions) {
    if (!options) {
      throw new Error("Atlyn Hierarchy Explorer requires a visual host element.");
    }
    this.host = options.host;
    this.interactionsEnabled = this.host.hostCapabilities?.allowInteractions !== false;
    this.selectionManager = this.host.createSelectionManager();
    this.localizationManager =
      typeof this.host.createLocalizationManager === "function"
        ? this.host.createLocalizationManager()
        : undefined;
    this.instanceId = Visual.instanceCount++;
    this.locale = this.host.locale ?? "en-US";
    this.direction = isRtlLocale(this.locale) ? "rtl" : "ltr";
    this.strings = getLocaleStrings(this.locale);

    this.root = document.createElement("div");
    this.root.className = "atlyn-root";
    this.root.dir = this.direction;
    this.root.setAttribute("aria-label", this.strings.visualName);
    options.element.appendChild(this.root);

    this.toolbar = document.createElement("div");
    this.toolbar.className = "atlyn-toolbar";
    this.toolbar.setAttribute("role", "toolbar");
    this.searchLabel = document.createElement("label");
    this.searchLabel.textContent = `${this.strings.searchLabel}:`;
    this.searchInput = document.createElement("input");
    this.searchInput.className = "atlyn-search";
    this.searchInput.type = "search";
    this.searchInput.id = `atlyn-hierarchy-search-${this.instanceId}`;
    this.searchInput.placeholder = this.strings.searchPlaceholder;
    this.searchInput.setAttribute("aria-label", this.strings.searchLabel);
    this.searchLabel.htmlFor = this.searchInput.id;
    this.searchInput.addEventListener("input", this.onSearchInput);
    this.cleanup.push(() => this.searchInput.removeEventListener("input", this.onSearchInput));
    this.toolbar.append(this.searchLabel, this.searchInput);

    this.selectDescendantsButton = this.createButton(this.strings.selectDescendants, () => {
      this.selectDescendants();
    });
    this.selectDescendantsButton.classList.add("atlyn-select-descendants");
    this.selectDescendantsButton.disabled = true;
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
    this.root.appendChild(this.diagnosticsElement);

    this.breadcrumbElement = document.createElement("nav");
    this.breadcrumbElement.className = "atlyn-breadcrumb";
    this.root.appendChild(this.breadcrumbElement);

    this.canvasWrap = document.createElement("div");
    this.canvasWrap.className = "atlyn-canvas-wrap";
    this.canvasWrap.addEventListener("contextmenu", this.onCanvasContextMenu);
    this.canvasWrap.addEventListener("click", this.onCanvasClick);
    this.canvasWrap.addEventListener("touchstart", this.onCanvasTouchStart, { passive: true });
    this.canvasWrap.addEventListener("touchend", this.onCanvasTouchEnd, { passive: false });
    this.canvasWrap.addEventListener("touchcancel", this.onCanvasTouchCancel, { passive: true });
    this.cleanup.push(() => this.canvasWrap.removeEventListener("contextmenu", this.onCanvasContextMenu));
    this.cleanup.push(() => this.canvasWrap.removeEventListener("click", this.onCanvasClick));
    this.cleanup.push(() => this.canvasWrap.removeEventListener("touchstart", this.onCanvasTouchStart));
    this.cleanup.push(() => this.canvasWrap.removeEventListener("touchend", this.onCanvasTouchEnd));
    this.cleanup.push(() => this.canvasWrap.removeEventListener("touchcancel", this.onCanvasTouchCancel));

    this.emptyElement = document.createElement("div");
    this.emptyElement.className = "atlyn-empty";
    this.emptyElement.hidden = true;
    this.graphSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.graphSvg.classList.add("atlyn-graph");
    this.graphSvg.setAttribute("aria-hidden", "true");
    this.graphSvg.setAttribute("focusable", "false");
    this.semanticTree = document.createElement("div");
    this.semanticTree.className = "atlyn-semantic-tree";
    this.semanticTree.setAttribute("role", "tree");
    this.semanticTree.setAttribute("aria-multiselectable", "true");
    this.semanticTree.setAttribute("aria-orientation", "vertical");
    this.semanticTree.setAttribute("aria-label", this.strings.tree);
    this.canvasWrap.append(this.emptyElement, this.graphSvg, this.semanticTree);
    this.root.appendChild(this.canvasWrap);

    this.graphSvg.addEventListener("click", this.onGraphClick);
    this.graphSvg.addEventListener("dblclick", this.onGraphDoubleClick);
    this.graphSvg.addEventListener("contextmenu", this.onGraphContextMenu);
    this.graphSvg.addEventListener("mouseenter", this.onGraphMouseEnter, true);
    this.graphSvg.addEventListener("mouseleave", this.onGraphMouseLeave, true);
    this.graphSvg.addEventListener("pointerover", this.onGraphPointerOver);
    this.graphSvg.addEventListener("pointermove", this.onGraphPointerMove);
    this.graphSvg.addEventListener("pointerout", this.onGraphPointerOut);
    this.graphSvg.addEventListener("touchstart", this.onGraphTouchStart, { passive: true });
    this.graphSvg.addEventListener("touchend", this.onTouchEnd, { passive: false });
    this.graphSvg.addEventListener("touchcancel", this.onTouchCancel, { passive: true });
    this.cleanup.push(() => this.graphSvg.removeEventListener("click", this.onGraphClick));
    this.cleanup.push(() => this.graphSvg.removeEventListener("dblclick", this.onGraphDoubleClick));
    this.cleanup.push(() => this.graphSvg.removeEventListener("contextmenu", this.onGraphContextMenu));
    this.cleanup.push(() => this.graphSvg.removeEventListener("mouseenter", this.onGraphMouseEnter, true));
    this.cleanup.push(() => this.graphSvg.removeEventListener("mouseleave", this.onGraphMouseLeave, true));
    this.cleanup.push(() => this.graphSvg.removeEventListener("pointerover", this.onGraphPointerOver));
    this.cleanup.push(() => this.graphSvg.removeEventListener("pointermove", this.onGraphPointerMove));
    this.cleanup.push(() => this.graphSvg.removeEventListener("pointerout", this.onGraphPointerOut));
    this.cleanup.push(() => this.graphSvg.removeEventListener("touchstart", this.onGraphTouchStart));
    this.cleanup.push(() => this.graphSvg.removeEventListener("touchend", this.onTouchEnd));
    this.cleanup.push(() => this.graphSvg.removeEventListener("touchcancel", this.onTouchCancel));
    this.semanticTree.addEventListener("click", this.onSemanticTreeClick);
    this.semanticTree.addEventListener("contextmenu", this.onSemanticTreeContextMenu);
    this.semanticTree.addEventListener("keydown", this.onSemanticTreeKeyDown);
    this.semanticTree.addEventListener("focusin", this.onSemanticTreeFocusIn);
    this.semanticTree.addEventListener("touchstart", this.onSemanticTreeTouchStart, { passive: true });
    this.semanticTree.addEventListener("touchend", this.onTouchEnd, { passive: false });
    this.semanticTree.addEventListener("touchcancel", this.onTouchCancel, { passive: true });
    this.cleanup.push(() => this.semanticTree.removeEventListener("click", this.onSemanticTreeClick));
    this.cleanup.push(() => this.semanticTree.removeEventListener("contextmenu", this.onSemanticTreeContextMenu));
    this.cleanup.push(() => this.semanticTree.removeEventListener("keydown", this.onSemanticTreeKeyDown));
    this.cleanup.push(() => this.semanticTree.removeEventListener("focusin", this.onSemanticTreeFocusIn));
    this.cleanup.push(() => this.semanticTree.removeEventListener("touchstart", this.onSemanticTreeTouchStart));
    this.cleanup.push(() => this.semanticTree.removeEventListener("touchend", this.onTouchEnd));
    this.cleanup.push(() => this.semanticTree.removeEventListener("touchcancel", this.onTouchCancel));

    this.root.addEventListener("keydown", this.onRootKeyDown);
    this.cleanup.push(() => this.root.removeEventListener("keydown", this.onRootKeyDown));

    const runtimeSelectionManager = this.runtimeSelectionManager();
    runtimeSelectionManager.registerOnSelectCallback?.(this.onHostSelection);
    this.applyFormatting();
    this.render();
  }

  public update(options: VisualUpdateOptions): void {
    if (this.destroyed) {
      return;
    }
    try {
      this.fireRenderingEvent("renderingStarted", options);
      this.lastUpdateOptions = options;
      const dataView = options.dataViews?.[0];
      this.locale = this.host.locale ?? this.locale;
      this.formatting = readFormattingValues(dataView);
      this.direction = this.resolveDirection(this.formatting.direction);
      this.refreshStrings();
      this.applyFormatting();

      if (dataView?.table) {
        this.dataMode = "table";
        this.modeMessage = "";
        const operationKind = options.operationKind as unknown as number | undefined;
        const append =
          operationKind === 1 ||
          operationKind === 2 ||
          (dataView.metadata?.segment !== undefined && this.partialData);
        if (!append) {
          this.resetAccumulatedTable();
        }
        const parsed = this.parseTable(dataView.table, dataView, this.segmentOrdinal);
        this.segmentOrdinal += 1;
        this.accumulatedDiagnostics.push(...parsed.contractDiagnostics);
        parsed.rows.forEach((row) => {
          const sourceKey = row.sourceKey ?? `row:${row.sourceRow ?? 0}`;
          if (this.accumulatedSelectionIds.has(sourceKey)) {
            return;
          }
          this.accumulatedRows.push(row);
          const selectionId = parsed.selectionIdsBySourceKey.get(sourceKey);
          if (selectionId) {
            this.accumulatedSelectionIds.set(sourceKey, selectionId);
          }
        });
        this.partialData = parsed.partial;
        this.graph = buildHierarchy(
          {
            rows: this.accumulatedRows,
            receivedCount: this.accumulatedRows.length,
            truncated: this.partialData || parsed.truncated,
            boundedContract: true,
            rolesPresent: parsed.rolesPresent,
            inputDiagnostics: this.accumulatedDiagnostics
          },
          { nodeCap: NODE_CAP, depthCap: DEPTH_CAP }
        );
        this.graph.nodes.forEach((node) => {
          if (node.qualityFlags.includes("empty-label")) {
            node.label = this.strings.unnamed;
          }
        });
        this.selectionIds = new Map<string, SelectionId>();
        this.graph.nodes.forEach((node, id) => {
          const selectionId = this.accumulatedSelectionIds.get(node.sourceKey);
          if (selectionId) {
            this.selectionIds.set(id, selectionId);
          }
        });
        this.syncHostSelection();
        this.requestMoreData(parsed.partial);
        this.dataState = parsed.partial
          ? this.dataState === "loading"
            ? "loading"
            : "partial"
          : "ready";
      } else if (dataView?.matrix) {
        this.dataMode = "matrix";
        this.modeMessage = this.strings.matrixUnsupported;
        this.resetAccumulatedTable();
        this.partialData = false;
        this.dataState = "empty";
        this.graph = buildHierarchy({
          rows: [],
          rolesPresent: { NodeId: false, ParentId: false, Label: false }
        });
        this.selectionIds.clear();
      } else {
        this.dataMode = "empty";
        this.modeMessage = "";
        this.resetAccumulatedTable();
        this.partialData = false;
        this.dataState = "empty";
        this.graph = buildHierarchy({
          rows: [],
          rolesPresent: { NodeId: false, ParentId: false, Label: false }
        });
        this.selectionIds.clear();
      }
      this.selected = new Set(Array.from(this.selected).filter((id) => this.graph.nodes.has(id)));
      this.collapsed = new Set(Array.from(this.collapsed).filter((id) => this.graph.nodes.has(id)));
      if (this.focusedId && !this.graph.nodes.has(this.focusedId)) {
        this.focusedId = null;
      }
      this.render();
    } catch (error) {
      this.showRenderFailure(error);
      this.fireRenderingEvent("renderingFailed", options, error);
      return;
    }
    this.fireRenderingEvent("renderingFinished", options);
  }

  public destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.clearLongPress();
    if (this.typeaheadTimer) {
      clearTimeout(this.typeaheadTimer);
      this.typeaheadTimer = undefined;
    }
    if (this.suppressedClickTimer) {
      clearTimeout(this.suppressedClickTimer);
      this.suppressedClickTimer = undefined;
    }
    this.hideTooltip();
    this.cleanup.splice(0).forEach((dispose) => dispose());
    this.root.remove();
    this.selectionIds.clear();
    this.selected.clear();
    this.collapsed.clear();
    this.semanticItems.clear();
  }

  public getFormattingModel(): powerbi.visuals.FormattingModel {
    return buildFormattingModel(this.formatting, (key, fallback) => this.localize(key, fallback));
  }

  private runtimeSelectionManager(): RuntimeSelectionManager {
    return this.selectionManager as unknown as RuntimeSelectionManager;
  }

  private resetAccumulatedTable(): void {
    this.accumulatedRows = [];
    this.accumulatedSelectionIds.clear();
    this.accumulatedDiagnostics = [];
    this.segmentOrdinal = 0;
    this.segmentRequestCount = 0;
    this.partialData = false;
    this.dataState = "empty";
  }

  private requestMoreData(partial: boolean): void {
    if (!partial) {
      this.segmentRequestCount = 0;
      return;
    }
    if (this.segmentRequestCount >= MAX_SEGMENT_REQUESTS) {
      this.dataState = "partial";
      return;
    }
    const fetchMoreData = this.host.fetchMoreData;
    if (typeof fetchMoreData !== "function") {
      this.dataState = "partial";
      return;
    }
    this.segmentRequestCount += 1;
    const requested = fetchMoreData(false);
    this.dataState = requested ? "loading" : "partial";
  }

  private onHostSelection = (selectionIds: SelectionId[]): void => {
    if (this.destroyed) {
      return;
    }
    const selectedKeys = new Set(selectionIds.map((selectionId) => selectionKey(selectionId)));
    this.selected = new Set(
      Array.from(this.selectionIds.entries())
        .filter(([, selectionId]) => selectedKeys.has(selectionKey(selectionId)))
        .map(([id]) => id)
    );
    this.refreshSelectionState();
  };

  private syncHostSelection(): void {
    const selectionIds = this.runtimeSelectionManager().getSelectionIds?.();
    if (!selectionIds) {
      return;
    }
    this.onHostSelection(selectionIds);
  }

  private refreshSelectionState(): void {
    this.semanticItems.forEach((item, id) => {
      item.setAttribute("aria-selected", String(this.selected.has(id)));
    });
    this.graphSvg.querySelectorAll<SVGRectElement>(".atlyn-node-card").forEach((card) => {
      const id = card.closest("[data-node-id]")?.getAttribute("data-node-id");
      if (id) {
        card.dataset.selected = String(this.selected.has(id));
      }
    });
    const visibleIds = flattenVisibleIds(this.graph, this.collapsed);
    this.renderBreadcrumb();
    this.renderStatus(visibleIds.length, Math.min(visibleIds.length, RENDER_NODE_CAP));
    const activeId = this.focusedId ?? Array.from(this.selected)[0];
    this.selectDescendantsButton.disabled =
      !this.interactionsEnabled || !activeId || !this.formatting.enableDescendantSelection;
    this.clearSelectionButton.disabled = !this.interactionsEnabled || this.selected.size === 0;
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

  private parseTable(
    table: powerbi.DataViewTable,
    dataView: powerbi.DataView,
    segmentOrdinal: number
  ): ParsedTable {
    const columns = table.columns ?? [];
    const rows = table.rows ?? [];
    const roleIndices = new Map<string, number[]>();
    ROLE_ORDER.forEach((role) => {
      roleIndices.set(
        role,
        columns.reduce<number[]>((indices, column, index) => {
          if (column.roles?.[role]) {
            indices.push(index);
          }
          return indices;
        }, [])
      );
    });
    const contractDiagnostics: Diagnostic[] = [];
    const addContractDiagnostic = (
      code: Diagnostic["code"],
      severity: Diagnostic["severity"],
      message: string,
      count = 0
    ): void => {
      contractDiagnostics.push({ code, severity, message, count, nodeIds: [] });
    };
    const rolesPresent = {
      NodeId: (roleIndices.get("NodeId")?.length ?? 0) > 0,
      ParentId: (roleIndices.get("ParentId")?.length ?? 0) > 0,
      Label: (roleIndices.get("Label")?.length ?? 0) > 0
    };
    const requiredRoles: RequiredRole[] = ["NodeId", "ParentId", "Label"];
    const requiredRoleShapeValid = requiredRoles.every((role) => (roleIndices.get(role)?.length ?? 0) === 1);
    ROLE_ORDER.forEach((role) => {
      const count = roleIndices.get(role)?.length ?? 0;
      const max = role === "Tooltips" ? 10 : 1;
      if (count > max) {
        addContractDiagnostic(
          "invalid-cardinality",
          "error",
          `${role} accepts at most ${max} field${max === 1 ? "" : "s"}; extra fields were not used.`,
          count - max
        );
      }
    });
    const unsupportedTypeRoles = requiredRoles.filter((role) =>
      (roleIndices.get(role) ?? []).some((index) => {
        const type = columns[index]?.type as Record<string, unknown> | undefined;
        return type !== undefined && (type.bool === true || type.binary === true);
      })
    );
    if (unsupportedTypeRoles.length > 0) {
      addContractDiagnostic(
        "invalid-data-shape",
        "error",
        `Unsupported data type for ${unsupportedTypeRoles.join(", ")}. Use text, numeric, or date fields.`
      );
    }
    const valueAt = (row: powerbi.DataViewTableRow, role: string): unknown => {
      const index = roleIndices.get(role)?.[0];
      return index === undefined ? undefined : row[index];
    };
    const tooltipIndices = roleIndices.get("Tooltips") ?? [];
    const selectionIdsBySourceKey = new Map<string, SelectionId>();
    const parsedRows: HierarchyRow[] = [];
    rows.forEach((row, index) => {
      if (!Array.isArray(row)) {
        addContractDiagnostic("invalid-data-shape", "error", "A table row was not an array and was excluded.", 1);
        return;
      }
      if (row.length < columns.length) {
        addContractDiagnostic("invalid-data-shape", "warning", "Partial table rows were received.", 1);
      } else if (row.length > columns.length) {
        addContractDiagnostic("invalid-data-shape", "warning", "Table rows contained unexpected extra values.", 1);
      }
      const sourceKey = table.identity?.[index]
        ? `identity:${stableValue(table.identity[index])}`
        : `segment:${segmentOrdinal}:${index}`;
      const tooltips: Record<string, unknown> = {};
      tooltipIndices.forEach((columnIndex) => {
        tooltips[columns[columnIndex]?.displayName ?? `Tooltip ${columnIndex + 1}`] = row[columnIndex];
      });
      if (requiredRoleShapeValid && unsupportedTypeRoles.length === 0) {
        if (!selectionIdsBySourceKey.has(sourceKey)) {
          selectionIdsBySourceKey.set(sourceKey, this.createSelectionId(table, index));
        }
      }
      if (!requiredRoleShapeValid || unsupportedTypeRoles.length > 0) {
        return;
      }
      parsedRows.push({
        nodeId: valueAt(row, "NodeId"),
        parentId: valueAt(row, "ParentId"),
        label: valueAt(row, "Label"),
        subtitle: valueAt(row, "Subtitle"),
        category: valueAt(row, "Category"),
        value: valueAt(row, "Value"),
        tooltips,
        sourceRow: index,
        sourceKey
      });
    });
    const partial = dataView.metadata?.segment !== undefined;
    const truncated = partial || dataView.metadata?.dataReduction !== undefined || rows.length > TABLE_ROW_CAP;
    if (partial) {
      addContractDiagnostic(
        "partial-data",
        "warning",
        "Only the currently received table segment is rendered; additional rows may still be loading."
      );
    }
    return {
      rows: parsedRows,
      rolesPresent,
      selectionIdsBySourceKey,
      receivedCount: rows.length,
      truncated,
      boundedContract: true,
      partial,
      contractDiagnostics
    };
  }

  private createSelectionId(table: powerbi.DataViewTable, rowIndex: number): SelectionId {
    return this.host.createSelectionIdBuilder().withTable(table, rowIndex).createSelectionId();
  }

  private nodeIdFromTarget(target: EventTarget | null, attribute: "node-id" | "semantic-node-id"): string | null {
    const element = target instanceof Element ? target.closest(`[data-${attribute}]`) : null;
    return element ? element.getAttribute(`data-${attribute}`) : null;
  }

  private onGraphClick = (event: MouseEvent): void => {
    if (!this.interactionsEnabled) {
      return;
    }
    const id = this.nodeIdFromTarget(event.target, "node-id");
    if (id) {
      this.onNodeClick(id, event);
    }
  };

  private onGraphDoubleClick = (event: MouseEvent): void => {
    if (!this.interactionsEnabled) {
      return;
    }
    const id = this.nodeIdFromTarget(event.target, "node-id");
    if (id && this.formatting.enableCollapse) {
      event.preventDefault();
      this.toggleCollapsed(id);
    }
  };

  private onGraphContextMenu = (event: MouseEvent): void => {
    if (!this.interactionsEnabled) {
      return;
    }
    event.preventDefault();
    this.showContextMenu(this.nodeIdFromTarget(event.target, "node-id") ?? undefined, event.clientX, event.clientY);
  };

  private onGraphMouseEnter = (event: MouseEvent): void => {
    if (!this.interactionsEnabled) {
      return;
    }
    const id = this.nodeIdFromTarget(event.target, "node-id");
    if (id && id !== this.tooltipNodeId) {
      this.showTooltip(id, event.clientX, event.clientY, false);
    }
  };

  private onGraphMouseLeave = (event: MouseEvent): void => {
    const id = this.nodeIdFromTarget(event.target, "node-id");
    if (id && id === this.tooltipNodeId) {
      this.hideTooltip();
    }
  };

  private onGraphTouchStart = (event: TouchEvent): void => {
    if (!this.interactionsEnabled) {
      return;
    }
    const id = this.nodeIdFromTarget(event.target, "node-id");
    if (id) {
      this.onNodeTouchStart(id, event);
    }
  };

  private onGraphPointerOver = (event: PointerEvent): void => {
    if (!this.interactionsEnabled) {
      return;
    }
    const id = this.nodeIdFromTarget(event.target, "node-id");
    if (id && id !== this.tooltipNodeId) {
      this.showTooltip(id, event.clientX, event.clientY, false);
    }
  };

  private onGraphPointerMove = (event: PointerEvent): void => {
    if (!this.interactionsEnabled || !this.tooltipNodeId) {
      return;
    }
    const id = this.nodeIdFromTarget(event.target, "node-id");
    if (id !== this.tooltipNodeId) {
      return;
    }
    const tooltipService = this.host.tooltipService;
    if (tooltipService && typeof tooltipService.move === "function") {
      tooltipService.move({
        coordinates: [event.clientX, event.clientY],
        identities: this.selectionIds.get(id) ? [this.selectionIds.get(id)!] : [],
        isTouchEvent: false
      });
    }
  };

  private onGraphPointerOut = (event: PointerEvent): void => {
    const id = this.nodeIdFromTarget(event.target, "node-id");
    const nextId = this.nodeIdFromTarget(event.relatedTarget, "node-id");
    if (id && id === this.tooltipNodeId && nextId !== id) {
      this.hideTooltip();
    }
  };

  private onSemanticTreeClick = (event: MouseEvent): void => {
    if (!this.interactionsEnabled) {
      return;
    }
    const target = event.target instanceof Element ? event.target : null;
    const id = this.nodeIdFromTarget(target, "semantic-node-id");
    if (!id) {
      return;
    }
    if (target?.closest(".atlyn-semantic-toggle")) {
      event.stopPropagation();
      if (this.formatting.enableCollapse) {
        this.toggleCollapsed(id);
      }
      return;
    }
    this.onNodeClick(id, event);
  };

  private onSemanticTreeContextMenu = (event: MouseEvent): void => {
    if (!this.interactionsEnabled) {
      return;
    }
    const id = this.nodeIdFromTarget(event.target, "semantic-node-id");
    event.preventDefault();
    this.showContextMenu(id ?? undefined, event.clientX, event.clientY);
  };

  private onSemanticTreeKeyDown = (event: KeyboardEvent): void => {
    if (!this.interactionsEnabled) {
      return;
    }
    const id = this.nodeIdFromTarget(event.target, "semantic-node-id");
    if (id) {
      this.onTreeItemKeyDown(id, event);
    }
  };

  private onSemanticTreeFocusIn = (event: FocusEvent): void => {
    const id = this.nodeIdFromTarget(event.target, "semantic-node-id");
    if (id) {
      this.focusedId = id;
    }
  };

  private onSemanticTreeTouchStart = (event: TouchEvent): void => {
    if (!this.interactionsEnabled) {
      return;
    }
    const id = this.nodeIdFromTarget(event.target, "semantic-node-id");
    if (id) {
      this.onNodeTouchStart(id, event);
    }
  };

  private render(): void {
    if (this.destroyed) {
      return;
    }
    const activeElement = document.activeElement;
    const shouldRestoreFocus = this.semanticTree.contains(activeElement);
    const restoreFocusId = shouldRestoreFocus
      ? this.nodeIdFromTarget(activeElement, "semantic-node-id")
      : null;
    const visibleIds = flattenVisibleIds(this.graph, this.collapsed);
    const prioritizedIds = new Set<string>();
    if (this.searchQuery) {
      visibleIds.forEach((id) => {
        const node = this.graph.nodes.get(id);
        if (node && this.matchesSearch(node)) {
          prioritizedIds.add(id);
          getAncestorIds(this.graph, id, true).forEach((ancestorId) => prioritizedIds.add(ancestorId));
        }
      });
    }
    const renderIds = [
      ...visibleIds.filter((id) => prioritizedIds.has(id)),
      ...visibleIds.filter((id) => !prioritizedIds.has(id))
    ].slice(0, RENDER_NODE_CAP);
    if (this.focusedId && !renderIds.includes(this.focusedId)) {
      this.focusedId = renderIds[0] ?? null;
    }
    this.graphSvg.replaceChildren();
    this.semanticTree.replaceChildren();
    this.semanticItems.clear();
    const width = Math.max(
      160,
      this.lastUpdateOptions?.viewport?.width ?? this.canvasWrap.clientWidth ?? 320
    );
    const height = Math.max(150, this.lastUpdateOptions?.viewport?.height ?? 280);
    const layout = computeLayout(this.graph, visibleIds, {
      width,
      height,
      direction: this.direction,
      nodeWidth: this.formatting.nodeWidth,
      nodeHeight: this.formatting.nodeHeight,
      horizontalGap: this.formatting.horizontalGap,
      verticalGap: this.formatting.verticalGap,
      padding: this.formatting.padding,
      fitContent: this.formatting.fitContent,
      fontSize: this.formatting.fontSize,
      subtitleFontSize: this.formatting.subtitleFontSize
    });
    this.graphSvg.setAttribute("viewBox", `0 0 ${layout.width} ${layout.height}`);
    this.graphSvg.setAttribute("width", String(layout.width));
    this.graphSvg.setAttribute("height", String(layout.height));
    this.graphSvg.style.width = `${Math.ceil(layout.width * this.formatting.zoom)}px`;
    this.graphSvg.style.height = `${Math.ceil(layout.height * this.formatting.zoom)}px`;
    this.renderEdges(layout, renderIds);
    renderIds.forEach((id) => this.renderSvgNode(id, layout));
    this.renderSemanticTree(renderIds);
    this.renderDiagnostics(visibleIds.length > renderIds.length);
    this.renderBreadcrumb();
    this.renderStatus(visibleIds.length, renderIds.length);
    const activeId = this.focusedId && this.graph.nodes.has(this.focusedId) ? this.focusedId : renderIds[0];
    this.selectDescendantsButton.hidden = !this.formatting.enableDescendantSelection;
    this.selectDescendantsButton.disabled =
      !this.interactionsEnabled || !activeId || !this.formatting.enableDescendantSelection;
    this.clearSelectionButton.disabled = !this.interactionsEnabled || this.selected.size === 0;
    this.searchLabel.hidden = !this.formatting.enableSearch;
    this.searchInput.hidden = !this.formatting.enableSearch;
    this.searchInput.disabled = !this.interactionsEnabled || !this.formatting.enableSearch;
    if (!this.focusedId && activeId) {
      this.focusedId = activeId;
    }
    if (restoreFocusId && this.semanticItems.has(restoreFocusId)) {
      this.semanticItems.get(restoreFocusId)?.focus({ preventScroll: true });
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
    group.setAttribute("aria-hidden", "true");
    group.dataset.nodeId = id;

    const card = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    card.classList.add("atlyn-node-card");
    card.dataset.selected = String(this.selected.has(id));
    card.dataset.searchMatch = String(this.matchesSearch(node));
    card.setAttribute("x", String(point.x));
    card.setAttribute("y", String(point.y));
    card.setAttribute("width", String(point.width));
    card.setAttribute("height", String(point.height));
    card.setAttribute("rx", "4");
    group.appendChild(card);

    const textAnchor = this.direction === "rtl" ? "end" : "start";
    const textX = this.direction === "rtl" ? point.x + point.width - 8 : point.x + 8;
    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.classList.add("atlyn-node-label");
    label.setAttribute("x", String(textX));
    label.setAttribute("y", String(point.y + Math.min(point.height - 8, this.formatting.fontSize + 7)));
    label.setAttribute("text-anchor", textAnchor);
    label.textContent = node.label;
    group.appendChild(label);
    if (node.subtitle) {
      const subtitle = document.createElementNS("http://www.w3.org/2000/svg", "text");
      subtitle.classList.add("atlyn-node-subtitle");
      subtitle.setAttribute("x", String(textX));
      subtitle.setAttribute("y", String(point.y + Math.min(point.height - 3, this.formatting.fontSize + this.formatting.subtitleFontSize + 12)));
      subtitle.setAttribute("text-anchor", textAnchor);
      subtitle.textContent = node.subtitle;
      group.appendChild(subtitle);
    }
    this.graphSvg.appendChild(group);
  }

  private renderSemanticTree(visibleIds: readonly string[]): void {
    this.semanticTree.setAttribute("aria-label", this.strings.tree);
    this.semanticTree.setAttribute("aria-setsize", String(visibleIds.length));
    this.semanticTree.setAttribute("aria-busy", String(this.dataState === "loading"));
    this.semanticTree.setAttribute("aria-disabled", String(!this.interactionsEnabled));
    const visible = new Set(visibleIds);
    visibleIds.forEach((id, index) => {
      const node = this.graph.nodes.get(id);
      if (!node) {
        return;
      }
      const item = document.createElement("div");
      item.className = "atlyn-semantic-item";
      item.id = `atlyn-treeitem-${this.instanceId}-${encodeURIComponent(id)}`;
      item.dataset.semanticNodeId = id;
      item.style.setProperty("--atlyn-level", String(node.depth + 1));
      item.setAttribute("role", "treeitem");
      item.setAttribute("tabindex", this.focusedId === id || (!this.focusedId && index === 0) ? "0" : "-1");
      item.setAttribute("aria-level", String(node.depth + 1));
      const siblings = node.parentId && visible.has(node.parentId)
        ? this.graph.nodes.get(node.parentId)?.children ?? []
        : this.graph.roots;
      const siblingIndex = Math.max(0, siblings.indexOf(id));
      item.setAttribute("aria-posinset", String(siblingIndex + 1));
      item.setAttribute("aria-setsize", String(siblings.length));
      item.setAttribute("aria-selected", String(this.selected.has(id)));
      item.setAttribute("aria-disabled", String(!this.interactionsEnabled));
      if (node.qualityFlags.some((flag) => ["empty-id", "duplicate-id", "conflicting-duplicate", "self-cycle", "cycle"].includes(flag))) {
        item.setAttribute("aria-invalid", "true");
      }
      if (node.children.length > 0) {
        item.setAttribute("aria-expanded", String(!this.collapsed.has(id)));
      }
      item.setAttribute("aria-label", this.nodeAriaLabel(node));

      if (node.children.length > 0) {
        const toggle = document.createElement("button");
        toggle.className = "atlyn-semantic-toggle";
        toggle.type = "button";
        toggle.tabIndex = -1;
        toggle.textContent = this.collapsed.has(id) ? "+" : "-";
        toggle.setAttribute(
          "aria-label",
          `${this.collapsed.has(id) ? this.strings.expand : this.strings.collapse} ${node.label}`
        );
        toggle.hidden = !this.formatting.enableCollapse;
        item.appendChild(toggle);
      }
      const label = document.createElement("span");
      label.className = "atlyn-semantic-label";
      label.textContent = node.subtitle ? `${node.label} - ${node.subtitle}` : node.label;
      item.appendChild(label);
      this.semanticTree.appendChild(item);
      this.semanticItems.set(id, item);
    });
  }

  private renderDiagnostics(renderCapped = false): void {
    this.diagnosticsElement.replaceChildren();
    this.diagnosticsElement.hidden =
      !this.formatting.showDiagnostics || (this.graph.diagnostics.length === 0 && !renderCapped);
    this.diagnosticsElement.setAttribute("aria-label", this.strings.diagnostics);
    if (this.diagnosticsElement.hidden) {
      return;
    }
    this.graph.diagnostics.forEach((item) => {
      const line = document.createElement("div");
      line.className = "atlyn-diagnostic";
      line.dataset.severity = item.severity;
      line.textContent = this.localizeDiagnostic(item);
      this.diagnosticsElement.appendChild(line);
    });
    if (renderCapped) {
      const line = document.createElement("div");
      line.className = "atlyn-diagnostic";
      line.dataset.severity = "warning";
      line.textContent = this.strings.renderCap;
      this.diagnosticsElement.appendChild(line);
    }
  }

  private renderBreadcrumb(): void {
    this.breadcrumbElement.replaceChildren();
    this.breadcrumbElement.setAttribute("aria-label", this.strings.breadcrumb);
    const activeId = this.focusedId ?? Array.from(this.selected)[0];
    const path = activeId ? getAncestorIds(this.graph, activeId, true) : [];
    const content = document.createElement("span");
    content.textContent =
      path.length > 0
        ? `${this.strings.breadcrumb}: ${path.map((id) => this.graph.nodes.get(id)?.label ?? id).join(" / ")}`
        : `${this.strings.breadcrumb}: -`;
    this.breadcrumbElement.appendChild(content);
  }

  private renderStatus(visibleCount: number, renderedCount: number): void {
    const selectedCount = this.selected.size;
    const selectedText = selectedCount > 0 ? `, ${selectedCount} ${this.strings.selected}` : "";
    const modeText =
      this.dataMode === "table"
        ? this.strings.tableMode
        : this.dataMode === "matrix"
          ? this.strings.matrixMode
          : "";
    const boundedText = this.graph.boundedContract
      ? `, ${TABLE_ROW_CAP.toLocaleString(this.locale)}-row ${this.strings.boundedContract}`
      : "";
    const stateText =
      this.dataState === "loading"
        ? `, ${this.strings.loading}`
        : this.dataState === "partial"
          ? `, ${this.strings.partial}`
          : "";
    const renderText =
      renderedCount < visibleCount
        ? `, ${renderedCount.toLocaleString(this.locale)} ${this.strings.rendered}`
        : "";
    this.status.textContent = `${modeText ? `${modeText}, ` : ""}${this.graph.receivedCount.toLocaleString(this.locale)} ${this.strings.received}, ${visibleCount.toLocaleString(this.locale)} ${this.strings.visible}, ${this.graph.excludedCount.toLocaleString(this.locale)} ${this.strings.excluded}${renderText}${boundedText}${stateText}${selectedText}`;
    this.emptyElement.hidden = this.graph.nodes.size > 0 && this.modeMessage.length === 0;
    this.emptyElement.textContent =
      this.modeMessage || (this.graph.nodes.size === 0 ? this.strings.noData : "");
  }

  private localizeDiagnostic(item: Diagnostic): string {
    const fallback = this.diagnosticFallback(item);
    const message = this.localize(`Diagnostic_${item.code}`, fallback);
    const count = item.count > 0 ? ` (${item.count.toLocaleString(this.locale)})` : "";
    const ids = item.nodeIds.length > 0
      ? `: ${item.nodeIds.slice(0, 6).join(", ")}${item.nodeIds.length > 6 ? ", ..." : ""}`
      : "";
    return `${message}${count}${ids}`;
  }

  private diagnosticFallback(item: Diagnostic): string {
    switch (item.code) {
      case "missing-required-fields":
        return item.message;
      case "invalid-cardinality":
      case "invalid-data-shape":
      case "partial-data":
        return item.message;
      case "empty-id":
        return "Rows with an empty NodeId were excluded.";
      case "empty-label":
        return "Nodes with an empty Label use an accessible fallback label.";
      case "duplicate-id":
        return "Duplicate NodeId values were received; the first table row is retained.";
      case "conflicting-duplicate":
        return "Conflicting duplicate NodeId rows are never selectable; the first table row is retained.";
      case "orphan":
        return "Nodes whose ParentId is missing are rendered as disconnected roots.";
      case "self-cycle":
        return "Self-referencing parent links were broken and rendered as roots.";
      case "cycle":
        return "Long parent cycles were broken at a deterministic node and retained.";
      case "multiple-roots":
        return "Multiple roots form a valid forest and are rendered side-by-side.";
      case "data-reduction":
        return item.message;
      case "node-cap":
        return item.message;
      case "depth-cap":
        return item.message;
      case "render-cap":
        return this.strings.renderCap;
      default:
        return item.message;
    }
  }

  private nodeAriaLabel(node: GraphModel["nodes"] extends Map<string, infer T> ? T : never): string {
    const childText = node.children.length === 1
      ? `1 ${this.strings.child}`
      : `${node.children.length} ${this.strings.children}`;
    const flags = node.qualityFlags.length > 0 ? `; ${node.qualityFlags.join(", ")}` : "";
    return `${node.label}${node.subtitle ? `, ${node.subtitle}` : ""}; ${this.strings.nodeId} ${node.id}; ${this.strings.depth} ${node.depth}; ${childText}${flags}`;
  }

  private matchesSearch(node: GraphModel["nodes"] extends Map<string, infer T> ? T : never): boolean {
    if (!this.searchQuery) {
      return false;
    }
    const query = this.searchQuery.toLocaleLowerCase(this.locale);
    return [node.id, node.label, node.subtitle, node.category]
      .some((value) => value.toLocaleLowerCase(this.locale).includes(query));
  }

  private onSearchInput = (): void => {
    if (!this.interactionsEnabled || !this.formatting.enableSearch) {
      return;
    }
    this.searchQuery = this.searchInput.value.trim();
    const match = Array.from(this.graph.nodes.keys())
      .sort((left, right) => left.localeCompare(right, this.locale, { numeric: true }))
      .find((id) => this.matchesSearch(this.graph.nodes.get(id)!));
    if (match) {
      this.focusNode(match);
      return;
    }
    this.render();
  };

  private onNodeClick(id: string, event: MouseEvent): void {
    if (!this.interactionsEnabled) {
      return;
    }
    if (this.suppressNextClick) {
      this.suppressNextClick = false;
      return;
    }
    this.focusedId = id;
    this.selectNode(id, event.ctrlKey || event.metaKey);
  }

  private selectNode(id: string, multiSelect: boolean): void {
    if (!this.interactionsEnabled) {
      return;
    }
    if (!multiSelect) {
      this.selected.clear();
    }
    if (multiSelect && this.selected.has(id)) {
      this.selected.delete(id);
    } else {
      this.selected.add(id);
    }
    const selectionIds = Array.from(this.selected)
      .map((selectedId) => this.selectionIds.get(selectedId))
      .filter((selectionId): selectionId is SelectionId => selectionId !== undefined);
    const manager = this.runtimeSelectionManager();
    if (selectionIds.length > 0 && manager.select) {
      void manager.select(selectionIds.length === 1 ? selectionIds[0] : selectionIds, multiSelect);
    } else if (selectionIds.length === 0 && manager.clear) {
      void manager.clear();
    }
    this.refreshSelectionState();
  }

  private selectDescendants(): void {
    if (!this.interactionsEnabled || !this.formatting.enableDescendantSelection) {
      return;
    }
    const activeId = this.focusedId ?? Array.from(this.selected)[0];
    if (!activeId || !this.graph.nodes.has(activeId)) {
      return;
    }
    const ids = getDescendantIds(this.graph, activeId, true);
    this.selected = new Set(ids);
    const selectionIds = ids
      .map((id) => this.selectionIds.get(id))
      .filter((selectionId): selectionId is SelectionId => selectionId !== undefined);
    if (selectionIds.length > 0) {
      void this.runtimeSelectionManager().select?.(selectionIds, true);
    }
    this.refreshSelectionState();
  }

  private clearSelection(): void {
    if (!this.interactionsEnabled) {
      return;
    }
    this.selected.clear();
    void this.runtimeSelectionManager().clear?.();
    this.refreshSelectionState();
  }

  private toggleCollapsed(id: string): void {
    if (!this.interactionsEnabled || !this.formatting.enableCollapse || !this.graph.nodes.get(id)?.children.length) {
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
    if (!this.interactionsEnabled) {
      return;
    }
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
        if (this.formatting.enableCollapse && this.collapsed.has(id)) {
          this.toggleCollapsed(id);
          event.preventDefault();
          return;
        }
        nextId = this.graph.nodes.get(id)?.children[0];
        break;
      case "ArrowLeft":
        if (this.formatting.enableCollapse && !this.collapsed.has(id) && (this.graph.nodes.get(id)?.children.length ?? 0) > 0) {
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
        if (event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
          this.typeaheadBuffer = `${this.typeaheadBuffer}${event.key}`.toLocaleLowerCase(this.locale);
          if (this.typeaheadTimer) {
            clearTimeout(this.typeaheadTimer);
          }
          this.typeaheadTimer = setTimeout(() => {
            this.typeaheadBuffer = "";
            this.typeaheadTimer = undefined;
          }, 700);
          nextId = flattenVisibleIds(this.graph, this.collapsed).find((candidate) => {
            const candidateNode = this.graph.nodes.get(candidate);
            return candidateNode?.label.toLocaleLowerCase(this.locale).startsWith(this.typeaheadBuffer);
          });
        }
        if (!nextId) {
          return;
        }
    }
    if (nextId) {
      this.focusNode(nextId);
      event.preventDefault();
    }
  }

  private onRootKeyDown = (event: KeyboardEvent): void => {
    if (!this.interactionsEnabled) {
      return;
    }
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
    if (this.formatting.enableCollapse) {
      getAncestorIds(this.graph, id).forEach((ancestorId) => this.collapsed.delete(ancestorId));
    }
    this.render();
    this.semanticItems.get(id)?.focus({ preventScroll: true });
  }

  private onCanvasContextMenu = (event: MouseEvent): void => {
    if (!this.interactionsEnabled) {
      return;
    }
    if ((event.target as Element).closest?.("[data-node-id], [data-semantic-node-id]")) {
      return;
    }
    event.preventDefault();
    this.showContextMenu(undefined, event.clientX, event.clientY);
  };

  private onCanvasClick = (event: MouseEvent): void => {
    if (!this.interactionsEnabled) {
      return;
    }
    if (
      !(event.target as Element).closest?.("[data-node-id]") &&
      !(event.target as Element).closest?.("[data-semantic-node-id]")
    ) {
      this.clearSelection();
    }
  };

  private onCanvasTouchStart = (event: TouchEvent): void => {
    if (!this.interactionsEnabled) {
      return;
    }
    if ((event.target as Element).closest?.("[data-node-id], [data-semantic-node-id]")) {
      return;
    }
    const touch = event.touches[0];
    if (!touch) {
      return;
    }
    this.clearLongPress();
    this.longPressTimer = setTimeout(() => {
      this.suppressNextClick = true;
      this.showContextMenu(undefined, touch.clientX, touch.clientY);
    }, LONG_PRESS_MS);
  };

  private onCanvasTouchEnd = (event: TouchEvent): void => {
    if (!this.interactionsEnabled) {
      return;
    }
    if (this.longPressTimer) {
      this.clearLongPress();
    }
    if (this.suppressNextClick) {
      event.preventDefault();
      this.suppressedClickTimer = setTimeout(() => {
        this.suppressNextClick = false;
        this.suppressedClickTimer = undefined;
      }, 0);
    }
  };

  private onCanvasTouchCancel = (): void => {
    this.clearLongPress();
  };

  private onNodeTouchStart = (id: string, event: TouchEvent): void => {
    if (!this.interactionsEnabled) {
      return;
    }
    const touch = event.touches[0];
    if (!touch) {
      return;
    }
    this.clearLongPress();
    this.longPressTimer = setTimeout(() => {
      this.suppressNextClick = true;
      this.showContextMenu(id, touch.clientX, touch.clientY);
    }, LONG_PRESS_MS);
  };

  private onTouchEnd = (event: TouchEvent): void => {
    if (!this.interactionsEnabled) {
      return;
    }
    this.clearLongPress();
    if (this.suppressNextClick) {
      event.preventDefault();
      this.suppressedClickTimer = setTimeout(() => {
        this.suppressNextClick = false;
        this.suppressedClickTimer = undefined;
      }, 0);
    }
  };

  private onTouchCancel = (): void => {
    this.clearLongPress();
  };

  private clearLongPress(): void {
    if (this.longPressTimer) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = undefined;
    }
  }

  private showContextMenu(id: string | undefined, x: number, y: number): void {
    if (!this.interactionsEnabled) {
      return;
    }
    const selectionId = id
      ? this.selectionIds.get(id) ?? this.host.createSelectionIdBuilder().createSelectionId()
      : this.host.createSelectionIdBuilder().createSelectionId();
    const manager = this.runtimeSelectionManager();
    if (manager.showContextMenu) {
      void manager.showContextMenu(selectionId, { x, y });
    }
  }

  private showTooltip(id: string, x: number, y: number, isTouchEvent: boolean): void {
    if (!this.interactionsEnabled) {
      return;
    }
    const node = this.graph.nodes.get(id);
    const tooltipService = this.host.tooltipService;
    if (
      !node ||
      !tooltipService ||
      typeof tooltipService.show !== "function" ||
      (typeof tooltipService.enabled === "function" && !tooltipService.enabled())
    ) {
      return;
    }
    const dataItems = [
      { displayName: this.strings.label, value: node.label },
      { displayName: this.strings.nodeId, value: node.id },
      { displayName: this.strings.parentId, value: node.parentId ?? "" },
      { displayName: this.strings.depth, value: String(node.depth) },
      { displayName: this.strings.childCount, value: String(node.children.length) },
      { displayName: this.strings.category, value: node.category },
      { displayName: this.strings.value, value: node.value === undefined || node.value === null ? "" : text(node.value) },
      { displayName: this.strings.sourceRow, value: String(node.sourceRow + 1) },
      ...Object.entries(node.tooltips).map(([displayName, value]) => ({
        displayName,
        value: text(value)
      })),
      ...(node.qualityFlags.length > 0
        ? [{ displayName: this.strings.dataQuality, value: node.qualityFlags.join(", ") }]
        : [])
    ];
    const selectionId = this.selectionIds.get(id);
    tooltipService.show({
      dataItems,
      identities: selectionId ? [selectionId] : [],
      coordinates: [x, y],
      isTouchEvent
    });
    this.tooltipNodeId = id;
  }

  private hideTooltip(): void {
    const tooltipService = this.host.tooltipService;
    if (tooltipService && typeof tooltipService.hide === "function") {
      tooltipService.hide({ immediately: true, isTouchEvent: false });
    }
    this.tooltipNodeId = null;
  }

  private showRenderFailure(error: unknown): void {
    this.graphSvg.replaceChildren();
    this.semanticTree.replaceChildren();
    this.emptyElement.hidden = false;
    this.emptyElement.textContent = "Unable to render hierarchy.";
    this.status.textContent = "";
    this.diagnosticsElement.hidden = false;
    const line = document.createElement("div");
    line.className = "atlyn-diagnostic";
    line.dataset.severity = "error";
    line.textContent = `Unable to render hierarchy: ${error instanceof Error ? error.message : text(error)}`;
    this.diagnosticsElement.replaceChildren(line);
  }

  private fireRenderingEvent(
    name: "renderingStarted" | "renderingFinished" | "renderingFailed",
    options: VisualUpdateOptions,
    error?: unknown
  ): void {
    const service = this.host.eventService;
    if (name === "renderingStarted") {
      service?.renderingStarted?.(options);
    } else if (name === "renderingFinished") {
      service?.renderingFinished?.(options);
    } else {
      service?.renderingFailed?.(options, error instanceof Error ? error.message : text(error));
    }
  }

  private refreshStrings(): void {
    const localized = getLocaleStrings(this.locale);
    this.strings = {
      ...localized,
      visualName: this.localize("Visual_Name", localized.visualName),
      searchLabel: this.localize("UI_Search", localized.searchLabel),
      searchPlaceholder: this.localize("UI_SearchPlaceholder", localized.searchPlaceholder),
      selectDescendants: this.localize("UI_SelectDescendants", localized.selectDescendants),
      clearSelection: this.localize("UI_ClearSelection", localized.clearSelection),
      received: this.localize("UI_Received", localized.received),
      visible: this.localize("UI_Visible", localized.visible),
      excluded: this.localize("UI_Excluded", localized.excluded),
      noData: this.localize("UI_NoData", localized.noData),
      unnamed: this.localize("UI_Unnamed", localized.unnamed),
      expand: this.localize("UI_Expand", localized.expand),
      collapse: this.localize("UI_Collapse", localized.collapse),
      breadcrumb: this.localize("UI_Breadcrumb", localized.breadcrumb),
      diagnostics: this.localize("UI_Diagnostics", localized.diagnostics),
      selected: this.localize("UI_Selected", localized.selected),
      descendants: this.localize("UI_Descendants", localized.descendants),
      child: this.localize("UI_Child", localized.child),
      children: this.localize("UI_Children", localized.children),
      graph: this.localize("UI_Graph", localized.graph),
      tree: this.localize("UI_Tree", localized.tree),
      label: this.localize("UI_Label", localized.label),
      nodeId: this.localize("UI_NodeId", localized.nodeId),
      parentId: this.localize("UI_ParentId", localized.parentId),
      depth: this.localize("UI_Depth", localized.depth),
      childCount: this.localize("UI_ChildCount", localized.childCount),
      category: this.localize("UI_Category", localized.category),
      value: this.localize("UI_Value", localized.value),
      dataQuality: this.localize("UI_DataQuality", localized.dataQuality),
      sourceRow: this.localize("UI_SourceRow", localized.sourceRow),
      emptySpace: this.localize("UI_EmptySpace", localized.emptySpace),
      matrixUnsupported: this.localize("UI_MatrixUnsupported", localized.matrixUnsupported),
      boundedContract: this.localize("UI_BoundedContract", localized.boundedContract),
      tableMode: this.localize("UI_TableMode", localized.tableMode),
      matrixMode: this.localize("UI_MatrixMode", localized.matrixMode),
      loading: this.localize("UI_Loading", localized.loading),
      partial: this.localize("UI_Partial", localized.partial),
      rendered: this.localize("UI_Rendered", localized.rendered),
      renderCap: this.localize("UI_RenderCap", localized.renderCap)
    };
    this.root.setAttribute("aria-label", this.strings.visualName);
    this.searchLabel.textContent = `${this.strings.searchLabel}:`;
    this.searchInput.placeholder = this.strings.searchPlaceholder;
    this.searchInput.setAttribute("aria-label", this.strings.searchLabel);
    this.selectDescendantsButton.textContent = this.strings.selectDescendants;
    this.clearSelectionButton.textContent = this.strings.clearSelection;
  }

  private localize(key: string, fallback: string): string {
    const value = this.localizationManager?.getDisplayName?.(key);
    return value && value !== key ? value : fallback;
  }

  private resolveDirection(direction: LayoutDirection): "ltr" | "rtl" {
    if (direction === "ltr" || direction === "rtl") {
      return direction;
    }
    return isRtlLocale(this.locale) ? "rtl" : "ltr";
  }

  private applyFormatting(): void {
    const highContrast = this.host.colorPalette?.isHighContrast === true;
    const palette = this.host.colorPalette;
    const paletteColor = (name: "foreground" | "background" | "foregroundSelected"): string | undefined => {
      const color = palette?.[name];
      return color?.value;
    };
    const background = highContrast
      ? paletteColor("background") ?? "#000000"
      : this.formatting.backgroundColor;
    const foreground = highContrast
      ? paletteColor("foreground") ?? "#ffffff"
      : this.formatting.labelColor;
    const selected = highContrast
      ? paletteColor("foregroundSelected") ?? foreground
      : this.formatting.selectedColor;
    this.root.dir = this.direction;
    this.root.dataset.highContrast = String(highContrast);
    this.root.dataset.interactionsDisabled = String(!this.interactionsEnabled);
    const reducedMotion =
      this.formatting.reducedMotion ||
      (typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    this.root.dataset.reducedMotion = String(reducedMotion);
    this.root.style.setProperty("--atlyn-background", background);
    this.root.style.setProperty("--atlyn-foreground", foreground);
    this.root.style.setProperty("--atlyn-muted", highContrast ? foreground : this.formatting.subtitleColor);
    this.root.style.setProperty("--atlyn-accent", highContrast ? foreground : selected);
    this.root.style.setProperty("--atlyn-selected", selected);
    this.root.style.setProperty("--atlyn-border", highContrast ? foreground : this.formatting.edgeColor);
    this.root.style.setProperty("--atlyn-node-fill", highContrast ? background : this.formatting.nodeColor);
    this.root.style.setProperty("--atlyn-label", foreground);
    this.root.style.setProperty("--atlyn-subtitle", highContrast ? foreground : this.formatting.subtitleColor);
    this.root.style.setProperty("--atlyn-edge", highContrast ? foreground : this.formatting.edgeColor);
    this.root.style.setProperty("--atlyn-font-family", this.formatting.fontFamily);
    this.root.style.setProperty("--atlyn-label-size", `${this.formatting.fontSize}px`);
    this.root.style.setProperty("--atlyn-subtitle-size", `${this.formatting.subtitleFontSize}px`);
    this.root.style.setProperty("--atlyn-edge-width", String(highContrast ? Math.max(2, this.formatting.edgeWidth) : this.formatting.edgeWidth));
    this.searchInput.disabled = !this.interactionsEnabled || !this.formatting.enableSearch;
    this.selectDescendantsButton.disabled = !this.interactionsEnabled || this.selected.size === 0;
    this.clearSelectionButton.disabled = !this.interactionsEnabled || this.selected.size === 0;
  }
}
