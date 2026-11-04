import { createSignal, type Accessor } from "solid-js";
import type { AnimationID } from "../../core/src";
import type { EdgeLine, KeyBox, NodeBox, SlotBox } from "./view";
import type { Keyframe, Pose, ProbeBox } from "./pose";
import { choreograph, entry_pose, type Ctx } from "./choreograph";
import type { Operation } from "./operation";

const EMPTY_POSE: Pose = {
  nodes: new Map(),
  keys: new Map(),
  slots: new Map(),
  edges: new Map(),
  width: 0,
  height: 0,
  min_x: 0,
  hidden: new Set(),
};

export type Driver = {
  shown: Accessor<Pose>;
  update: (ctx: Ctx | undefined, prev_index: number | undefined) => void;
  /** Jump to `pose` without animation. Cancels any in-flight tween. */
  snap: (pose: Pose) => void;
  dispose: () => void;
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function lerp_node(a: NodeBox, b: NodeBox, t: number): NodeBox {
  // Node widths snap by default — integer-cell widths with keys sitting
  // at fixed CELL_W boxes look wrong half-way through a tween (the keys
  // poke out of the half-grown rect). Opt in per-pose via
  // `b.ease_width`: insert_widen uses it so the leaf visibly grows as
  // the probe slides into its reserved slot (every persisting key's x
  // also lerps proportionally, so nothing clips).
  // Position and height always lerp — the node glides between slots and
  // the slot row extends smoothly. `no_frame` is a visibility flag;
  // destination value wins (take-the-latest) so a frame hide/show
  // applies from the start of the tween, same as `hidden`.
  return {
    id: b.id,
    leaf: b.leaf,
    ease_width: b.ease_width,
    no_frame: b.no_frame,
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    w: b.ease_width ? lerp(a.w, b.w, t) : b.w,
    h: lerp(a.h, b.h, t),
  };
}
function lerp_key(a: KeyBox, b: KeyBox, t: number): KeyBox {
  return {
    id: b.id,
    node: b.node,
    value: b.value,
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    w: lerp(a.w, b.w, t),
    h: lerp(a.h, b.h, t),
  };
}
function lerp_slot(a: SlotBox, b: SlotBox, t: number): SlotBox {
  return {
    id: b.id,
    node: b.node,
    slot: b.slot,
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    w: lerp(a.w, b.w, t),
    h: lerp(a.h, b.h, t),
  };
}
function lerp_edge(a: EdgeLine, b: EdgeLine, t: number): EdgeLine {
  return {
    id: b.id,
    from: b.from,
    to: b.to,
    x1: lerp(a.x1, b.x1, t),
    y1: lerp(a.y1, b.y1, t),
    x2: lerp(a.x2, b.x2, t),
    y2: lerp(a.y2, b.y2, t),
  };
}
function lerp_probe(
  a: ProbeBox | undefined,
  b: ProbeBox | undefined,
  t: number,
): ProbeBox | undefined {
  // If the destination pose has no probe, drop it immediately. Previously
  // we returned `a` here, which kept showing the "from" probe for the
  // whole tween and then popped it away at t=1 — so between operations
  // (or into any step whose scene drops the probe) the old value would
  // linger for a full step-ms. Mirror the "snap on id change" rule.
  if (!b) return undefined;
  if (!a) return b;
  // Different id means a different inserted value (e.g. the next insert
  // in a bulk operation) — snap, don't tween between unrelated keys.
  if (a.id !== b.id) return b;
  return {
    id: b.id,
    value: b.value,
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    w: lerp(a.w, b.w, t),
    h: lerp(a.h, b.h, t),
  };
}

export function lerp_pose(from: Pose, to: Pose, t: number): Pose {
  const nodes = new Map<AnimationID, NodeBox>();
  for (const [id, box] of to.nodes) {
    const prev = from.nodes.get(id);
    nodes.set(id, prev ? lerp_node(prev, box, t) : box);
  }
  const keys = new Map<AnimationID, KeyBox>();
  for (const [id, box] of to.keys) {
    const prev = from.keys.get(id);
    keys.set(id, prev ? lerp_key(prev, box, t) : box);
  }
  const slots = new Map<string, SlotBox>();
  for (const [id, box] of to.slots) {
    const prev = from.slots.get(id);
    slots.set(id, prev ? lerp_slot(prev, box, t) : box);
  }
  const edges = new Map<string, EdgeLine>();
  for (const [id, line] of to.edges) {
    const prev = from.edges.get(id);
    edges.set(id, prev ? lerp_edge(prev, line, t) : line);
  }
  return {
    nodes,
    keys,
    slots,
    edges,
    width: lerp(from.width, to.width, t),
    height: lerp(from.height, to.height, t),
    min_x: lerp(from.min_x, to.min_x, t),
    hidden: to.hidden,
    probe: lerp_probe(from.probe, to.probe, t),
  };
}

export function create_player(stepMs: () => number): Driver {
  const [shown, setShown] = createSignal<Pose>(EMPTY_POSE);

  let raf = 0;
  let lastOp: Operation | undefined;

  const cancel = () => {
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };

  const snap = (pose: Pose) => {
    cancel();
    setShown(pose);
  };

  // Tween through a sequence of keyframes. Each keyframe's `weight` is a
  // multiple of the base step duration (so total step time = sum(weights) *
  // stepMs). The player chains the phases: `from → kfs[0].pose` using
  // kfs[0].ease, then `kfs[0].pose → kfs[1].pose` using kfs[1].ease, and so
  // on. For single-keyframe steps this reduces to the previous behaviour.
  const tween_through = (from: Pose, kfs: Keyframe[]) => {
    cancel();
    if (kfs.length === 0) return;

    const base_ms = Math.max(1, stepMs());
    // Precompute each phase's absolute time window and endpoints.
    type Phase = {
      from: Pose;
      to: Pose;
      ease: (t: number) => number;
      start: number;
      end: number;
    };
    const phases: Phase[] = [];
    let cursor = 0;
    for (let i = 0; i < kfs.length; i++) {
      const kf = kfs[i];
      const dur = base_ms * kf.weight;
      phases.push({
        from: i === 0 ? from : kfs[i - 1].pose,
        to: kf.pose,
        ease: kf.ease,
        start: cursor,
        end: cursor + dur,
      });
      cursor += dur;
    }
    const total = cursor;
    const t0 = performance.now();

    const tick = (now: number) => {
      const elapsed = now - t0;
      if (elapsed >= total) {
        setShown(phases[phases.length - 1].to);
        raf = 0;
        return;
      }
      // Find the active phase.
      let p = phases[0];
      for (const phase of phases) {
        if (elapsed < phase.end) {
          p = phase;
          break;
        }
      }
      const local = (elapsed - p.start) / (p.end - p.start);
      setShown(lerp_pose(p.from, p.to, p.ease(local)));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  };

  const update = (ctx: Ctx | undefined, prev_index: number | undefined) => {
    if (!ctx) {
      lastOp = undefined;
      snap(EMPTY_POSE);
      return;
    }

    const kfs = choreograph(ctx);
    if (kfs.length === 0) {
      snap(entry_pose(ctx));
      lastOp = ctx.op;
      return;
    }

    const sameOp = lastOp === ctx.op;
    const contiguous =
      sameOp && prev_index !== undefined && ctx.index === prev_index + 1;

    if (contiguous) {
      // Chain all phases starting from the currently-shown pose.
      tween_through(shown(), kfs);
    } else {
      // Non-contiguous jump: skip to the final pose so the user isn't shown
      // an animation of a step they didn't actually play into.
      snap(kfs[kfs.length - 1].pose);
    }

    lastOp = ctx.op;
  };

  return { shown, update, snap, dispose: cancel };
}
