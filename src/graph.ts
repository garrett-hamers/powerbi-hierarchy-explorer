export type DiagnosticCode =
  | "missing-required-fields"
  | "empty-id"
  | "empty-label"
  | "duplicate-id"
  | "conflicting-duplicate"
  | "orphan"
  | "self-cycle"
  | "cycle"
  | "multiple-roots"
  | "data-reduction"
  | "node-cap"
  | "depth-cap";

export type DiagnosticSeverity = "info" | "warning" | "error";

export interface Diagnostic {
  code: DiagnosticCode;
  severity: DiagnosticSeverity;
  message: string;
  count: number;
  nodeIds: string[];
}

export interface HierarchyRow {
  nodeId: unknown;
  parentId?: unknown;
  label?: unknown;
  subtitle?: unknown;
  category?: unknown;
  value?: unknown;
  tooltips?: Record<string, unknown>;
  sourceRow?: number;
}

export interface GraphInput {
  rows: readonly HierarchyRow[];
  receivedCount?: number;
  truncated?: boolean;
  boundedContract?: boolean;
  rolesPresent?: Partial<Record<"NodeId" | "ParentId" | "Label", boolean>>;
}

export interface GraphOptions {
  nodeCap?: number;
  depthCap?: number;
}

export interface HierarchyNode {
  id: string;
  parentId: string | null;
  label: string;
  subtitle: string;
  category: string;
  value: unknown;
  tooltips: Record<string, unknown>;
  children: string[];
  depth: number;
  sourceRow: number;
  qualityFlags: DiagnosticCode[];
}

export interface GraphModel {
  nodes: Map<string, HierarchyNode>;
  roots: string[];
  diagnostics: Diagnostic[];
  receivedCount: number;
  retainedCount: number;
  excludedCount: number;
  truncated: boolean;
  maxDepth: number;
  nodeCap: number;
  depthCap: number;
  boundedContract: boolean;
}

export const TABLE_ROW_CAP = 30000;
export const DEFAULT_NODE_CAP = 10000;
export const DEFAULT_DEPTH_CAP = 50;

const ROLE_NAMES: Array<"NodeId" | "ParentId" | "Label"> = ["NodeId", "ParentId", "Label"];

function text(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value);
}

export function normalizeId(value: unknown): string | null {
  const normalized = text(value).trim();
  return normalized.length > 0 ? normalized : null;
}

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

function sameRow(left: HierarchyRow, right: HierarchyRow): boolean {
  return [
    stableValue(left.parentId),
    stableValue(left.label),
    stableValue(left.subtitle),
    stableValue(left.category),
    stableValue(left.value),
    stableValue(left.tooltips)
  ].join("\u001f") === [
    stableValue(right.parentId),
    stableValue(right.label),
    stableValue(right.subtitle),
    stableValue(right.category),
    stableValue(right.value),
    stableValue(right.tooltips)
  ].join("\u001f");
}

function diagnostic(
  code: DiagnosticCode,
  severity: DiagnosticSeverity,
  message: string,
  nodeIds: Iterable<string> = []
): Diagnostic {
  const ids = Array.from(new Set(nodeIds)).sort();
  return { code, severity, message, count: ids.length, nodeIds: ids };
}

function addQualityFlag(
  quality: Map<string, Set<DiagnosticCode>>,
  id: string,
  code: DiagnosticCode
): void {
  const flags = quality.get(id) ?? new Set<DiagnosticCode>();
  flags.add(code);
  quality.set(id, flags);
}

function sortIds(ids: Iterable<string>): string[] {
  return Array.from(ids).sort((left, right) => left.localeCompare(right, "en", { numeric: true }));
}

/**
 * Converts explicit parent-child rows into a normalized, deterministic forest.
 * Invalid edges are broken rather than dropping otherwise useful components.
 */
export function buildHierarchy(
  input: GraphInput | readonly HierarchyRow[],
  options: GraphOptions = {}
): GraphModel {
  const normalizedInput: GraphInput = Array.isArray(input)
    ? { rows: Array.from(input as readonly HierarchyRow[]) }
    : input as GraphInput;
  const rows = normalizedInput.rows;
  const nodeCap = Math.max(1, options.nodeCap ?? DEFAULT_NODE_CAP);
  const depthCap = Math.max(0, options.depthCap ?? DEFAULT_DEPTH_CAP);
  const diagnostics: Diagnostic[] = [];
  const quality = new Map<string, Set<DiagnosticCode>>();
  const records = new Map<string, HierarchyRow>();
  const duplicateIds = new Set<string>();
  const conflictingIds = new Set<string>();
  const emptyIds: string[] = [];
  const emptyLabels: string[] = [];

  const missingRoles = ROLE_NAMES.filter((role) => normalizedInput.rolesPresent?.[role] === false);
  if (missingRoles.length > 0) {
    diagnostics.push(
      diagnostic(
        "missing-required-fields",
        "error",
        `Required field(s) missing: ${missingRoles.join(", ")}.`
      )
    );
  }

  rows.forEach((row, index) => {
    const id = normalizeId(row.nodeId);
    if (!id) {
      emptyIds.push(String(index));
      return;
    }
    if (records.has(id)) {
      duplicateIds.add(id);
      const original = records.get(id)!;
      if (!sameRow(original, row)) {
        conflictingIds.add(id);
      }
      addQualityFlag(quality, id, "duplicate-id");
      if (!sameRow(original, row)) {
        addQualityFlag(quality, id, "conflicting-duplicate");
      }
      return;
    }
    records.set(id, { ...row, sourceRow: row.sourceRow ?? index });
    if (!text(row.label).trim()) {
      emptyLabels.push(id);
      addQualityFlag(quality, id, "empty-label");
    }
  });

  if (emptyIds.length > 0) {
    diagnostics.push(diagnostic("empty-id", "error", "Rows with an empty NodeId were excluded.", emptyIds));
  }
  if (emptyLabels.length > 0) {
    diagnostics.push(
      diagnostic("empty-label", "warning", "Nodes with an empty Label use an accessible fallback label.", emptyLabels)
    );
  }
  if (duplicateIds.size > 0) {
    diagnostics.push(
      diagnostic(
        "duplicate-id",
        "error",
        "Duplicate NodeId values were received; the first row is retained.",
        duplicateIds
      )
    );
  }
  if (conflictingIds.size > 0) {
    diagnostics.push(
      diagnostic(
        "conflicting-duplicate",
        "error",
        "Duplicate NodeId rows contain conflicting values; the first row is retained.",
        conflictingIds
      )
    );
  }

  const ids = sortIds(records.keys());
  const parentById = new Map<string, string | null>();
  const orphanIds: string[] = [];
  for (const id of ids) {
    const parentId = normalizeId(records.get(id)!.parentId);
    if (parentId === id) {
      parentById.set(id, id);
    } else if (parentId && records.has(parentId)) {
      parentById.set(id, parentId);
    } else {
      parentById.set(id, null);
      if (parentId) {
        orphanIds.push(id);
        addQualityFlag(quality, id, "orphan");
      }
    }
  }
  if (orphanIds.length > 0) {
    diagnostics.push(
      diagnostic(
        "orphan",
        "warning",
        "Nodes whose ParentId is missing are rendered as disconnected roots.",
        orphanIds
      )
    );
  }

  const cycleIds = new Set<string>();
  const selfCycleIds: string[] = [];
  const cycleGroups: string[][] = [];
  const visited = new Set<string>();
  for (const start of ids) {
    if (visited.has(start)) {
      continue;
    }
    const path: string[] = [];
    const positions = new Map<string, number>();
    let current: string | null = start;
    while (current && !visited.has(current)) {
      const position = positions.get(current);
      if (position !== undefined) {
        const cycle = path.slice(position);
        const breakId = sortIds(cycle)[0];
        parentById.set(breakId, null);
        cycleGroups.push(cycle);
        cycle.forEach((id) => {
          cycleIds.add(id);
          addQualityFlag(quality, id, cycle.length === 1 ? "self-cycle" : "cycle");
        });
        if (cycle.length === 1) {
          selfCycleIds.push(...cycle);
        }
        break;
      }
      positions.set(current, path.length);
      path.push(current);
      current = parentById.get(current) ?? null;
    }
    path.forEach((id) => visited.add(id));
  }
  if (selfCycleIds.length > 0) {
    diagnostics.push(
      diagnostic("self-cycle", "error", "Self-referencing parent links were broken and rendered as roots.", selfCycleIds)
    );
  }
  const longCycleIds = sortIds(Array.from(cycleIds).filter((id) => !selfCycleIds.includes(id)));
  if (longCycleIds.length > 0) {
    diagnostics.push(
      diagnostic(
        "cycle",
        "error",
        "Long parent cycles were broken at a deterministic node and the component was retained.",
        longCycleIds
      )
    );
  }

  const cappedIds = ids.slice(0, nodeCap);
  const excludedByNodeCap = ids.slice(nodeCap);
  if (excludedByNodeCap.length > 0) {
    diagnostics.push(
      diagnostic(
        "node-cap",
        "warning",
        `The node cap (${nodeCap.toLocaleString()}) excluded additional nodes.`,
        excludedByNodeCap
      )
    );
  }
  const retainedSet = new Set(cappedIds);
  const includedParentById = new Map<string, string | null>();
  cappedIds.forEach((id) => {
    const parentId = parentById.get(id) ?? null;
    includedParentById.set(id, parentId && retainedSet.has(parentId) ? parentId : null);
    if (parentId && !retainedSet.has(parentId)) {
      addQualityFlag(quality, id, "node-cap");
    }
  });

  const childrenById = new Map<string, string[]>();
  cappedIds.forEach((id) => childrenById.set(id, []));
  cappedIds.forEach((id) => {
    const parentId = includedParentById.get(id);
    if (parentId) {
      childrenById.get(parentId)!.push(id);
    }
  });
  childrenById.forEach((children) => children.sort((left, right) => left.localeCompare(right, "en", { numeric: true })));

  const depthById = new Map<string, number>();
  const roots = sortIds(cappedIds.filter((id) => !includedParentById.get(id)));
  const queue = roots.map((id) => ({ id, depth: 0 }));
  while (queue.length > 0) {
    const item = queue.shift()!;
    if (depthById.has(item.id)) {
      continue;
    }
    depthById.set(item.id, item.depth);
    childrenById.get(item.id)!.forEach((child) => queue.push({ id: child, depth: item.depth + 1 }));
  }

  const excludedByDepth = cappedIds.filter((id) => (depthById.get(id) ?? depthCap + 1) > depthCap);
  if (excludedByDepth.length > 0) {
    diagnostics.push(
      diagnostic(
        "depth-cap",
        "warning",
        `The depth cap (${depthCap.toLocaleString()}) excluded descendants beyond the supported depth.`,
        excludedByDepth
      )
    );
  }
  const depthExcludedSet = new Set(excludedByDepth);
  const retainedIds = cappedIds.filter((id) => !depthExcludedSet.has(id));
  const finalSet = new Set(retainedIds);
  const nodes = new Map<string, HierarchyNode>();
  retainedIds.forEach((id) => {
    const row = records.get(id)!;
    const label = text(row.label).trim() || "Unnamed node";
    const parentId = includedParentById.get(id) && finalSet.has(includedParentById.get(id)!) ? includedParentById.get(id)! : null;
    const flags = new Set(quality.get(id) ?? []);
    if (depthExcludedSet.has(id)) {
      flags.add("depth-cap");
    }
    nodes.set(id, {
      id,
      parentId,
      label,
      subtitle: text(row.subtitle).trim(),
      category: text(row.category).trim(),
      value: row.value,
      tooltips: { ...(row.tooltips ?? {}) },
      children: [],
      depth: depthById.get(id) ?? 0,
      sourceRow: row.sourceRow ?? 0,
      qualityFlags: sortIds(flags) as DiagnosticCode[]
    });
  });
  nodes.forEach((node) => {
    if (node.parentId && nodes.has(node.parentId)) {
      nodes.get(node.parentId)!.children.push(node.id);
    }
  });
  nodes.forEach((node) => node.children.sort((left, right) => left.localeCompare(right, "en", { numeric: true })));
  const finalRoots = sortIds(Array.from(nodes.values()).filter((node) => !node.parentId).map((node) => node.id));
  const finalDepthById = new Map<string, number>();
  const depthQueue = finalRoots.map((id) => ({ id, depth: 0 }));
  while (depthQueue.length > 0) {
    const item = depthQueue.shift()!;
    if (finalDepthById.has(item.id)) {
      continue;
    }
    finalDepthById.set(item.id, item.depth);
    nodes.get(item.id)?.children.forEach((child) => depthQueue.push({ id: child, depth: item.depth + 1 }));
  }
  nodes.forEach((node) => {
    node.depth = finalDepthById.get(node.id) ?? 0;
  });
  if (finalRoots.length > 1) {
    diagnostics.push(
      diagnostic("multiple-roots", "info", "Multiple roots form a forest and are rendered side-by-side.", finalRoots)
    );
  }

  let maxDepth = 0;
  nodes.forEach((node) => {
    maxDepth = Math.max(maxDepth, node.depth);
  });
  const receivedCount = normalizedInput.receivedCount ?? rows.length;
  const truncated =
    normalizedInput.truncated === true || receivedCount > rows.length || rows.length >= TABLE_ROW_CAP;
  const boundedContract = normalizedInput.boundedContract === true || truncated;
  if (truncated) {
    diagnostics.push(
      diagnostic(
        "data-reduction",
        "warning",
        boundedContract
          ? `The table is rendered under the explicit ${TABLE_ROW_CAP.toLocaleString()}-row bounded contract; additional host segments may not be loaded (received ${rows.length.toLocaleString()} rows).`
          : `Data reduction may have truncated the received table (received ${rows.length.toLocaleString()} rows).`
      )
    );
  }
  const excludedCount = Math.max(0, receivedCount - retainedIds.length);
  return {
    nodes,
    roots: finalRoots,
    diagnostics,
    receivedCount,
    retainedCount: nodes.size,
    excludedCount,
    truncated,
    maxDepth,
    nodeCap,
    depthCap,
    boundedContract
  };
}

export function getDescendantIds(graph: GraphModel, id: string, includeSelf = false): string[] {
  const result: string[] = includeSelf && graph.nodes.has(id) ? [id] : [];
  const queue = [...(graph.nodes.get(id)?.children ?? [])];
  while (queue.length > 0) {
    const child = queue.shift()!;
    result.push(child);
    queue.push(...(graph.nodes.get(child)?.children ?? []));
  }
  return result;
}

export function getAncestorIds(graph: GraphModel, id: string, includeSelf = false): string[] {
  const result: string[] = [];
  let current: string | null = includeSelf ? id : graph.nodes.get(id)?.parentId ?? null;
  const seen = new Set<string>();
  while (current && graph.nodes.has(current) && !seen.has(current)) {
    result.unshift(current);
    seen.add(current);
    current = graph.nodes.get(current)!.parentId;
  }
  return result;
}

export function flattenVisibleIds(graph: GraphModel, collapsed: ReadonlySet<string>): string[] {
  const result: string[] = [];
  const visit = (id: string): void => {
    result.push(id);
    if (!collapsed.has(id)) {
      graph.nodes.get(id)?.children.forEach(visit);
    }
  };
  graph.roots.forEach(visit);
  return result;
}
