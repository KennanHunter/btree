import type { AnimationID, Snapshot, SplitKind, Step } from "core";
import type { Operation } from "./operation";
import { step_at } from "./operation";
import { easeInOutCubic, easeOutCubic } from "./ease";
import type { Keyframe, Pose } from "./pose";
import {
  attach_probe_above,
  layout_scene,
  reserve_slot,
  scene_from_snapshot,
  with_eased_width,
  type Scene,
} from "./scene";
import {
  clone_pose,
  hide_edges,
  hide_node_frame,
  move_key,
  move_node_only,
  pin_subtree_to,
  recompute_bounds,
  render_node_as_leaf,
  set_ease_width,
} from "./pose_edit";
import { CELL_W, H_GAP } from "./view";

export type Ctx = {
  op: Operation;
  index: number;
  probe_id: AnimationID | undefined;
  probe_value: number | undefined;
};

// Look up the numeric value for an inserted `value_id`. We prefer the keys
// recorded on the operation's result (populated at dispatch time) because
// those cover duplicates too — a visit_insert whose value turned out to be
// already in the tree never leaves a trace in `op.final`, but its key id
// still shows up as a probe during playback.
function lookup_value(op: Operation, id: AnimationID): number {
  const r = op.result;
  if (r.type === "Insert" && r.key.id === id) return r.key.value;
  if (r.type === "BulkInsert") {
    for (const k of r.keys) if (k.id === id) return k.value;
  }
  // Fallback for operation kinds that don't carry key metadata (shouldn't
  // happen for the insert path, but keeps the function total).
  for (const nid in op.final.nodes) {
    for (const k of op.final.nodes[nid].data_keys) {
      if (k.id === id) return k.value;
    }
  }
  return NaN;
}

// Resolve the probe for step `index` by walking back to the most recent
// `visit_insert`. Returns `undefined` once we hit `insert_merge` /
// `insert_median_found` (the probe has dissolved into the tree) or a step
// outside any insert at all.
export function resolve_probe_at(
  op: Operation,
  index: number,
): { id: AnimationID; value: number } | undefined {
  if (op.kind !== "insert" && op.kind !== "bulk_insert") return undefined;
  for (let j = index; j >= 0; j--) {
    const s = step_at(op, j);
    if (!s) continue;
    const e = s.event;
    if (e.t === "visit_insert") {
      const id = e.value_id;
      return { id, value: lookup_value(op, id) };
    }
    if (e.t === "insert_merge" || e.t === "insert_median_found")
      return undefined;
  }
  return undefined;
}

// Walk back through the step stream to find where the probe currently is.
// Returns an "attached" descriptor so read events during descent (compare,
// visit_read) don't drop the probe.
function current_probe_target(
  op: Operation,
  up_to: number,
):
  | { kind: "above"; node: AnimationID }
  | { kind: "in_slot"; node: AnimationID; index: number }
  | undefined {
  for (let j = up_to; j >= 0; j--) {
    const s = step_at(op, j);
    if (!s) continue;
    const e = s.event;
    if (e.t === "visit_insert") return { kind: "above", node: e.node_id };
    if (e.t === "descend") return { kind: "above", node: e.to };
    if (e.t === "insert_widen")
      return { kind: "in_slot", node: e.node, index: e.index };
    // Once merged, the key is a real tree key; the probe is gone.
    if (e.t === "insert_merge" || e.t === "insert_median_found") return undefined;
  }
  return undefined;
}

// Find the id of a node's parent in a snapshot. Returns undefined if the
// node is the root (or missing).
function find_parent(
  data: { nodes: Record<AnimationID, { children: readonly AnimationID[] }> },
  child: AnimationID,
): AnimationID | undefined {
  for (const pid in data.nodes) {
    if (data.nodes[pid].children.includes(child)) return Number(pid);
  }
  return undefined;
}

// Attach the current parked probe (if any) onto a scene. Used by the split
// handler so every phase keeps the probe where the choreographer parked it,
// which matters in top-down mode where the split fires before the key is
// inserted.
function with_parked_probe(scene: Scene, ctx: Ctx, up_to: number): Scene {
  if (ctx.probe_id === undefined || ctx.probe_value === undefined) return scene;
  const probe = { id: ctx.probe_id, value: ctx.probe_value };
  const target = current_probe_target(ctx.op, up_to);
  if (!target) return scene;
  if (target.kind === "above")
    return attach_probe_above(scene, target.node, probe);
  return reserve_slot(scene, target.node, target.index, probe);
}

// ---------------------------------------------------------------------------
// Split phase pose builder — baseline + deltas.
//
// All four split events share one snapshot (fully-connected, post-split
// tree). The baseline is `layout_scene(scene_from_snapshot(snapshot))` —
// K+1 wide parent, L and R in their natural children-row positions,
// median key sitting inside parent's slot. Each phase clones that
// baseline and applies a handful of deltas:
//
//   Phase 1 slide_apart[init]  — L and R overlap overflow's old span
//                                (L on its left half, R on its right).
//                                Median between them at the leaf row.
//                                Parent→L / parent→R edges hidden.
//
//   Phase 1 slide_apart[final] — L and R spread outward symmetrically
//                                around overflow.center. A, C (pinned
//                                siblings) slide outward by the same
//                                offset so the gaps around L/R stay at
//                                H_GAP. Median still at leaf row.
//
//   Phase 2 pull_median        — Same L/R/A/C as final, median at a y
//                                halfway between leaf row and parent
//                                row. Reads as the median "climbing."
//
//   Phase 3 parent_grows       — Baseline unmodified except hide the
//                                new slot cell (so it fades in at
//                                phase 4) and hide parent→L / parent→R
//                                edges. For grow_root (single-key
//                                fresh parent) also hide the frame
//                                and render as leaf — the slot row
//                                extends only at phase 4.
//
//   Phase 4 connect            — Pure baseline; the only tweak is the
//                                single-key-parent frame hide for
//                                grow_root.
//
// Siblings (A, C — children of parent that aren't L or R) are pinned
// to their pre-split positions in phase 1 init, and allowed to slide
// outward symmetrically in phase 1 final + phase 2. In phase 3 + 4
// they settle to their natural K+1 positions (baseline). Pose coords
// are anchored on root.center_x = 0, so the siblings' symmetric slide
// is visible as Δx deltas rather than being masked by a per-pose
// renormalization.
// ---------------------------------------------------------------------------
function split_phase_pose(
  ctx: Ctx,
  i: number,
  ev: {
    node: AnimationID;
    right: AnimationID;
    median: AnimationID;
    copy?: AnimationID;
    kind: SplitKind;
  },
  snapshot: Snapshot,
  phase:
    | "split_slide_apart"
    | "split_pull_median"
    | "split_parent_grows"
    | "split_connect_to_children",
  // Sub-phase for `split_slide_apart`: `"init"` places L and R
  // overlapping the overflow node's old span; `"final"` spreads them
  // apart. Other phases ignore this.
  slide_sub: "init" | "final" = "final",
): Pose {
  // Baseline: fully-connected post-split layout. Includes the parked
  // probe so top-down pre-splits keep the probe visible across phases.
  const base_scene = with_parked_probe(scene_from_snapshot(snapshot), ctx, i);
  const baseline = layout_scene(base_scene);
  const pose = clone_pose(baseline);

  const parent_id = find_parent(snapshot, ev.node);
  if (parent_id === undefined) return pose;

  const parent_node = snapshot.nodes[parent_id];
  const grandparent = find_parent(snapshot, parent_id);
  const is_fresh_root =
    grandparent === undefined && parent_node.children.length === 2;
  const parent_key_id = ev.copy ?? ev.median;
  const edge_left = `${parent_id}->${ev.node}`;
  const edge_right = `${parent_id}->${ev.right}`;

  // Walk back to the step just before `split_slide_apart` ran. Its
  // snapshot has the overflow node still intact (no `right` sibling),
  // which gives us two things: overflow's actual bounds (for the init
  // sub-phase's overlap) and sibling positions (for the pin).
  let pre_split_step: Step | undefined;
  for (let j = i - 1; j >= 0; j--) {
    const s = step_at(ctx.op, j);
    if (!s) break;
    if (!s.snapshot.nodes[ev.right]) {
      pre_split_step = s;
      break;
    }
  }
  const prev_pose = pre_split_step
    ? layout_scene(scene_from_snapshot(pre_split_step.snapshot))
    : undefined;
  const prev_parent = prev_pose?.nodes.get(parent_id);

  // ---- Phase 4 — fully connected ---------------------------------------
  if (phase === "split_connect_to_children") {
    if (parent_node.data_keys.length === 1) {
      // Single-key fresh root — the key reads on its own without a frame.
      hide_node_frame(pose, parent_id);
    }
    recompute_bounds(pose);
    return pose;
  }

  // ---- Phase 3 — parent grows ------------------------------------------
  if (phase === "split_parent_grows") {
    // Hide only the newly-created slots (indices beyond the pre-split
    // children count) — the pre-existing child pointers were already
    // visible in slide_apart / pull_median for an internal parent, so
    // they should stay visible through parent_grows too; only the new
    // slot (where R will connect) pops in at phase 4.
    const pre_count = pre_split_step
      ? pre_split_step.snapshot.nodes[parent_id]?.children.length ?? 0
      : 0;
    for (
      let si = pre_count;
      si < parent_node.children.length;
      si++
    ) {
      pose.hidden.add(`${parent_id}:${si}`);
    }
    hide_edges(pose, [edge_left, edge_right]);
    if (is_fresh_root) {
      hide_node_frame(pose, parent_id);
      render_node_as_leaf(pose, parent_id);
    } else {
      // Multi-key parent widens from K-wide (phase 2) to K+1-wide
      // (phase 3). Mark the width for interpolation so the lerp animates
      // the growth instead of snapping.
      set_ease_width(pose, parent_id);
    }
    recompute_bounds(pose);
    return pose;
  }

  // ---- Phases 1 & 2 — slide_apart + pull_median ------------------------
  // For a grow_root (fresh root created by this split) the parent didn't
  // exist pre-split — hide its frame + slots entirely, median emerges
  // between L and R below "nothing". For an internal parent that was
  // already there, keep the frame + its pre-existing child-pointer
  // slots visible at their pre-split positions; only the slot that was
  // just added (for R) is hidden until phase 4. Non-median data_keys
  // stay visible at their pre-split positions too so nothing pops in
  // or out during the two sub-phases.
  if (is_fresh_root) {
    hide_node_frame(pose, parent_id);
    for (let si = 0; si < parent_node.children.length; si++) {
      pose.hidden.add(`${parent_id}:${si}`);
    }
  }
  hide_edges(pose, [edge_left, edge_right]);

  if (prev_parent) {
    // Keep parent box at pre-split dimensions. Keys and slots render
    // relative to parent.x via NodeView's g translate, so pinning the
    // box anchors them in the pre-split frame.
    const nb = pose.nodes.get(parent_id);
    if (nb) {
      pose.nodes.set(parent_id, {
        ...nb,
        x: prev_parent.x,
        y: prev_parent.y,
        w: prev_parent.w,
      });
    }
  }

  if (prev_pose && pre_split_step) {
    const pre_split_parent = pre_split_step.snapshot.nodes[parent_id];
    if (pre_split_parent) {
      // Pin pre-split parent keys to the positions they had before the
      // median absorbed. Median itself is handled per-sub-phase below.
      for (const pre_key of pre_split_parent.data_keys) {
        if (pre_key.id === parent_key_id) continue;
        const prev_kb = prev_pose.keys.get(pre_key.id);
        if (!prev_kb) continue;
        move_key(pose, pre_key.id, {
          x: prev_kb.x,
          y: prev_kb.y,
          w: prev_kb.w,
        });
      }

      if (!is_fresh_root) {
        // Pin pre-existing slot cells (indices < pre_count) to their
        // pre-split positions so they align with the pinned K-wide
        // parent. Any slot added by this split (index >= pre_count) is
        // hidden; it'll pop in at phase 4 alongside its edge.
        const pre_count = pre_split_parent.children.length;
        for (let i = 0; i < pre_count; i++) {
          const slot_id = `${parent_id}:${i}`;
          const prev_slot = prev_pose.slots.get(slot_id);
          const cur_slot = pose.slots.get(slot_id);
          if (!prev_slot || !cur_slot) continue;
          pose.slots.set(slot_id, {
            ...cur_slot,
            x: prev_slot.x,
            y: prev_slot.y,
            w: prev_slot.w,
          });
        }
        for (
          let i = pre_count;
          i < parent_node.children.length;
          i++
        ) {
          pose.hidden.add(`${parent_id}:${i}`);
        }
      }
    }
  }

  const L_box = pose.nodes.get(ev.node);
  const R_box = pose.nodes.get(ev.right);
  if (!L_box || !R_box) return pose;

  // Shrink the median key to CELL_W for its floating phases. The
  // baseline places it inside parent's slot with width = parent.w /
  // data_keys.length — which for a wide multi-key parent can be more
  // than CELL_W, giving an odd stretched median mid-split. CELL_W reads
  // as a single-key cell, matching how it'll look in phase 3 for narrow
  // parents.
  const median_w = CELL_W;

  // Pre-split M (overflow) is the node that just split — same id as L.
  const prev_overflow = prev_pose?.nodes.get(ev.node);

  // Median lands inline with L and R at their current row. For a leaf
  // split L.y matches prev_overflow.y (M was already at leaf row). For
  // grow_root, M was at root-y but L and R now sit a level lower under
  // the new parent — using L.y keeps the median visually in the same
  // row as the two halves emerging below.
  const row_y = L_box.y;

  // Overflow M's own-rect bounds — the "joined" area L+median+R fill
  // in the init sub-phase, and the pivot the spread centres around in
  // final / pull_median. L and R are addressed by their NODE widths
  // (not subtree) because their children stay anchored to pre-split
  // positions through slide_apart.
  const overflow_node_x = prev_overflow?.x ?? L_box.x;
  const overflow_node_w = prev_overflow?.w ?? L_box.w;
  const overflow_node_center = overflow_node_x + overflow_node_w / 2;

  // Spread total in children-row for the final sub-phase: L.node, R.node,
  // and median separated by H_GAP channels. In init L+median+R exactly
  // fill overflow's node area, so there's no spread; in final the span
  // widens past overflow by (spread_w - overflow.w) and the parent-
  // level siblings slide outward by half of that to keep the gap.
  const spread_node_w =
    L_box.w + 2 * H_GAP + median_w + R_box.w;
  const spread_delta =
    slide_sub === "final"
      ? Math.max(0, (spread_node_w - overflow_node_w) / 2)
      : 0;

  // Pin L.children and R.children subtrees horizontally to their
  // pre-split positions. The user asks for the grandchildren below the
  // splitting node to "not really move" — the motion in slide_apart is
  // the parent-level row. Children slide into their natural post-split
  // x during parent_grows.
  //
  // Only the x is pinned, not y: for a grow_root split the tree gains a
  // level, so what used to sit at y=root-child-row now sits at
  // y=root-grandchild-row. Pinning y to pre-split would stack the
  // children at L / R's own y and collapse the tree visually. Keeping y
  // at baseline lets the "frame drop one row" animation play naturally
  // between pre-split and slide_apart; for a same-height split the two
  // y's are identical anyway, so this is a no-op there.
  if (prev_pose) {
    const L_children = snapshot.nodes[ev.node]?.children ?? [];
    const R_children = snapshot.nodes[ev.right]?.children ?? [];
    for (const cid of [...L_children, ...R_children]) {
      const prev_child = prev_pose.nodes.get(cid);
      const cur_child = pose.nodes.get(cid);
      if (!prev_child || !cur_child) continue;
      pin_subtree_to(pose, snapshot, cid, prev_child.x, cur_child.y);
    }
  }

  // Pin sibling subtrees (children of parent other than L / R). In
  // phase 1 "init" the siblings land at pre-split spots exactly; in
  // phase 1 "final" + phase 2 each slides outward by `spread_delta`
  // (left-side siblings by –Δ, right-side by +Δ) so the H_GAP around
  // L / R is preserved as they spread. Fresh root has no parent, so
  // the loop is a no-op there.
  if (pre_split_step && prev_pose) {
    const pre_split_parent = pre_split_step.snapshot.nodes[parent_id];
    if (pre_split_parent) {
      const l_pre_idx = pre_split_parent.children.indexOf(ev.node);
      for (const sib_id of parent_node.children) {
        if (sib_id === ev.node || sib_id === ev.right) continue;
        const prev_box = prev_pose.nodes.get(sib_id);
        if (!prev_box) continue;
        const sib_pre_idx = pre_split_parent.children.indexOf(sib_id);
        const direction =
          sib_pre_idx < 0 || l_pre_idx < 0
            ? 0
            : sib_pre_idx < l_pre_idx
              ? -1
              : 1;
        pin_subtree_to(
          pose,
          snapshot,
          sib_id,
          prev_box.x + direction * spread_delta,
          prev_box.y,
        );
      }
    }
  }

  // Phase 1 "init" — L and R overlap M.node's area, "as if still
  // joined". L fills M's left cells, R fills the right, median in the
  // middle. Only move the nodes themselves; L.children and R.children
  // (pinned above) stay anchored.
  if (phase === "split_slide_apart" && slide_sub === "init") {
    move_node_only(pose, snapshot, ev.node, {
      x: overflow_node_x,
      y: row_y,
    });
    move_node_only(pose, snapshot, ev.right, {
      x: overflow_node_x + overflow_node_w - R_box.w,
      y: row_y,
    });
    move_key(pose, parent_key_id, {
      x: overflow_node_center - median_w / 2,
      y: row_y,
      w: median_w,
    });
    recompute_bounds(pose);
    return pose;
  }

  // Phase 1 "final" + Phase 2 — L and R slide outward around
  // overflow.node.center with median between them. L.node.right +
  // H_GAP = median.left, median.right + H_GAP = R.node.left. Children
  // stay pinned, so parent→child edges stretch during this phase and
  // snap back when the children settle during parent_grows.
  const spread_L_node_x =
    overflow_node_center - median_w / 2 - H_GAP - L_box.w;
  const spread_R_node_x = overflow_node_center + median_w / 2 + H_GAP;
  const spread_median_x = overflow_node_center - median_w / 2;

  move_node_only(pose, snapshot, ev.node, {
    x: spread_L_node_x,
    y: row_y,
  });
  move_node_only(pose, snapshot, ev.right, {
    x: spread_R_node_x,
    y: row_y,
  });

  if (phase === "split_slide_apart") {
    move_key(pose, parent_key_id, {
      x: spread_median_x,
      y: row_y,
      w: median_w,
    });
  } else {
    // Pull_median — median rises partway toward parent's row.
    const parent_in_baseline = baseline.nodes.get(parent_id);
    const parent_y = parent_in_baseline?.y ?? row_y;
    const halfway_y = (row_y + parent_y) / 2;
    move_key(pose, parent_key_id, {
      x: spread_median_x,
      y: halfway_y,
      w: median_w,
    });
  }

  recompute_bounds(pose);
  return pose;
}

export function step_total_weight(op: Operation, index: number): number {
  const probe = resolve_probe_at(op, index);
  const kfs = choreograph({
    op,
    index,
    probe_id: probe?.id,
    probe_value: probe?.value,
  });
  return kfs.reduce((a, k) => a + k.weight, 0) || 1;
}

export function choreograph(ctx: Ctx): Keyframe[] {
  const { op, index: i } = ctx;
  const step = step_at(op, i);
  if (!step) return [];

  const snapshot = step.snapshot;
  const ev = step.event;

  const has_probe =
    ctx.probe_id !== undefined && ctx.probe_value !== undefined;
  const probe = has_probe
    ? { id: ctx.probe_id!, value: ctx.probe_value! }
    : undefined;

  // Build the scene for this keyframe.
  let scene: Scene;

  switch (ev.t) {
    case "visit_insert":
      scene = scene_from_snapshot(snapshot);
      if (probe) scene = attach_probe_above(scene, ev.node_id, probe);
      break;

    case "select_descent_child":
      // One-step pause before the actual move: the target child is lit
      // by the highlight, but the probe stays parked above the parent
      // (`ev.from`). The next step is `descend`, which slides the probe
      // down to `ev.to`.
      scene = scene_from_snapshot(snapshot);
      if (probe) scene = attach_probe_above(scene, ev.from, probe);
      break;

    case "descend":
      scene = scene_from_snapshot(snapshot);
      if (probe) scene = attach_probe_above(scene, ev.to, probe);
      break;

    case "insert_widen": {
      // Pre-splice snapshot: the leaf still has N keys. Reserve the gap
      // at `ev.index` so this frame already shows the leaf at its final
      // (K+1-cell) width, with the probe filling that reserved slot.
      // Also opt the leaf into width-ease so the lerp shows the leaf
      // visibly growing instead of snapping to the new width while the
      // existing keys slide into place around it.
      scene = scene_from_snapshot(snapshot);
      if (probe) scene = reserve_slot(scene, ev.node, ev.index, probe);
      scene = with_eased_width(scene, ev.node);
      break;
    }

    case "insert_merge":
    case "insert_median_found":
      // Post-splice snapshot already contains the key; no probe.
      scene = scene_from_snapshot(snapshot);
      break;

    case "split_slide_apart":
      // Two keyframes: `init` places R overlapping L (so R enters the DOM
      // behind L, invisible, instead of popping into existence at its
      // spread position) with weight 0 — snap. Then `final` lerps over
      // the full stepMs, sliding R and median out to the spread.
      return [
        {
          pose: split_phase_pose(ctx, i, ev, snapshot, ev.t, "init"),
          weight: 0,
          ease: easeInOutCubic,
        },
        {
          pose: split_phase_pose(ctx, i, ev, snapshot, ev.t, "final"),
          weight: 1,
          ease: easeInOutCubic,
        },
      ];

    case "split_pull_median":
    case "split_parent_grows":
    case "split_connect_to_children":
      return [
        {
          pose: split_phase_pose(ctx, i, ev, snapshot, ev.t),
          weight: 1,
          ease: easeInOutCubic,
        },
      ];

    default: {
      // Default: pose from this step's snapshot. If the probe is mid-descent
      // keep it parked where it was.
      scene = scene_from_snapshot(snapshot);
      if (probe) {
        const target = current_probe_target(op, i);
        if (target?.kind === "above")
          scene = attach_probe_above(scene, target.node, probe);
        else if (target?.kind === "in_slot")
          scene = reserve_slot(scene, target.node, target.index, probe);
      }
    }
  }

  const pose = layout_scene(scene);
  const ease = ev.t === "insert_merge" || ev.t === "insert_median_found"
    ? easeOutCubic
    : easeInOutCubic;

  return [{ pose, weight: 1, ease }];
}

export function entry_pose(ctx: Ctx): Pose {
  const kfs = choreograph(ctx);
  if (kfs.length === 0) {
    // Degenerate: no step. Return the current snapshot's layout.
    const step = step_at(ctx.op, ctx.index);
    const data = step ? step.snapshot : ctx.op.final;
    return layout_scene(scene_from_snapshot(data));
  }
  return kfs[0].pose;
}
