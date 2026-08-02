import { GraphModel } from "./graph";

export interface LayoutOptions {
  width: number;
  height: number;
  direction?: "ltr" | "rtl";
  nodeWidth?: number;
  nodeHeight?: number;
  horizontalGap?: number;
  verticalGap?: number;
  padding?: number;
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
 * A bounded, deterministic grid layout. It avoids force simulation and has no
 * hidden work proportional to anything outside the visible forest.
 */
export function computeLayout(
  graph: GraphModel,
  visibleIds: readonly string[],
  options: LayoutOptions
): LayoutResult {
  const nodeWidth = Math.max(112, options.nodeWidth ?? 156);
  const nodeHeight = Math.max(38, options.nodeHeight ?? 48);
  const horizontalGap = Math.max(12, options.horizontalGap ?? 38);
  const verticalGap = Math.max(8, options.verticalGap ?? 14);
  const padding = Math.max(4, options.padding ?? 12);
  const width = Math.max(
    Math.max(160, options.width),
    padding * 2 + (graph.maxDepth + 1) * nodeWidth + graph.maxDepth * horizontalGap
  );
  const height = Math.max(
    Math.max(150, options.height),
    padding * 2 + visibleIds.length * nodeHeight + Math.max(0, visibleIds.length - 1) * verticalGap
  );
  const points = new Map<string, LayoutPoint>();
  const direction = options.direction ?? "ltr";

  visibleIds.forEach((id, index) => {
    const node = graph.nodes.get(id);
    if (!node) {
      return;
    }
    const ltrX = padding + node.depth * (nodeWidth + horizontalGap);
    const x = direction === "rtl" ? width - ltrX - nodeWidth : ltrX;
    points.set(id, {
      id,
      x,
      y: padding + index * (nodeHeight + verticalGap),
      width: nodeWidth,
      height: nodeHeight,
      depth: node.depth
    });
  });
  return { points, width, height };
}
