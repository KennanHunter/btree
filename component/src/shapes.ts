import type { AnimationID, NodeData, TreeData } from "core";

export const CELL_W = 48;
export const CELL_H = 32;
export const H_GAP = 24;
export const V_GAP = 36;
export const CANVAS_PADDING = 8;

export type Laid = {
  node: NodeData;
  width: number;
  height: number;
  nodeW: number;
  nodeH: number;
  hasChildren: boolean;
  children: Laid[];
};

export type Shape =
  | {
      kind: "rect";
      x: number;
      y: number;
      w: number;
      h: number;
      role: "key_cell" | "child_cell";
      node: AnimationID;
      key?: AnimationID;
      slot?: number;
    }
  | {
      kind: "text";
      x: number;
      y: number;
      value: string;
      node: AnimationID;
      key: AnimationID;
    }
  | {
      kind: "line";
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      from: AnimationID;
      to: AnimationID;
      slot: number;
    };

export type ShapeResult = {
  shapes: Shape[];
  width: number;
  height: number;
};

export function layout(data: TreeData, node: NodeData): Laid {
  const hasChildren = node.children.length > 0;
  const cols = Math.max(
    node.data_keys.length,
    hasChildren ? node.children.length : 0,
    1,
  );
  const nodeW = cols * CELL_W;
  const nodeH = hasChildren ? 2 * CELL_H : CELL_H;

  const children = node.children.map((id) => layout(data, data.nodes[id]));
  const childrenW =
    children.reduce((a, c) => a + c.width, 0) +
    Math.max(0, children.length - 1) * H_GAP;
  const childrenH = children.length
    ? V_GAP + Math.max(...children.map((c) => c.height))
    : 0;

  return {
    node,
    width: Math.max(nodeW, childrenW),
    height: nodeH + childrenH,
    nodeW,
    nodeH,
    hasChildren,
    children,
  };
}

export function draw(laid: Laid, x: number, y: number, out: Shape[]) {
  const nodeX = x + (laid.width - laid.nodeW) / 2;
  const keys = laid.node.data_keys;
  const topCols = Math.max(keys.length, 1);
  const topCellW = laid.nodeW / topCols;

  for (let i = 0; i < topCols; i++) {
    const key = keys[i];
    out.push({
      kind: "rect",
      role: "key_cell",
      node: laid.node.id,
      key: key?.id,
      x: nodeX + i * topCellW,
      y,
      w: topCellW,
      h: CELL_H,
    });
    if (key !== undefined) {
      out.push({
        kind: "text",
        node: laid.node.id,
        key: key.id,
        x: nodeX + (i + 0.5) * topCellW,
        y: y + CELL_H / 2,
        value: String(key.value),
      });
    }
  }

  if (laid.hasChildren) {
    for (let i = 0; i < laid.node.children.length; i++) {
      out.push({
        kind: "rect",
        role: "child_cell",
        node: laid.node.id,
        slot: i,
        x: nodeX + i * CELL_W,
        y: y + CELL_H,
        w: CELL_W,
        h: CELL_H,
      });
    }

    const childrenW =
      laid.children.reduce((a, c) => a + c.width, 0) +
      Math.max(0, laid.children.length - 1) * H_GAP;
    let cx = x + (laid.width - childrenW) / 2;
    const childY = y + laid.nodeH + V_GAP;

    laid.children.forEach((cl, i) => {
      const slotX = nodeX + (i + 0.5) * CELL_W;
      const slotY = y + CELL_H + CELL_H;
      const childTopX = cx + cl.width / 2;
      out.push({
        kind: "line",
        from: laid.node.id,
        to: cl.node.id,
        slot: i,
        x1: slotX,
        y1: slotY,
        x2: childTopX,
        y2: childY,
      });
      draw(cl, cx, childY, out);
      cx += cl.width + H_GAP;
    });
  }
}

export function build_shapes(data: TreeData): ShapeResult {
  if (data.root == null) return { shapes: [], width: 0, height: 0 };
  const laid = layout(data, data.nodes[data.root]);
  const out: Shape[] = [];
  draw(laid, CANVAS_PADDING, CANVAS_PADDING, out);
  return { shapes: out, width: laid.width, height: laid.height };
}

export function measure(data: TreeData): { width: number; height: number } {
  const r = build_shapes(data);
  return { width: r.width, height: r.height };
}
