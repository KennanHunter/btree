import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
  untrack,
} from "solid-js";
import type { JSX } from "solid-js";
import type { AnimationID } from "@kennanhunter/btree/core";
import type { Operation } from "./operation";
import { step_at, step_count } from "./operation";
import { empty_highlight, highlight_from, type Highlight } from "./highlight";
import { create_player, lerp_pose } from "./player";
import { choreograph, resolve_probe_at, type Ctx } from "./choreograph";
import type { Pose, ProbeBox } from "./pose";

// NOTE: this view requires an `op`. The caller is expected to seed an initial
// Operation (e.g. a `bulk_insert` of the starting values) so there is always
// something to display — see `tree-context` for how that's wired.

// Layout constants. Shared with scene.ts; keeping them in view.tsx so the
// view and the renderer agree without a circular dep.
export const CELL_W = 48;
export const CELL_H = 32;
export const H_GAP = 24;
export const V_GAP = 56;
export const CANVAS_PADDING = 8;

// Box types used in a Pose. Produced by `layout_scene` (see scene.ts) and
// read by the player's lerp + the renderer below.
export type NodeBox = {
  id: AnimationID;
  x: number;
  y: number;
  w: number;
  h: number;
  leaf: boolean;
  // Per-pose opt-in: if true, the player lerps this node's width between
  // keyframes instead of snapping. Used by insert_widen so the leaf
  // visibly widens as the probe slides into its reserved slot.
  ease_width?: boolean;
  // If true, the renderer skips drawing this node's rect (border + fill)
  // but still renders the keys and slots nested inside its <g>. Used
  // when the "parent" is really just a single key — e.g. a brand-new
  // root created by grow_root that only holds the median — so the key
  // doesn't look like it's sitting inside an awkward empty frame.
  no_frame?: boolean;
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
// id = `${from}->${to}`, matching Highlight.edges and the hidden-edge set.
export type EdgeLine = {
  id: string;
  from: AnimationID;
  to: AnimationID;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};
// A single child-pointer slot in an internal node's bottom row.
// id = `${node}:${slot}` for stable identification across frames.
export type SlotBox = {
  id: string;
  node: AnimationID;
  slot: number;
  x: number;
  y: number;
  w: number;
  h: number;
};

export function highlight_at(op: Operation, index: number): Highlight {
  const step = step_at(op, index);
  return highlight_from(step?.event);
}

type State = "idle" | "active" | "alarm";
const node_state = (h: Highlight, id: AnimationID): State =>
  h.alarm_nodes.has(id) ? "alarm" : h.nodes.has(id) ? "active" : "idle";
const key_state = (h: Highlight, id: AnimationID): State =>
  h.keys.has(id) ? "active" : "idle";
const edge_state = (h: Highlight, id: string): State =>
  h.edges.has(id) ? "active" : "idle";

export type OperationPlayerHandle = {
  /** Jump the pose to `step` at tween progress `t ∈ [0, 1]`. Cancels any
   *  in-flight rAF; deterministic (does not advance over wall-clock time). */
  renderAt: (step: number, t: number) => void;
  /** Current pose bounds, padding included (same units as the SVG). */
  getBounds: () => { width: number; height: number };
  /** Number of steps in the current op (0 if no op). */
  stepCount: () => number;
};

export type OperationPlayerProps = {
  op?: Operation;
  index?: number;
  /** Fires once after mount with an imperative handle for frame-indexed
   *  playback (used by the video recorder). */
  onReady?: (handle: OperationPlayerHandle) => void;
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

// Bounding box of every element in `pose` that `h` points at, in the
// pose's own pre-padding coord space. Returns null if nothing in the
// highlight is laid out in this pose (e.g. a hidden edge).
function highlight_bounds(
  pose: Pick<Pose, "nodes" | "keys" | "edges">,
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
    const b = pose.nodes.get(id);
    if (b) consume(b.x, b.y, b.w, b.h);
  }
  for (const id of h.keys) {
    const b = pose.keys.get(id);
    if (b) consume(b.x, b.y, b.w, b.h);
  }
  for (const id of h.edges) {
    const e = pose.edges.get(id);
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
  // When the imperative handle drives playback (renderAt), it writes the
  // current step here so highlights (and hence CSS alarm-shake) track along
  // even though `props.index` isn't moving.
  const [imperative_step, setImperativeStep] = createSignal<number | undefined>(
    undefined,
  );
  const active_index = (): number | undefined =>
    props.index !== undefined ? props.index : imperative_step();

  // Probe value depends on the current step (bulk inserts emit many
  // visit_insert events, one per inserted key).
  const probe_meta = createMemo(() => {
    const op = props.op;
    const i = active_index();
    if (!op || i === undefined) return undefined;
    return resolve_probe_at(op, i);
  });

  const dest_highlight = createMemo<Highlight>(() => {
    const op = props.op;
    const i = active_index();
    if (!op || i === undefined) return empty_highlight();
    return highlight_at(op, i);
  });

  // Player — JS-driven tween between poses.
  const player = create_player(() => props.stepMs ?? 400);
  onCleanup(() => player.dispose());

  let prev_index: number | undefined = undefined;
  createEffect(() => {
    const op = props.op;
    const i = props.index;
    const probe = probe_meta();
    // The player reads `shown()` inside its tween setup; that read happens
    // during this effect, so without `untrack` every rAF update to `shown`
    // would re-fire the effect with prev_index === i (non-contiguous) and
    // snap the tween to its destination mid-flight.
    untrack(() => {
      if (!op || i === undefined) {
        player.update(undefined, prev_index);
      } else {
        const ctx: Ctx = {
          op,
          index: i,
          probe_id: probe?.id,
          probe_value: probe?.value,
        };
        player.update(ctx, prev_index);
      }
      prev_index = i;
    });
  });

  const shown = player.shown;

  // Deterministic frame-indexed playback. Mirrors `tween_through`'s phase
  // chaining but driven by (step, t) instead of wall-clock elapsed time.
  // The empty "from" for step 0 is intentional — the player snaps to kfs[last]
  // on first-step jumps, so this is what deterministic playback should look
  // like for step 0 (lerp from nothing).
  const EMPTY_POSE_FROM: Pose = {
    nodes: new Map(),
    keys: new Map(),
    slots: new Map(),
    edges: new Map(),
    width: 0,
    height: 0,
    min_x: 0,
    hidden: new Set(),
  };
  const renderAt = (step: number, t: number): void => {
    const op = props.op;
    if (!op) return;
    const total_steps = step_count(op);
    if (total_steps === 0) return;
    const s = Math.max(0, Math.min(total_steps - 1, Math.floor(step)));
    setImperativeStep(s);
    const probe = resolve_probe_at(op, s);
    const ctx: Ctx = {
      op,
      index: s,
      probe_id: probe?.id,
      probe_value: probe?.value,
    };
    const kfs = choreograph(ctx);
    if (kfs.length === 0) return;

    let from: Pose;
    if (s === 0) {
      from = EMPTY_POSE_FROM;
    } else {
      const prev_probe = resolve_probe_at(op, s - 1);
      const prev_ctx: Ctx = {
        op,
        index: s - 1,
        probe_id: prev_probe?.id,
        probe_value: prev_probe?.value,
      };
      const prev_kfs = choreograph(prev_ctx);
      from = prev_kfs.length
        ? prev_kfs[prev_kfs.length - 1].pose
        : EMPTY_POSE_FROM;
    }

    const total_weight = kfs.reduce((a, k) => a + k.weight, 0);
    const clamped_t = Math.max(0, Math.min(1, t));
    if (total_weight === 0) {
      player.snap(kfs[kfs.length - 1].pose);
      return;
    }
    const target = clamped_t * total_weight;
    let acc = 0;
    for (let i = 0; i < kfs.length; i++) {
      const w = kfs[i].weight;
      const is_last = i === kfs.length - 1;
      if (target <= acc + w || is_last) {
        const phase_from = i === 0 ? from : kfs[i - 1].pose;
        const phase_to = kfs[i].pose;
        const local = w === 0 ? 1 : Math.min(1, Math.max(0, (target - acc) / w));
        player.snap(lerp_pose(phase_from, phase_to, kfs[i].ease(local)));
        return;
      }
      acc += w;
    }
  };

  onMount(() => {
    props.onReady?.({
      renderAt,
      getBounds: () => ({
        width: shown().width + CANVAS_PADDING * 2,
        height: shown().height + CANVAS_PADDING * 2,
      }),
      stepCount: () => (props.op ? step_count(props.op) : 0),
    });
  });

  const nodeIds = createMemo(() => [...shown().nodes.keys()]);
  const edgeIds = createMemo(() => [...shown().edges.keys()]);

  // Group keys and slots by their parent node so each node's <g> can
  // nest them. Keys/slots whose parent isn't in the current pose
  // (floating keys during grow_root split's early phases, or anything
  // orphaned by hidden parents) fall through to the top-level buckets.
  // Nesting means a single transform on the node drives every box inside
  // it — no cross-compositor-layer timing drift between a node and its
  // keys.
  const childrenByNode = createMemo(() => {
    const p = shown();
    const keys = new Map<AnimationID, KeyBox[]>();
    const slots = new Map<AnimationID, SlotBox[]>();
    const orphan_keys: KeyBox[] = [];
    const orphan_slots: SlotBox[] = [];
    for (const key of p.keys.values()) {
      if (p.nodes.has(key.node)) {
        const arr = keys.get(key.node) ?? [];
        arr.push(key);
        keys.set(key.node, arr);
      } else {
        orphan_keys.push(key);
      }
    }
    for (const slot of p.slots.values()) {
      if (p.nodes.has(slot.node)) {
        const arr = slots.get(slot.node) ?? [];
        arr.push(slot);
        slots.set(slot.node, arr);
      } else {
        orphan_slots.push(slot);
      }
    }
    return { keys, slots, orphan_keys, orphan_slots };
  });

  // SVG bounds follow the current (interpolated) pose so the container
  // grows/shrinks in step with the tween.
  createEffect(() => {
    const p = shown();
    props.onLayout?.({ width: p.width, height: p.height });
  });

  // Follow the probe if present, else the highlight's anchor key (for
  // splits — keeps the median pinned), else the highlight centroid in the
  // destination pose.
  //
  // Pose coords are anchored on root.center_x = 0, so a point at pose x
  // renders at SVG x = CANVAS_PADDING - pose.min_x + pose.x. The
  // `-pose.min_x` term shifts negative content into the SVG viewport;
  // animCenter has to add it too so the camera lands on the same pixel.
  const svg_x = (pose_x: number) =>
    pose_x + CANVAS_PADDING - shown().min_x;
  const svg_y = (pose_y: number) => pose_y + CANVAS_PADDING;

  createEffect(() => {
    const probe = shown().probe;
    if (probe) {
      props.onAnimationCenter?.({
        x: svg_x(probe.x + probe.w / 2),
        y: svg_y(probe.y + probe.h / 2),
      });
      return;
    }
    const hl = dest_highlight();
    if (hl.anchor_key !== undefined) {
      const k = shown().keys.get(hl.anchor_key);
      if (k) {
        props.onAnimationCenter?.({
          x: svg_x(k.x + k.w / 2),
          y: svg_y(k.y + k.h / 2),
        });
        return;
      }
    }
    const bounds = highlight_bounds(shown(), hl);
    if (!bounds) {
      props.onAnimationCenter?.(undefined);
      return;
    }
    props.onAnimationCenter?.({
      x: svg_x(bounds.x + bounds.w / 2),
      y: svg_y(bounds.y + bounds.h / 2),
    });
  });

  const totalW = () => shown().width + CANVAS_PADDING * 2;
  const totalH = () => shown().height + CANVAS_PADDING * 2;

  const hl = dest_highlight;
  const hidden = () => shown().hidden;
  const not_hidden = (id: AnimationID | string) => !hidden().has(String(id));

  return (
    <svg
      class={props.class}
      style={props.style}
      xmlns="http://www.w3.org/2000/svg"
      width={totalW()}
      height={totalH()}
    >
      <style>{SVG_STYLE}</style>
      <g
        transform={`translate(${CANVAS_PADDING - shown().min_x}, ${CANVAS_PADDING})`}
      >
        <For each={edgeIds()}>
          {(id) => (
            <Show when={not_hidden(id) && shown().edges.get(id)}>
              {(edge) => (
                <EdgeView edge={edge()} state={edge_state(hl(), id)} />
              )}
            </Show>
          )}
        </For>

        <For each={nodeIds()}>
          {(id) => (
            <Show when={not_hidden(id) && shown().nodes.get(id)}>
              {(box) => (
                <NodeView
                  box={box()}
                  state={node_state(hl(), id)}
                  slots={childrenByNode().slots.get(id) ?? []}
                  keys={childrenByNode().keys.get(id) ?? []}
                  hidden={hidden()}
                  highlight={hl()}
                />
              )}
            </Show>
          )}
        </For>

        {/* Orphan slots / keys — their parent isn't in the current pose
            (e.g. the floating median before the fresh root appears).
            Rendered at top level with absolute positions. */}
        <For each={childrenByNode().orphan_slots}>
          {(slot) => (
            <Show when={not_hidden(slot.id)}>
              <SlotView
                slot={slot}
                origin={{ x: 0, y: 0 }}
                alarm={hl().alarm_nodes.has(slot.node)}
                active={hl().slots.has(slot.id)}
              />
            </Show>
          )}
        </For>

        <For each={childrenByNode().orphan_keys}>
          {(key) => (
            <Show when={not_hidden(String(key.id))}>
              <KeyView
                keyBox={key}
                state={key_state(hl(), key.id)}
                origin={{ x: 0, y: 0 }}
                alarm={hl().alarm_nodes.has(key.node)}
              />
            </Show>
          )}
        </For>

        <Show when={shown().probe}>
          {(probe) => <ProbeView probe={probe()} />}
        </Show>
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
  alarm_fill: "#4a1f1f",
  alarm_stroke: "#f06060",
};

// Scoped CSS. Lives inside the SVG so the component has no external CSS
// dependency.
//
// `will-change: transform` promotes each animated group to its own
// compositor layer so the per-frame `translate` updates can be done on
// the GPU — without this hint the browser repaints the SVG on the CPU
// and under load can skip a frame, briefly showing the previous
// position. The hint is cheap for the number of elements we have (tens).
//
// The overfill shake uses the `translate:` longhand (not `transform:`),
// so it composes with per-frame positions set via the `transform` style
// without the two writing to the same property.
const SVG_STYLE = `
  /* Only the node groups and the probe get promoted to their own
     compositor layer. Keys and slots are now DOM children of their
     parent node's <g>, so they ride that layer naturally — giving them
     their own \`will-change\` would split them off into separate layers
     again and reintroduce the per-layer timing drift that was making
     them trail behind the node under load. */
  g.node, g.probe {
    will-change: transform;
  }
  path.edge {
    will-change: d;
  }
  g.node[data-state="alarm"],
  g.key[data-alarm="true"],
  g.slot[data-alarm="true"] {
    transform-box: fill-box;
    transform-origin: center;
    animation: btree-overfill-shake 320ms ease-in-out infinite;
  }
  @keyframes btree-overfill-shake {
    0%, 100% { translate: 0 0; }
    25%      { translate: -2px 0; }
    75%      { translate: 2px 0; }
  }
`;

// `origin` is the parent group's absolute position. When this view is
// rendered inside a node's <g>, we pass the node's (x, y) so the slot
// positions relative to it — SVG inheritance then carries the slot along
// with the parent's transform, and a single compositor layer updates
// both at once. When rendered at top level (orphan), origin is (0, 0)
// so the slot stays positioned in absolute coords.
function SlotView(props: {
  slot: SlotBox;
  origin: { x: number; y: number };
  alarm?: boolean;
  active?: boolean;
}) {
  const rx = () => props.slot.x - props.origin.x;
  const ry = () => props.slot.y - props.origin.y;
  return (
    <g
      class="slot"
      data-alarm={props.alarm ? "true" : undefined}
      style={{ transform: `translate(${rx()}px, ${ry()}px)` }}
    >
      <rect
        width={props.slot.w}
        height={props.slot.h}
        fill={props.active ? COLOR.active_fill : COLOR.node_fill}
        stroke={props.active ? COLOR.active_stroke : COLOR.node_stroke}
        stroke-width={props.active ? 1.5 : 1}
      />
    </g>
  );
}

// Three visual tiers: idle (default), active (highlighted amber), alarm
// (red + shake, driven by the CSS keyframes above).
//
// The node's <g> is also the SVG parent for the slots and keys that
// belong to this node — they're rendered inside with coordinates
// relative to the node's origin. Means one `transform` update on this
// group moves the rect AND every box inside it as one compositor layer.
function NodeView(props: {
  box: NodeBox;
  state: State;
  slots: SlotBox[];
  keys: KeyBox[];
  hidden: Set<string>;
  highlight: Highlight;
}) {
  const fill = () =>
    props.state === "alarm"
      ? COLOR.alarm_fill
      : props.state === "active"
        ? COLOR.active_fill
        : COLOR.node_fill;
  const stroke = () =>
    props.state === "alarm"
      ? COLOR.alarm_stroke
      : props.state === "active"
        ? COLOR.active_stroke
        : COLOR.node_stroke;
  // Alarm gets a visibly chunkier border to read as "warning" at a glance;
  // active is a lighter emphasis.
  const strokeW = () =>
    props.state === "alarm" ? 3 : props.state === "active" ? 1.5 : 1;
  const origin = () => ({ x: props.box.x, y: props.box.y });
  const alarmed = () => props.state === "alarm";
  return (
    <g
      class="node"
      data-state={props.state}
      style={{ transform: `translate(${props.box.x}px, ${props.box.y}px)` }}
    >
      <Show when={!props.box.no_frame}>
        <rect
          width={props.box.w}
          height={props.box.h}
          fill={fill()}
          stroke={stroke()}
          stroke-width={strokeW()}
        />
      </Show>
      <For each={props.slots}>
        {(slot) => (
          <Show when={!props.hidden.has(slot.id)}>
            <SlotView
              slot={slot}
              origin={origin()}
              alarm={alarmed()}
              active={props.highlight.slots.has(slot.id)}
            />
          </Show>
        )}
      </For>
      <For each={props.keys}>
        {(key) => (
          <Show when={!props.hidden.has(String(key.id))}>
            <KeyView
              keyBox={key}
              state={key_state(props.highlight, key.id)}
              origin={origin()}
              alarm={alarmed()}
            />
          </Show>
        )}
      </For>
    </g>
  );
}

function KeyView(props: {
  keyBox: KeyBox;
  state: State;
  origin: { x: number; y: number };
  alarm?: boolean;
}) {
  const active = () => props.state === "active";
  const rx = () => props.keyBox.x - props.origin.x;
  const ry = () => props.keyBox.y - props.origin.y;
  return (
    <g
      class="key"
      data-state={props.state}
      data-alarm={props.alarm ? "true" : undefined}
      style={{ transform: `translate(${rx()}px, ${ry()}px)` }}
    >
      <rect
        width={props.keyBox.w}
        height={props.keyBox.h}
        fill={active() ? COLOR.active_fill : COLOR.node_fill}
        stroke={active() ? COLOR.active_stroke : COLOR.node_stroke}
        stroke-width={active() ? 1.5 : 1}
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
      d={path()}
      fill="none"
      stroke={active() ? COLOR.active_stroke : COLOR.edge_idle}
      stroke-width={active() ? 2.25 : 1.5}
    />
  );
}

function ProbeView(props: { probe: ProbeBox }) {
  return (
    <g
      class="probe"
      data-role="probe"
      style={{
        transform: `translate(${props.probe.x}px, ${props.probe.y}px)`,
      }}
    >
      <rect
        width={props.probe.w}
        height={props.probe.h}
        fill={COLOR.active_fill}
        stroke={COLOR.active_stroke}
        stroke-width={1.5}
        rx={4}
      />
      <text
        x={props.probe.w / 2}
        y={props.probe.h / 2}
        fill={COLOR.active_text}
        font-size="14"
        font-family="Helvetica, Helvetica Neue, Arial, sans-serif"
        text-anchor="middle"
        dominant-baseline="central"
      >
        {props.probe.value}
      </text>
    </g>
  );
}
