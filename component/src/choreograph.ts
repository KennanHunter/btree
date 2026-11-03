import type { AnimationID, Snapshot, SplitKind, Step } from "core";
import type { Operation } from "./operation";
import { step_at } from "./operation";
import { easeInOutCubic, easeOutCubic } from "./ease";
import type { Keyframe, Pose } from "./pose";
import {
  attach_probe_above,
  hide_node_frame,
  layout_scene,
  override_node_pos,
  remove_child_from_node,
  remove_key_from_node,
  render_node_as_leaf,
  reserve_slot,
  scene_from_snapshot,
  subtree_width,
  with_eased_width,
  with_extra_node,
  with_floating_key,
  with_hidden_edges,
  type Scene,
} from "./scene";
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
// Split phase scene builder
//
// All four split events share one snapshot (fully-connected tree). Each
// phase re-draws that snapshot differently to show one specific motion:
//
//   Phase 1 — split_slide_apart      → "halves slide apart"
//     Parent is held at its pre-split dimensions: median is removed from
//     its data_keys and the right half is removed from its children. L is
//     at its K-wide natural slot (shrunk). R is rendered as an orphan
//     (extra_node) *far* right of L so the two halves read as having slid
//     apart. Any siblings right of L shift further right so they don't
//     collide with the orphan R. For grow_root the whole fresh parent is
//     hidden by setting scene.root = ev.node. The median key is not yet
//     drawn — the lerp from the overflow pose "loses" the median key id
//     because it isn't present in this pose.
//
//   Phase 2 — split_pull_median      → "median pulls out"
//     Same scene as phase 1 plus a floating median at the gap between L
//     and R. The lerp from phase 1 is a clean pop-in of the median.
//
//   Phase 3 — split_parent_grows     → "parent grows"
//     Snapshot's natural layout (parent widens to K+1, median lands in
//     its slot, R becomes a real child). Edges from parent to L/R still
//     hidden. For a fresh root we keep render_as_leaf so the slot row
//     only extends in the final phase.
//
//   Phase 4 — split_connect_to_children → "connect"
//     Fully natural: edges drawn, slot row extends.
//
// The parked probe (if any) is attached in every phase so top-down
// pre-splits don't drop it mid-animation.
// ---------------------------------------------------------------------------
function split_phase_scene(
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
  // Optional sub-phase for `split_slide_apart`: `"init"` places R
  // overlapping L (so R enters the DOM at a position that gets masked
  // by L and then slides out), while `"final"` is the real spread
  // position. Choreographer emits [init, final] as the two keyframes
  // of a slide_apart step; other phases don't use this.
  slide_sub: "init" | "final" = "final",
): Scene {
  const base = with_parked_probe(scene_from_snapshot(snapshot), ctx, i);
  const parent_id = find_parent(snapshot, ev.node);
  if (parent_id === undefined) return base;

  // Pre-split step — the step just before `split_slide_apart` ran.
  // Found by walking back until we hit a snapshot that doesn't yet
  // contain the newly-created right half. Used both to anchor the
  // slide-apart init to overflow's actual bounds AND to pin the parent
  // in place through phases 1-3 so it only moves at `connect_to_children`.
  let pre_split_step: Step | undefined;
  for (let j = i - 1; j >= 0; j--) {
    const s = step_at(ctx.op, j);
    if (!s) break;
    if (!s.snapshot.nodes[ev.right]) {
      pre_split_step = s;
      break;
    }
  }
  let parent_prev_x: number | undefined;
  let parent_prev_y: number | undefined;
  if (pre_split_step && pre_split_step.snapshot.nodes[parent_id]) {
    const prev_pose = layout_scene(scene_from_snapshot(pre_split_step.snapshot));
    const prev_parent = prev_pose.nodes.get(parent_id);
    if (prev_parent) {
      parent_prev_x = prev_parent.x;
      parent_prev_y = prev_parent.y;
    }
  }
  const pin_parent = (scene: Scene): Scene => {
    if (parent_prev_x === undefined || parent_prev_y === undefined) return scene;
    return override_node_pos(scene, parent_id, {
      x: parent_prev_x,
      y: parent_prev_y,
    });
  };
  // Cache the pre-split pose once; `pin_siblings` and (if needed) other
  // helpers reuse it.
  const pre_split_pose = pre_split_step
    ? layout_scene(scene_from_snapshot(pre_split_step.snapshot))
    : undefined;
  // Pin siblings for phases 1-2. `right_shift` is applied to siblings
  // right of overflow (in the pre-split children list) so they slide
  // out of R's way during the "final" sub-phase of slide_apart. Left
  // siblings always stay at their pre-split positions.
  const pin_siblings = (
    scene: Scene,
    parent_id_arg: AnimationID,
    right_shift: number,
  ): Scene => {
    if (!pre_split_pose) return scene;
    const parent_in_snap = snapshot.nodes[parent_id_arg];
    if (!parent_in_snap) return scene;
    // Pre-split child index of the overflowing node, so we know which
    // siblings are "right of L" vs left.
    const pre_split_parent = pre_split_step?.snapshot.nodes[parent_id_arg];
    const l_pre_idx = pre_split_parent?.children.indexOf(ev.node) ?? -1;
    for (const sib_id of parent_in_snap.children) {
      if (sib_id === ev.node || sib_id === ev.right) continue;
      const prev_box = pre_split_pose.nodes.get(sib_id);
      if (!prev_box) continue;
      const prev_sib_idx = pre_split_parent?.children.indexOf(sib_id) ?? -1;
      const shift = prev_sib_idx > l_pre_idx ? right_shift : 0;
      scene = override_node_pos(scene, sib_id, {
        x: prev_box.x + shift,
        y: prev_box.y,
      });
    }
    return scene;
  };

  // Phase 4 — fully connected. If the parent only has one key (the just-
  // landed median, e.g. a fresh root grown from a split), hide the parent
  // rect so the key doesn't sit inside an awkward empty frame.
  if (phase === "split_connect_to_children") {
    const pn = snapshot.nodes[parent_id];
    if (pn && pn.data_keys.length === 1) {
      return hide_node_frame(base, parent_id);
    }
    return base;
  }

  const parent_key_id = ev.copy ?? ev.median;
  const edge_left = `${parent_id}->${ev.node}`;
  const edge_right = `${parent_id}->${ev.right}`;
  const parent_node = snapshot.nodes[parent_id];
  const grandparent = find_parent(snapshot, parent_id);
  const is_fresh_root =
    grandparent === undefined && parent_node.children.length === 2;

  // ---- Phase 3 — parent grows ------------------------------------------
  if (phase === "split_parent_grows") {
    // Hide the one slot cell that didn't exist in the pre-split pose —
    // the slot whose id is `${parent_id}:${K}` where K+1 is the
    // post-split child count. Slot ids are keyed by children-array
    // index, so when R is spliced in, every slot id after L's position
    // gets re-tagged (slot_2 pre = Y, slot_2 post = R, etc.) and lerps
    // across the step; only the last index has no pre-split counterpart
    // and therefore pops in at its final position. In phase 4 it comes
    // in alongside the parent→child edges, which reads as "connected"
    // rather than "spawned."
    const new_slot_id = `${parent_id}:${parent_node.children.length - 1}`;
    let scene: Scene = with_hidden_edges(base, [
      edge_left,
      edge_right,
      new_slot_id,
    ]);
    if (is_fresh_root) scene = render_node_as_leaf(scene, parent_id);
    if (parent_node.data_keys.length === 1) {
      // Single-key parent (grow_root fresh root): hide the frame so the
      // key reads on its own instead of inside an empty rect.
      scene = hide_node_frame(scene, parent_id);
    } else {
      // Multi-key internal parent: ease its width between phase 2
      // (K-wide, stripped of median & R) and phase 3 (K+1-wide, natural)
      // so the parent visibly widens as the median lands in its slot.
      // Node widths otherwise snap by default.
      scene = with_eased_width(scene, parent_id);
    }
    // Phase 3 lets pin_parent's subtree shift carry the siblings:
    // they land at their natural K+1 positions + parent_shift, which
    // smoothly lerps into phase-4's unshifted natural K+1 (delta =
    // parent_shift, same magnitude as parent and L/R).
    return pin_parent(scene);
  }

  // ---- Phases 1 & 2 share the "parent at pre-split size" scaffold ------
  // Parent K-wide (median stripped from data_keys, R stripped from
  // children). R placed as an orphan far-right of L. Any siblings right of
  // L shift to make room for R. For a fresh root we hide the parent
  // entirely by making L the scene root — the brand-new parent then
  // "appears above" L and R in phase 3, which reads as parent-grows.
  let scene: Scene = base;
  scene = remove_key_from_node(scene, parent_id, parent_key_id);
  scene = remove_child_from_node(scene, parent_id, ev.right);
  if (is_fresh_root) {
    scene = { ...scene, root: ev.node };
  }

  // Lay out the stripped scene to find L's K-wide position.
  const nat_stripped = layout_scene(scene);
  const l_box = nat_stripped.nodes.get(ev.node);
  if (!l_box) return scene;

  // Subtree widths — not node widths — drive placement. For a leaf-level
  // split these are equal, but when L is an internal node with its own
  // children, L's subtree is far wider than L's own rect and we need to
  // place R past L's whole subtree (not past L's rect) to avoid overlap.
  const l_subtree_w = subtree_width(scene, ev.node);
  const r_subtree_w = subtree_width(scene, ev.right);

  // Natural (K-wide) centers and the spread center R will land at. Both
  // sub-phases key off these.
  const l_natural_center_x = l_box.x + l_box.w / 2;
  const l_subtree_right_natural = l_natural_center_x + l_subtree_w / 2;
  const SPREAD = CELL_W + 2 * H_GAP;
  const r_final_subtree_x = l_subtree_right_natural + SPREAD;

  // `pin_parent` (applied below) shifts the whole parent subtree by this
  // delta in the override pass. The frame delta is used by median_x and
  // the final-phase R placement to translate from nat_stripped coords
  // into display coords.
  const parent_shift =
    parent_prev_x !== undefined
      ? parent_prev_x - (nat_stripped.nodes.get(parent_id)?.x ?? 0)
      : 0;

  let r_subtree_x: number;
  let l_subtree_right_actual: number;
  if (slide_sub === "init") {
    // Pin L and R to the horizontal bounds the pre-split overflow leaf
    // occupied, so the slide-out starts at the positions the two halves
    // "would have been" inside overflow — L on its left half, R on its
    // right half — instead of stacked at a central midpoint.
    //
    // We look up overflow's actual position by laying out the previous
    // snapshot. Approximating with `l_natural_center_x` breaks at depth:
    // L is narrower than overflow, so the parent's `children_total_w`
    // shrinks between prev and nat_stripped, which shifts the parent
    // (and that shift propagates up the tree), so L's current slot
    // center drifts from where overflow actually was.
    let overflow_subtree_x: number;
    let overflow_w: number;
    if (pre_split_step) {
      const prev_scene = scene_from_snapshot(pre_split_step.snapshot);
      const prev_pose = layout_scene(prev_scene);
      const overflow_box = prev_pose.nodes.get(ev.node);
      const overflow_subtree_w = subtree_width(prev_scene, ev.node);
      if (overflow_box) {
        const overflow_center_x = overflow_box.x + overflow_box.w / 2;
        overflow_subtree_x = overflow_center_x - overflow_subtree_w / 2;
        overflow_w = overflow_subtree_w;
      } else {
        // Node not in prev pose — fall back to the same-slot approximation.
        const l_keys = snapshot.nodes[ev.node].data_keys.length;
        const r_keys = snapshot.nodes[ev.right].data_keys.length;
        const is_bplus_leaf = ev.kind === "bplus_leaf";
        const overflow_key_count = l_keys + r_keys + (is_bplus_leaf ? 0 : 1);
        overflow_w = overflow_key_count * CELL_W;
        overflow_subtree_x = l_natural_center_x - overflow_w / 2;
      }
    } else {
      // No previous step (unlikely for a mid-op split) — fall back.
      const l_keys = snapshot.nodes[ev.node].data_keys.length;
      const r_keys = snapshot.nodes[ev.right].data_keys.length;
      const is_bplus_leaf = ev.kind === "bplus_leaf";
      const overflow_key_count = l_keys + r_keys + (is_bplus_leaf ? 0 : 1);
      overflow_w = overflow_key_count * CELL_W;
      overflow_subtree_x = l_natural_center_x - overflow_w / 2;
    }

    // Padding only kicks in when the overflow didn't have a natural
    // slot's worth of space for the median (B+ leaf splits). btree
    // splits have CELL_W of natural gap and we leave L and R flush
    // against overflow's edges.
    const nat_gap = Math.max(0, overflow_w - l_subtree_w - r_subtree_w);
    const padding = Math.max(0, (CELL_W - nat_gap) / 2);

    const l_init_subtree_x = overflow_subtree_x - padding;
    const r_init_subtree_x =
      overflow_subtree_x + overflow_w - r_subtree_w + padding;
    const l_init_node_x = l_init_subtree_x + (l_subtree_w - l_box.w) / 2;

    scene = override_node_pos(scene, ev.node, {
      x: l_init_node_x,
      y: l_box.y,
    });
    r_subtree_x = r_init_subtree_x;
    l_subtree_right_actual = l_init_subtree_x + l_subtree_w;
  } else {
    // Final sub-phase: L stays at its nat_stripped position (shifted
    // into display coords by pin_parent via shift_subtree). R is placed
    // through extra_node, which bypasses the override pass and uses its
    // (x,y) as absolute display coords — so R needs parent_shift added
    // explicitly here or it lands one parent_shift closer to L than
    // intended, collapsing the designed H_GAP around the median.
    r_subtree_x = r_final_subtree_x + parent_shift;
    l_subtree_right_actual = l_subtree_right_natural;
  }

  scene = with_extra_node(scene, {
    id: ev.right,
    // extra_node x/y is the subtree bbox origin — layout centres R's
    // own rect inside it.
    x: r_subtree_x,
    y: l_box.y,
  });

  // Pin siblings. Left siblings stay at pre-split. Right siblings
  // need to slide out of R's way in the "final" sub-phase (and in
  // pull_median which inherits "final"). shift = how far R's right
  // edge sits past overflow's pre-split right edge; add that same
  // offset to each right sibling so the H_GAP between R and its
  // post-sibling is preserved.
  let right_shift = 0;
  if (slide_sub === "final" && pre_split_pose) {
    const overflow_prev = pre_split_pose.nodes.get(ev.node);
    if (overflow_prev) {
      const overflow_right = overflow_prev.x + overflow_prev.w;
      const r_right_display = r_subtree_x + r_subtree_w;
      right_shift = r_right_display - overflow_right;
    }
  }
  scene = pin_siblings(scene, parent_id, right_shift);

  // Always hide parent→L and parent→R edges so neither half appears
  // connected to the parent yet (parent→R isn't generated by layout since
  // R was removed from parent.children, but we include it defensively).
  scene = with_hidden_edges(scene, [edge_left, edge_right]);

  // Resolve the median's display value — used by both phase 1 and phase 2.
  const median_value =
    snapshot.nodes[parent_id]?.data_keys.find(
      (k) => k.id === parent_key_id,
    )?.value ??
    snapshot.nodes[ev.right]?.data_keys.find((k) => k.id === ev.median)
      ?.value ??
    NaN;

  // Parent-row y in the natural (K+1) layout. Phase 2's "halfway lift"
  // needs it so the floating median starts climbing toward where it'll
  // land. For a fresh root the parent isn't in the pose during phases
  // 1-2 (`scene.root = ev.node` elides it) so we fall back to L's row,
  // making phase 1 == phase 2 — there's no parent above to climb to.
  const nat_full = layout_scene(base);
  const parent_natural = nat_full.nodes.get(parent_id);
  const parent_row_y = parent_natural ? parent_natural.y : l_box.y;

  // Median x: midpoint of the open channel between L and R in display
  // coords. L's subtree-right is in different frames in each sub-phase:
  //   • init  — l_subtree_right_actual is already display (anchored to
  //             overflow's prev bounds).
  //   • final — l_subtree_right_actual is in nat_stripped frame, so add
  //             parent_shift to lift it into the pinned-parent display.
  // R's x is always display: extra_node placement happens AFTER the
  // override pass and uses the given x/y as absolute, so no shift needed.
  const l_right_display =
    l_subtree_right_actual + (slide_sub === "final" ? parent_shift : 0);
  const r_left_display = r_subtree_x;
  const median_center_x = (l_right_display + r_left_display) / 2;
  let median_x = median_center_x - CELL_W / 2;

  // Clamp so the floating median never visually overlaps L's or R's
  // subtree. Padding + rounding in the init sub-phase can leave the raw
  // midpoint flush against (or a hair inside) L's right edge; the clamp
  // slides it just past so it reads as "emerging from L's right side."
  median_x = Math.max(median_x, l_right_display);
  median_x = Math.min(median_x, r_left_display - CELL_W);

  const anchor_y_phase1 = l_box.y;
  const anchor_y_phase2 = (l_box.y + parent_row_y) / 2;

  scene = with_floating_key(scene, {
    id: parent_key_id,
    value: median_value,
    anchor: {
      kind: "at_point",
      x: median_x,
      y: phase === "split_pull_median" ? anchor_y_phase2 : anchor_y_phase1,
      // Points at the real tree parent so the renderer can nest the
      // floating median inside the parent's <g> once the parent is
      // visible (phase 3+ in grow_root; every phase in absorb_split).
      parent: parent_id,
    },
  });

  // Pin parent to its pre-split position so phases 1-3 all read as "L
  // and R moving around a stationary parent." In the fresh-root case
  // the parent isn't in prev's pose at all, so `pin_parent` is a no-op.
  return pin_parent(scene);
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
          pose: layout_scene(
            split_phase_scene(ctx, i, ev, snapshot, ev.t, "init"),
          ),
          weight: 0,
          ease: easeInOutCubic,
        },
        {
          pose: layout_scene(
            split_phase_scene(ctx, i, ev, snapshot, ev.t, "final"),
          ),
          weight: 1,
          ease: easeInOutCubic,
        },
      ];

    case "split_pull_median":
    case "split_parent_grows":
    case "split_connect_to_children":
      return [
        {
          pose: layout_scene(split_phase_scene(ctx, i, ev, snapshot, ev.t)),
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
