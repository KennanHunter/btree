// Pose-level primitives for the split choreographer's baseline-plus-
// deltas path. Each helper mutates the pose in place (callers clone the
// baseline first); none of them re-anchor the pose.
//
// The split flow in `choreograph.ts` builds a baseline pose from the
// final (K+1) snapshot, then shifts specific subtrees / keys / edges
// into the earlier phases. Working directly on poses sidesteps the five
// coordinate frames + override pass that the old `split_phase_scene`
// relied on — deltas here are in the baseline's own pose frame, same
// units as the fields they touch.

import type { AnimationID, Snapshot } from "core";
import type { Pose } from "./pose";
import type { EdgeLine, KeyBox } from "./view";
import { subtree_ids } from "./scene";

export function clone_pose(p: Pose): Pose {
  return {
    nodes: new Map(p.nodes),
    keys: new Map(p.keys),
    slots: new Map(p.slots),
    edges: new Map(p.edges),
    width: p.width,
    height: p.height,
    min_x: p.min_x,
    hidden: new Set(p.hidden),
    probe: p.probe ? { ...p.probe } : undefined,
  };
}

// Shift every box/edge belonging to a subtree by (dx, dy). Both endpoints
// of each edge move if the edge's `from` or `to` is inside the subtree —
// so a parent→child edge whose parent is outside and child is inside
// has its lower endpoint shift while its upper stays, which is what the
// natural layout would draw for a child that just moved.
export function shift_subtree_in_pose(
  pose: Pose,
  snapshot: Snapshot,
  root: AnimationID,
  dx: number,
  dy: number,
): void {
  if (dx === 0 && dy === 0) return;
  const ids = subtree_ids(snapshot, root);
  for (const id of ids) {
    const nb = pose.nodes.get(id);
    if (nb) pose.nodes.set(id, { ...nb, x: nb.x + dx, y: nb.y + dy });
    const n = snapshot.nodes[id];
    if (!n) continue;
    for (const k of n.data_keys) {
      const kb = pose.keys.get(k.id);
      if (kb) pose.keys.set(k.id, { ...kb, x: kb.x + dx, y: kb.y + dy });
    }
    for (let i = 0; i < n.children.length; i++) {
      const slot_id = `${id}:${i}`;
      const sb = pose.slots.get(slot_id);
      if (sb) pose.slots.set(slot_id, { ...sb, x: sb.x + dx, y: sb.y + dy });
    }
  }
  for (const [eid, e] of pose.edges) {
    const to_in = ids.has(e.to);
    const from_in = ids.has(e.from);
    if (!to_in && !from_in) continue;
    const next: EdgeLine = { ...e };
    if (from_in) {
      next.x1 += dx;
      next.y1 += dy;
    }
    if (to_in) {
      next.x2 += dx;
      next.y2 += dy;
    }
    pose.edges.set(eid, next);
  }
}

// Pin a subtree's root node to a target (x, y) by shifting the whole
// subtree by the delta between the root's current and target positions.
export function pin_subtree_to(
  pose: Pose,
  snapshot: Snapshot,
  root: AnimationID,
  target_x: number,
  target_y: number,
): void {
  const nb = pose.nodes.get(root);
  if (!nb) return;
  shift_subtree_in_pose(
    pose,
    snapshot,
    root,
    target_x - nb.x,
    target_y - nb.y,
  );
}

// Shift just this node's box + its own data_keys + its own slots by
// (dx, dy). Does NOT descend into children. Edges emanating from this
// node (from === id) get their origin (x1, y1) shifted; the child-end
// (x2, y2) stays — so if the child is pinned elsewhere, the edge
// stretches between them. Used in slide_apart when we want L.node to
// move but its subtree below to stay anchored to pre-split positions.
export function shift_node_only(
  pose: Pose,
  snapshot: Snapshot,
  id: AnimationID,
  dx: number,
  dy: number,
): void {
  if (dx === 0 && dy === 0) return;
  const nb = pose.nodes.get(id);
  if (nb) pose.nodes.set(id, { ...nb, x: nb.x + dx, y: nb.y + dy });
  const n = snapshot.nodes[id];
  if (!n) return;
  for (const k of n.data_keys) {
    const kb = pose.keys.get(k.id);
    if (kb) pose.keys.set(k.id, { ...kb, x: kb.x + dx, y: kb.y + dy });
  }
  for (let i = 0; i < n.children.length; i++) {
    const slot_id = `${id}:${i}`;
    const sb = pose.slots.get(slot_id);
    if (sb) pose.slots.set(slot_id, { ...sb, x: sb.x + dx, y: sb.y + dy });
  }
  for (const [eid, e] of pose.edges) {
    if (e.from !== id) continue;
    pose.edges.set(eid, { ...e, x1: e.x1 + dx, y1: e.y1 + dy });
  }
}

// Move just the node (not its subtree) to target x and/or y.
export function move_node_only(
  pose: Pose,
  snapshot: Snapshot,
  id: AnimationID,
  target: { x?: number; y?: number },
): void {
  const nb = pose.nodes.get(id);
  if (!nb) return;
  const dx = target.x !== undefined ? target.x - nb.x : 0;
  const dy = target.y !== undefined ? target.y - nb.y : 0;
  shift_node_only(pose, snapshot, id, dx, dy);
}

// Partial variant — pin only x or only y.
export function move_subtree_to(
  pose: Pose,
  snapshot: Snapshot,
  root: AnimationID,
  target: { x?: number; y?: number },
): void {
  const nb = pose.nodes.get(root);
  if (!nb) return;
  const dx = target.x !== undefined ? target.x - nb.x : 0;
  const dy = target.y !== undefined ? target.y - nb.y : 0;
  shift_subtree_in_pose(pose, snapshot, root, dx, dy);
}

// Reposition / resize a single key in place. Callers typically use this
// for the floating median — its position isn't tied to any subtree's
// shift.
export function move_key(
  pose: Pose,
  key_id: AnimationID,
  change: { x?: number; y?: number; w?: number; h?: number },
): void {
  const kb = pose.keys.get(key_id);
  if (!kb) return;
  const next: KeyBox = {
    ...kb,
    x: change.x ?? kb.x,
    y: change.y ?? kb.y,
    w: change.w ?? kb.w,
    h: change.h ?? kb.h,
  };
  pose.keys.set(key_id, next);
}

// Hide an edge: collapse (x2, y2) onto (x1, y1) so the subsequent
// cross-step lerp animates the edge growing out of its origin instead
// of popping in at full length. Mirrors `with_hidden_edges` in scene.ts.
export function hide_edges(pose: Pose, ids: readonly string[]): void {
  for (const id of ids) {
    pose.hidden.add(id);
    const e = pose.edges.get(id);
    if (!e) continue;
    pose.edges.set(id, { ...e, x2: e.x1, y2: e.y1 });
  }
}

// Flip `no_frame` on a node so the view skips its rect/fill (keys and
// child slots still render). Used in the fresh-root split flow to hide
// the brand-new parent during the first phases.
export function hide_node_frame(pose: Pose, id: AnimationID): void {
  const nb = pose.nodes.get(id);
  if (!nb) return;
  pose.nodes.set(id, { ...nb, no_frame: true });
}

// Mark a node to render as a leaf (slot row collapsed to 0 height).
// Used for grow_root in phase 3 where the fresh parent's children-row
// shouldn't extend down until phase 4.
export function render_node_as_leaf(pose: Pose, id: AnimationID): void {
  const nb = pose.nodes.get(id);
  if (!nb) return;
  // Collapse every slot under this node to 0 height so the slot row
  // reads as a 1-row leaf. Keeps slots in the pose for the lerp into
  // phase 4 (where they grow back).
  for (const [slot_id, slot] of pose.slots) {
    if (slot.node !== id) continue;
    pose.slots.set(slot_id, { ...slot, h: 0 });
  }
}

// Opt a node into between-frame width-ease (default is snap). Lerp
// mirrors `with_eased_width` on scene.ts.
export function set_ease_width(pose: Pose, id: AnimationID): void {
  const nb = pose.nodes.get(id);
  if (!nb) return;
  pose.nodes.set(id, { ...nb, ease_width: true });
}

// Compute the subtree bbox (x-range) in the current pose. Walks every
// node in the subtree rooted at `root` and returns the leftmost x and
// total width. Useful for positioning an internal-node split where L
// and R each carry a subtree much wider than their own rect — the
// spread has to clear the subtree extents, not just the node widths.
export function subtree_bbox(
  pose: Pose,
  snapshot: Snapshot,
  root: AnimationID,
): { x: number; w: number } {
  const ids = subtree_ids(snapshot, root);
  let min_x = Infinity;
  let max_x = -Infinity;
  for (const id of ids) {
    const nb = pose.nodes.get(id);
    if (!nb) continue;
    if (nb.x < min_x) min_x = nb.x;
    if (nb.x + nb.w > max_x) max_x = nb.x + nb.w;
  }
  if (!Number.isFinite(min_x)) {
    const nb = pose.nodes.get(root);
    return nb ? { x: nb.x, w: nb.w } : { x: 0, w: 0 };
  }
  return { x: min_x, w: max_x - min_x };
}

// Recompute pose.min_x and pose.width from the current element
// positions. Call after shifting / moving / resizing elements so the
// view's outer translate and SVG size reflect the actual bounds — the
// baseline's bounds are stale once we've moved L / R / siblings around.
// Includes hidden-but-still-positioned elements so bounds don't jitter
// when something fades out mid-op.
export function recompute_bounds(pose: Pose): void {
  let min_x = Infinity;
  let max_x = -Infinity;
  const consume = (x: number, w: number) => {
    if (x < min_x) min_x = x;
    if (x + w > max_x) max_x = x + w;
  };
  for (const b of pose.nodes.values()) consume(b.x, b.w);
  for (const b of pose.keys.values()) consume(b.x, b.w);
  for (const b of pose.slots.values()) consume(b.x, b.w);
  for (const e of pose.edges.values()) {
    const emin = Math.min(e.x1, e.x2);
    const emax = Math.max(e.x1, e.x2);
    if (emin < min_x) min_x = emin;
    if (emax > max_x) max_x = emax;
  }
  if (pose.probe) consume(pose.probe.x, pose.probe.w);
  if (!Number.isFinite(min_x)) min_x = 0;
  if (!Number.isFinite(max_x)) max_x = 0;
  pose.min_x = min_x;
  pose.width = max_x - min_x;
}
