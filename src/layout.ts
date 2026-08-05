import { GraphModel, HierarchyNode } from "./graph";

export interface LayoutOptions {
  width: number;
  height: number;
  direction?: "ltr" | "rtl";
  nodeWidth?: number;
  nodeHeight?: number;
  horizontalGap?: number;
  verticalGap?: number;
  padding?: number;
  fitContent?: boolean;
  fontSize?: number;
  subtitleFontSize?: number;
}

export interface LayoutPoint {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
}

export interface LayoutResult {
  points: Map<string, LayoutPoint>;
  width: number;
  height: number;
}

/**
 * Average glyph advance as a fraction of the font size, used to size a node
 * card from the text it has to hold. Exported because the renderer has to trim
 * labels against the same estimate: if the two ever disagree, either cards are
 * drawn too narrow for text that was not trimmed, or text is trimmed that would
 * have fitted. Arial and the common Linux substitutes all average below this.
 */
export const GLYPH_WIDTH_RATIO = 0.58;

/** Horizontal inset between a node card's edge and its text, per side. */
export const NODE_TEXT_INSET = 8;


function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function nodeWidth(node: HierarchyNode, options: LayoutOptions): number {
  const minimum = Math.max(96, options.nodeWidth ?? 156);
  if (options.fitContent === false) {
    return minimum;
  }
  const fontSize = Math.max(8, options.fontSize ?? 12);
  const subtitleSize = Math.max(7, options.subtitleFontSize ?? 10);
  const longestText = Math.max(
    node.label.length * fontSize * GLYPH_WIDTH_RATIO,
    node.subtitle.length * subtitleSize * GLYPH_WIDTH_RATIO
  );
  return clamp(Math.ceil(longestText + NODE_TEXT_INSET * 3), minimum, minimum * 2.5);
}

/**
 * Places each parent over the center of its visible children using a
 * deterministic tidy-tree pass. The input is already capped and sorted by the
 * graph normalizer, so this remains bounded for wide and deep forests.
 */
export function computeLayout(
  graph: GraphModel,
  visibleIds: readonly string[],
  options: LayoutOptions
): LayoutResult {
  const nodeHeight = Math.max(32, options.nodeHeight ?? 48);
  const horizontalGap = Math.max(12, options.horizontalGap ?? 38);
  const verticalGap = Math.max(8, options.verticalGap ?? 14);
  const padding = Math.max(4, options.padding ?? 12);
  const direction = options.direction ?? "ltr";
  const visible = new Set(visibleIds);
  const points = new Map<string, LayoutPoint>();
  const widths = new Map<string, number>();
  const depthWidths = new Map<number, number>();
  let maxDepth = 0;

  visibleIds.forEach((id) => {
    const node = graph.nodes.get(id);
    if (!node) {
      return;
    }
    const width = nodeWidth(node, options);
    widths.set(id, width);
    depthWidths.set(node.depth, Math.max(depthWidths.get(node.depth) ?? 0, width));
    maxDepth = Math.max(maxDepth, node.depth);
  });

  const depthX = new Map<number, number>();
  let nextX = padding;
  for (let depth = 0; depth <= maxDepth; depth += 1) {
    depthX.set(depth, nextX);
    nextX += (depthWidths.get(depth) ?? Math.max(96, options.nodeWidth ?? 156)) + horizontalGap;
  }
  const contentWidth = Math.max(
    Math.max(160, options.width),
    nextX - horizontalGap + padding
  );

  const visibleChildren = (id: string): string[] =>
    (graph.nodes.get(id)?.children ?? []).filter((child) => visible.has(child));
  const visibleRoots = visibleIds.filter((id) => {
    const parentId = graph.nodes.get(id)?.parentId;
    return !parentId || !visible.has(parentId);
  });
  const yById = new Map<string, number>();
  let cursorY = padding;
  const place = (id: string): number => {
    const children = visibleChildren(id);
    let y: number;
    if (children.length === 0) {
      y = cursorY;
      cursorY += nodeHeight + verticalGap;
    } else {
      const childCenters = children.map((child) => place(child) + nodeHeight / 2);
      y = (childCenters[0] + childCenters[childCenters.length - 1]) / 2 - nodeHeight / 2;
      if (y < padding) {
        y = padding;
      }
    }
    yById.set(id, y);
    return y;
  };
  visibleRoots.forEach((rootId, index) => {
    place(rootId);
    if (index < visibleRoots.length - 1) {
      cursorY += verticalGap;
    }
  });

  const contentHeight = Math.max(
    Math.max(150, options.height),
    (cursorY > padding ? cursorY - verticalGap : padding) + padding
  );
  visibleIds.forEach((id) => {
    const node = graph.nodes.get(id);
    const y = yById.get(id);
    if (!node || y === undefined) {
      return;
    }
    const width = widths.get(id) ?? Math.max(96, options.nodeWidth ?? 156);
    const ltrX = depthX.get(node.depth) ?? padding;
    const x = direction === "rtl" ? contentWidth - ltrX - width : ltrX;
    points.set(id, {
      id,
      x,
      y,
      width,
      height: nodeHeight,
      depth: node.depth
    });
  });

  return { points, width: contentWidth, height: contentHeight };
}
