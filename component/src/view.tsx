import { createEffect, createMemo, For, Show } from "solid-js";
import type { JSX } from "solid-js";
import type { AnimationID, Snapshot, TreeData } from "core";
import type { Operation } from "./operation";
import { step_at } from "./operation";
import { empty_highlight, highlight_from, type Highlight } from "./highlight";

// NOTE: this view requires an `op`. The caller is expected to seed an initial
// Operation (e.g. a `bulk_insert` of the starting values) so there is always
// something to display — see `tree-context` for how that's wired.

// ---------------------------------------------------------------------------
// Layout constants (ported from the old shapes.ts).
// ---------------------------------------------------------------------------

export const CELL_W = 48;
export const CELL_H = 32;
export const H_GAP = 24;
export const V_GAP = 36;
export const CANVAS_PADDING = 8;

// ---------------------------------------------------------------------------
// Frame: one laid-out tree, keyed by stable IDs so DOM elements survive
// between steps (required for CSS transitions to animate anything).
// ---------------------------------------------------------------------------

export type NodeBox = {
  id: AnimationID;
  x: number;
  y: number;
  w: number;
  h: number;
  leaf: boolean;
};
export type KeyBox = {
  id: AnimationID;
  node: AnimationID;
  value: number;
  x: number;
  y: number;
  w: number;
  h: number;
};
export type EdgeLine = {
  id: string;
  from: AnimationID;
  to: AnimationID;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};
// A single child pointer slot inside an internal node's bottom row.
// id = `${node}:${slot}` for stable rendering across frames.
export type SlotBox = {
  id: string;
  node: AnimationID;
  slot: number;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type Frame = {
  nodes: Map<AnimationID, NodeBox>;
  keys: Map<AnimationID, KeyBox>;
  slots: Map<string, SlotBox>;
  edges: Map<string, EdgeLine>; // id = `${from}->${to}`, matching Highlight.edges
  width: number;
  height: number;
};

const EMPTY_FRAME: Frame = {
  nodes: new Map(),
  keys: new Map(),
  slots: new Map(),
  edges: new Map(),
  width: 0,
  height: 0,
};

// Internal measurement result — subtree bounding box + this node's own box.
// Same shape as the old shapes.ts `Laid`.
type Measured = {
  id: AnimationID;
  width: number;
  height: number;
  nodeW: number;
  nodeH: number;
  hasChildren: boolean;
  children: Measured[];
};

export function layout_frame(data: TreeData | Snapshot): Frame {
  if (data.root == null) return EMPTY_FRAME;

  // Phase 1: measure every subtree's bounding box.
  const measure = (id: AnimationID): Measured => {
    const n = data.nodes[id];
    const hasChildren = n.children.length > 0;
    const cols = Math.max(
      n.data_keys.length,
      hasChildren ? n.children.length : 0,
      1,
    );
    const nodeW = cols * CELL_W;
    const nodeH = hasChildren ? 2 * CELL_H : CELL_H;

    const children = n.children.map((cid) => measure(cid));
    const childrenW =
      children.reduce((a, c) => a + c.width, 0) +
      Math.max(0, children.length - 1) * H_GAP;
    const childrenH = children.length
      ? V_GAP + Math.max(...children.map((c) => c.height))
      : 0;

    return {
      id,
      width: Math.max(nodeW, childrenW),
      height: nodeH + childrenH,
      nodeW,
      nodeH,
      hasChildren,
      children,
    };
  };

  const nodes = new Map<AnimationID, NodeBox>();
  const keys = new Map<AnimationID, KeyBox>();
  const slots = new Map<string, SlotBox>();
  const edges = new Map<string, EdgeLine>();

  // Phase 2: place each node + its keys + its edges at absolute positions.
  const place = (m: Measured, x: number, y: number): void => {
    const n = data.nodes[m.id];
    const nodeX = x + (m.width - m.nodeW) / 2;

    nodes.set(m.id, {
      id: m.id,
      x: nodeX,
      y,
      w: m.nodeW,
      h: m.nodeH,
      leaf: !m.hasChildren,
    });

    // key cells share the node's top row evenly
    const topCols = Math.max(n.data_keys.length, 1);
    const topCellW = m.nodeW / topCols;
    for (let i = 0; i < n.data_keys.length; i++) {
      const k = n.data_keys[i];
      keys.set(k.id, {
        id: k.id,
        node: m.id,
        value: k.value,
        x: nodeX + i * topCellW,
        y,
        w: topCellW,
        h: CELL_H,
      });
    }

    if (!m.hasChildren) return;

    // Bottom row: one slot cell per child pointer. Width = CELL_W each so
    // the slot layout matches the parent→child line geometry below.
    for (let i = 0; i < n.children.length; i++) {
      const slotId = `${m.id}:${i}`;
      slots.set(slotId, {
        id: slotId,
        node: m.id,
        slot: i,
        x: nodeX + i * CELL_W,
        y: y + CELL_H,
        w: CELL_W,
        h: CELL_H,
      });
    }

    const childrenW =
      m.children.reduce((a, c) => a + c.width, 0) +
      Math.max(0, m.children.length - 1) * H_GAP;
    let cx = x + (m.width - childrenW) / 2;
    const childY = y + m.nodeH + V_GAP;

    m.children.forEach((cm, i) => {
      const slotX = nodeX + (i + 0.5) * CELL_W;
      const slotY = y + CELL_H + CELL_H; // bottom of parent's child-slot row
      const childTopX = cx + cm.width / 2;
      const edgeId = `${m.id}->${cm.id}`;
      edges.set(edgeId, {
        id: edgeId,
        from: m.id,
        to: cm.id,
        x1: slotX,
        y1: slotY,
        x2: childTopX,
        y2: childY,
      });
      place(cm, cx, childY);
      cx += cm.width + H_GAP;
    });
  };

  const root = measure(data.root);
  place(root, 0, 0);

  return { nodes, keys, slots, edges, width: root.width, height: root.height };
}

export function highlight_at(op: Operation, index: number): Highlight {
  const step = step_at(op, index);
  return highlight_from(step?.event);
}

type State = "idle" | "active";
const node_state = (h: Highlight, id: AnimationID): State =>
  h.nodes.has(id) ? "active" : "idle";
const key_state = (h: Highlight, id: AnimationID): State =>
  h.keys.has(id) ? "active" : "idle";
const edge_state = (h: Highlight, id: string): State =>
  h.edges.has(id) ? "active" : "idle";

export type OperationPlayerProps = {
  op?: Operation;
  index?: number;
  onLayout?: (dims: { width: number; height: number }) => void;
  /**
   * Fires whenever the current step's highlight region moves. Coordinates
   * are in the player's own SVG space (padding included) so the parent can
   * drive a "follow" pan/zoom without extra math. `undefined` means the
   * current frame has no highlight — the parent should leave the camera
   * where it is or fall back to a full fit.
   */
  onAnimationCenter?: (
    center: { x: number; y: number } | undefined,
  ) => void;
  /** Milliseconds between steps; drives the --step CSS variable. */
  stepMs?: number;
  class?: string;
  style?: JSX.CSSProperties;
};

// Bounding box of everything the current highlight points at, in frame
// (pre-padding) coords. Returns null if the highlight is empty.
function highlight_bounds(
  frame: Frame,
  h: Highlight,
): { x: number; y: number; w: number; h: number } | null {
  let min_x = Infinity;
  let min_y = Infinity;
  let max_x = -Infinity;
  let max_y = -Infinity;
  let seen = false;

  const consume = (x: number, y: number, w: number, h: number) => {
    seen = true;
    if (x < min_x) min_x = x;
    if (y < min_y) min_y = y;
    if (x + w > max_x) max_x = x + w;
    if (y + h > max_y) max_y = y + h;
  };

  for (const id of h.nodes) {
    const b = frame.nodes.get(id);
    if (b) consume(b.x, b.y, b.w, b.h);
  }
  for (const id of h.keys) {
    const b = frame.keys.get(id);
    if (b) consume(b.x, b.y, b.w, b.h);
  }
  for (const id of h.edges) {
    const e = frame.edges.get(id);
    if (e) {
      const ex = Math.min(e.x1, e.x2);
      const ey = Math.min(e.y1, e.y2);
      consume(ex, ey, Math.abs(e.x2 - e.x1), Math.abs(e.y2 - e.y1));
    }
  }

  if (!seen) return null;
  return { x: min_x, y: min_y, w: max_x - min_x, h: max_y - min_y };
}

export function OperationPlayer(props: OperationPlayerProps): JSX.Element {
  // Which tree state + highlight are we showing?
  const source = createMemo<{
    data?: TreeData | Snapshot;
    highlight: Highlight;
  }>(() => {
    const op = props.op;
    if (!op) return { data: undefined, highlight: empty_highlight() };

    const i = props.index;
    const step = i !== undefined ? step_at(op, i) : undefined;
    if (!step) return { data: op.final, highlight: empty_highlight() };

    return { data: step.snapshot, highlight: highlight_at(op, i!) };
  });

  const frame = createMemo<Frame>(() => {
    const data = source().data;
    return data ? layout_frame(data) : EMPTY_FRAME;
  });

  const hl = () => source().highlight;

  // Iterate over primitive IDs so <For> keeps each element alive across frames.
  const nodeIds = createMemo(() => [...frame().nodes.keys()]);
  const keyIds = createMemo(() => [...frame().keys.keys()]);
  const slotIds = createMemo(() => [...frame().slots.keys()]);
  const edgeIds = createMemo(() => [...frame().edges.keys()]);

  createEffect(() => {
    const f = frame();
    props.onLayout?.({ width: f.width, height: f.height });
  });

  // Emit the "focus point" of the current frame — centroid of the highlight
  // in the SVG's coordinate space (padding included).
  createEffect(() => {
    const f = frame();
    const bounds = highlight_bounds(f, source().highlight);
    if (!bounds) {
      props.onAnimationCenter?.(undefined);
      return;
    }
    props.onAnimationCenter?.({
      x: bounds.x + bounds.w / 2 + CANVAS_PADDING,
      y: bounds.y + bounds.h / 2 + CANVAS_PADDING,
    });
  });

  const totalW = () => frame().width + CANVAS_PADDING * 2;
  const totalH = () => frame().height + CANVAS_PADDING * 2;

  return (
    <svg
      class={props.class}
      style={{ "--step": `${props.stepMs ?? 400}ms`, ...props.style }}
      xmlns="http://www.w3.org/2000/svg"
      width={totalW()}
      height={totalH()}
    >
      <g transform={`translate(${CANVAS_PADDING}, ${CANVAS_PADDING})`}>
        {/* Edges first so nodes draw on top. */}
        <For each={edgeIds()}>
          {(id) => (
            <Show when={frame().edges.get(id)}>
              {(edge) => (
                <EdgeView edge={edge()} state={edge_state(hl(), id)} />
              )}
            </Show>
          )}
        </For>

        <For each={nodeIds()}>
          {(id) => (
            <Show when={frame().nodes.get(id)}>
              {(box) => <NodeView box={box()} state={node_state(hl(), id)} />}
            </Show>
          )}
        </For>

        {/* Child-pointer slots sit on top of the node fill so the midlines
            between them are visible. */}
        <For each={slotIds()}>
          {(id) => (
            <Show when={frame().slots.get(id)}>
              {(slot) => <SlotView slot={slot()} />}
            </Show>
          )}
        </For>

        <For each={keyIds()}>
          {(id) => (
            <Show when={frame().keys.get(id)}>
              {(key) => <KeyView keyBox={key()} state={key_state(hl(), id)} />}
            </Show>
          )}
        </For>
      </g>
    </svg>
  );
}

const COLOR = {
  node_fill: "#2c2c2c",
  node_stroke: "#4a4a4a",
  text_idle: "#e8e8e8",
  edge_idle: "#888",
  active_fill: "#4a3a1f",
  active_stroke: "#f0b060",
  active_text: "#ffd890",
};

// Position transition shared by every <g> that moves between frames.
// Each view is keyed by its AnimationID in the parent <For>, so Solid
// reuses the same DOM node across steps — the browser interpolates the
// transform between the old and new values.
const MOVE_TRANSITION = "transform var(--step, 400ms) ease";

// Rect geometry + stroke/fill transition. SVG 2 exposes width/height as CSS
// properties; setting them via inline style (not just the attribute) is what
// opts us into CSS transitions on Chrome / recent Firefox.
const RECT_TRANSITION =
  "width var(--step, 400ms) ease, height var(--step, 400ms) ease, " +
  "fill var(--step, 400ms) ease, stroke var(--step, 400ms) ease, " +
  "stroke-width var(--step, 400ms) ease";

// Child-pointer slot — one per child under an internal node. Carries the
// same fill/stroke pair as the key cell so the midlines read as a single
// row of boxes rather than a bare divider.
function SlotView(props: { slot: SlotBox }) {
  return (
    <g
      class="slot"
      style={{
        transform: `translate(${props.slot.x}px, ${props.slot.y}px)`,
        transition: MOVE_TRANSITION,
      }}
    >
      <rect
        width={props.slot.w}
        height={props.slot.h}
        fill={COLOR.node_fill}
        stroke={COLOR.node_stroke}
        stroke-width={1}
        style={{
          width: `${props.slot.w}px`,
          height: `${props.slot.h}px`,
          transition: RECT_TRANSITION,
        }}
      />
    </g>
  );
}

function NodeView(props: { box: NodeBox; state: State }) {
  const active = () => props.state === "active";
  return (
    <g
      class="node"
      data-state={props.state}
      style={{
        transform: `translate(${props.box.x}px, ${props.box.y}px)`,
        transition: MOVE_TRANSITION,
      }}
    >
      <rect
        width={props.box.w}
        height={props.box.h}
        fill={active() ? COLOR.active_fill : COLOR.node_fill}
        stroke={active() ? COLOR.active_stroke : COLOR.node_stroke}
        stroke-width={active() ? 1.5 : 1}
        style={{
          width: `${props.box.w}px`,
          height: `${props.box.h}px`,
          transition: RECT_TRANSITION,
        }}
      />
    </g>
  );
}

function KeyView(props: { keyBox: KeyBox; state: State }) {
  const active = () => props.state === "active";
  return (
    <g
      class="key"
      data-state={props.state}
      style={{
        transform: `translate(${props.keyBox.x}px, ${props.keyBox.y}px)`,
        transition: MOVE_TRANSITION,
      }}
    >
      <rect
        width={props.keyBox.w}
        height={props.keyBox.h}
        fill={active() ? COLOR.active_fill : COLOR.node_fill}
        stroke={active() ? COLOR.active_stroke : COLOR.node_stroke}
        stroke-width={active() ? 1.5 : 1}
        style={{
          width: `${props.keyBox.w}px`,
          height: `${props.keyBox.h}px`,
          transition: RECT_TRANSITION,
        }}
      />
      <text
        x={props.keyBox.w / 2}
        y={props.keyBox.h / 2}
        fill={active() ? COLOR.active_text : COLOR.text_idle}
        font-size="14"
        font-family="Helvetica, Helvetica Neue, Arial, sans-serif"
        text-anchor="middle"
        dominant-baseline="central"
      >
        {props.keyBox.value}
      </text>
    </g>
  );
}

function EdgeView(props: { edge: EdgeLine; state: State }) {
  const active = () => props.state === "active";
  const path = () =>
    `M ${props.edge.x1} ${props.edge.y1} L ${props.edge.x2} ${props.edge.y2}`;
  return (
    <path
      class="edge"
      data-state={props.state}
      // `d` attribute is the fallback for browsers that don't support the
      // CSS `d` property; the style below sets the same path as a CSS value
      // so Chrome / recent Firefox can transition between frames.
      d={path()}
      style={{
        d: `path("${path()}")`,
        transition: `d var(--step, 400ms) ease, stroke var(--step, 400ms) ease, stroke-width var(--step, 400ms) ease`,
      }}
      fill="none"
      stroke={active() ? COLOR.active_stroke : COLOR.edge_idle}
      stroke-width={active() ? 2.25 : 1.5}
    />
  );
}
