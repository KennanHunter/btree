import { createEffect, createMemo, For } from "solid-js";
import type { JSX } from "solid-js";
import type { Snapshot, TreeData } from "core";
import type { Operation } from "./operation";
import { step_at } from "./operation";
import {
  build_shapes,
  CANVAS_PADDING,
  type Shape,
  type ShapeResult,
} from "./shapes";
import { empty_highlight, highlight_from, type Highlight } from "./highlight";

export type OperationPlayerProps = {
  /**
   * Operation to replay. If omitted, the player renders `fallback` (or
   * nothing) with no highlight.
   */
  op?: Operation;
  /**
   * Current step index into `op.steps`. When out of range, the player falls
   * back to `op.final` with no highlight.
   */
  index?: number;
  /**
   * Rendered when no `op` is set. Lets a caller show the live tree state
   * while idle.
   */
  fallback?: TreeData | Snapshot;
  /**
   * Reported whenever the laid-out tree's dimensions change. The parent can
   * use these to drive pan/zoom/fit.
   */
  onLayout?: (dims: { width: number; height: number }) => void;
  /** Extra class on the root `<svg>`. */
  class?: string;
  style?: JSX.CSSProperties;
};

export function OperationPlayer(props: OperationPlayerProps): JSX.Element {
  const frame = createMemo<{
    data: TreeData | Snapshot | undefined;
    highlight: Highlight;
  }>(() => {
    const op = props.op;
    if (op) {
      const step = props.index !== undefined ? step_at(op, props.index) : undefined;
      if (step) {
        return { data: step.snapshot, highlight: highlight_from(step.event) };
      }
      return { data: op.final, highlight: empty_highlight() };
    }
    return { data: props.fallback, highlight: empty_highlight() };
  });

  const shapes = createMemo<ShapeResult>(() => {
    const f = frame();
    if (!f.data) return { shapes: [], width: 0, height: 0 };
    return build_shapes(f.data as TreeData);
  });

  createEffect(() => {
    const s = shapes();
    props.onLayout?.({ width: s.width, height: s.height });
  });

  const totalW = () => shapes().width + CANVAS_PADDING * 2;
  const totalH = () => shapes().height + CANVAS_PADDING * 2;

  return (
    <svg
      class={props.class}
      style={props.style}
      xmlns="http://www.w3.org/2000/svg"
      width={totalW()}
      height={totalH()}
    >
      <For each={shapes().shapes}>{(s) => <ShapeNode shape={s} highlight={frame().highlight} />}</For>
    </svg>
  );
}

function ShapeNode(props: { shape: Shape; highlight: Highlight }) {
  const s = props.shape;
  const h = props.highlight;

  if (s.kind === "rect") {
    const highlighted =
      h.nodes.has(s.node) || (s.key !== undefined && h.keys.has(s.key));
    return (
      <rect
        x={s.x}
        y={s.y}
        width={s.w}
        height={s.h}
        fill={highlighted ? "#4a3a1f" : "#2c2c2c"}
        stroke={highlighted ? "#f0b060" : "#4a4a4a"}
        stroke-width={highlighted ? 1.5 : 1}
      />
    );
  }

  if (s.kind === "text") {
    const highlighted = h.keys.has(s.key);
    return (
      <text
        x={s.x}
        y={s.y}
        fill={highlighted ? "#ffd890" : "#e8e8e8"}
        font-size="14"
        font-family="Helvetica, Helvetica Neue, Arial, sans-serif"
        text-anchor="middle"
        dominant-baseline="central"
      >
        {s.value}
      </text>
    );
  }

  const highlighted = h.edges.has(`${s.from}->${s.to}`);
  return (
    <line
      x1={s.x1}
      y1={s.y1}
      x2={s.x2}
      y2={s.y2}
      stroke={highlighted ? "#f0b060" : "#888"}
      stroke-width={highlighted ? 2.25 : 1.5}
    />
  );
}
