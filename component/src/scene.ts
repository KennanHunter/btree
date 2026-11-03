import type { AnimationID, Key, NodeData, Snapshot, TreeData } from "core";
import {
  CANVAS_PADDING,
  CELL_H,
  CELL_W,
  H_GAP,
  V_GAP,
  type EdgeLine,
  type KeyBox,
  type NodeBox,
  type SlotBox,
} from "./view";
import type { Pose, ProbeBox } from "./pose";

// ============================================================================
// Scene — a *logical* description of what to draw at one moment in time.
//
// Shape-wise it's just `{ root, nodes }` (same keyed-TreeData shape the tree
// uses) plus an optional floating probe. There are *no* coordinates here;
// that is the layout step's job.
//
// Two tricks the choreographer uses to express the probe's role in the tree:
//   • `attach_probe_above(scene, node)` — the probe is a free-floating token
//     above `node`, not inside the tree. Used during descent.
//   • `reserve_slot(scene, node, index, probe)` — the probe will occupy a
//     key cell at `index` in `node`. We splice a placeholder Key with
//     `id === probe.id` into `node.data_keys` so the layout *widens* the
//     node and reserves the slot. Rendering hides the placeholder (the
//     probe draws there instead).
//
// `reserve_probe_band` keeps the "space above the tree for the probe to
// hover in" present across every keyframe of the operation, even keyframes
// that don't currently have a probe (e.g. `insert_merge` where the probe
// has just dissolved). That stops the tree from jumping vertically between
// probe-bearing and probe-less keyframes.
// ============================================================================

export type ProbeAttachment =
  | { kind: "above_node"; node: AnimationID }
  | { kind: "in_slot"; node: AnimationID; index: number };

export type ProbeState = {
  id: AnimationID;
  value: number;
  attachment: ProbeAttachment;
};

// A key displayed outside the tree hierarchy — used mid-split to show the
// median "pulled out" of the splitting node.
//
// Anchors:
//   • `between_children` — centered in the gap between two sibling subtrees
//     at the children row of their shared parent.
//   • `at_point` — explicit (x, y) coordinates in the pose's own coordinate
//     space. Useful when you've pre-computed a natural layout and want the
//     floating key to sit at a specific box (e.g. the median's eventual
//     parent-slot x, children-row y, so the pull-up motion is pure vertical).
export type FloatingKey = {
  id: AnimationID;
  value: number;
  // Optional width/height. Default is CELL_W × CELL_H. The split
  // choreographer sets these to match the median's eventual natural
  // parent-slot dimensions so the key doesn't visibly grow/shrink while
  // flying to its final cell (relevant when the parent widens the slot
  // past CELL_W, e.g. a 1-key new root occupying both child columns).
  w?: number;
  h?: number;
  anchor:
    | {
        kind: "between_children";
        parent: AnimationID;
        before: AnimationID;
        after: AnimationID;
      }
    | {
        kind: "at_point";
        x: number;
        y: number;
        // The node this floating key logically belongs to. Used by the
        // renderer to nest the key inside that node's <g> for layer
        // stability — if the parent isn't in the scene (e.g. during
        // a grow_root split's early phases) the renderer falls back to
        // treating the key as a top-level element.
        parent: AnimationID;
      };
};

export type Scene = {
  root: AnimationID | null;
  nodes: Record<AnimationID, NodeData>;
  probe?: ProbeState;
  // Keys that render in the pose but aren't attached to any node's data_keys.
  floating_keys?: FloatingKey[];
  // Edge ids (`${from}->${to}`) that the layout should still compute but
  // the pose should hide. Used in the orphan phases of split, where left
  // and right exist in the tree but shouldn't visually connect to parent
  // yet.
  hidden_edges?: Set<string>;
  // After the normal layout places every node, shift the named subtree so
  // its root sits at the given (x, y). Keys, slots, and edges inside the
  // subtree move with it. Used in split's pull-median phase to overlap
  // left/right at the same spot before they slide apart.
  node_overrides?: Record<AnimationID, { x: number; y: number }>;
  // Hide a node's child-slot row (make it render as if it were a leaf of
  // height CELL_H). Used in the first two split phases when the new root
  // hasn't "extended downwards" yet to show its two slots.
  render_as_leaf?: Set<AnimationID>;
  // Skip rendering a node's rect (border + fill) while still laying out
  // and rendering its keys and slots inside. Used when a parent has
  // only a single key — a brand-new root created by grow_root — so the
  // key doesn't sit inside an awkward empty frame.
  no_frame_nodes?: Set<AnimationID>;
  // Node ids whose width should ease between keyframes instead of
  // snapping. Default behaviour is snap because integer-cell widths look
  // bad half-way through a tween, but insert_widen specifically wants to
  // show the leaf growing as the probe slides into its new slot.
  ease_node_widths?: Set<AnimationID>;
  // Subtrees to render outside the normal root traversal. Used during the
  // first split phase to display the newly-created right half as an orphan
  // sibling of the overflowing left, before the parent has absorbed it.
  // Position is given in the layout's own pre-shift coordinate space (the
  // final `normalize` step will shift all placed elements together).
  extra_nodes?: { id: AnimationID; x: number; y: number }[];
};

// ----------------------------------------------------------------------------
// Scene builders
// ----------------------------------------------------------------------------

export function scene_from_snapshot(data: TreeData | Snapshot): Scene {
  // Shallow clone the tree so callers can splice placeholders without
  // mutating the underlying snapshot.
  const nodes: Record<AnimationID, NodeData> = {};
  for (const nid in data.nodes) {
    const n = data.nodes[nid];
    nodes[nid] = {
      id: n.id,
      data_keys: [...n.data_keys],
      children: [...n.children],
    };
  }
  return { root: data.root, nodes };
}

export function attach_probe_above(
  scene: Scene,
  node: AnimationID,
  probe: { id: AnimationID; value: number },
): Scene {
  return {
    ...scene,
    probe: {
      id: probe.id,
      value: probe.value,
      attachment: { kind: "above_node", node },
    },
  };
}

// Remove a child id from one node's children. Used mid-split to pull the
// right half out of the parent so the parent stays at pre-split width in
// the first phase. The removed child itself must still render (via
// `with_extra_node`) or it'll vanish from the pose.
export function remove_child_from_node(
  scene: Scene,
  node: AnimationID,
  child: AnimationID,
): Scene {
  const n = scene.nodes[node];
  if (!n) return scene;
  const idx = n.children.indexOf(child);
  if (idx < 0) return scene;
  const copy: NodeData = {
    ...n,
    children: n.children.filter((_, i) => i !== idx),
  };
  return { ...scene, nodes: { ...scene.nodes, [node]: copy } };
}

export function with_extra_node(
  scene: Scene,
  extra: { id: AnimationID; x: number; y: number },
): Scene {
  return {
    ...scene,
    extra_nodes: [...(scene.extra_nodes ?? []), extra],
  };
}

// Remove a key by id from one node's data_keys. Used mid-split to pull the
// median out of the parent so a floating-key keyframe can show it hovering
// between left and right.
export function remove_key_from_node(
  scene: Scene,
  node: AnimationID,
  key_id: AnimationID,
): Scene {
  const n = scene.nodes[node];
  if (!n) return scene;
  const idx = n.data_keys.findIndex((k) => k.id === key_id);
  if (idx < 0) return scene;
  const copy: NodeData = { ...n, data_keys: n.data_keys.filter((_, i) => i !== idx) };
  return { ...scene, nodes: { ...scene.nodes, [node]: copy } };
}

export function with_floating_key(scene: Scene, fk: FloatingKey): Scene {
  return {
    ...scene,
    floating_keys: [...(scene.floating_keys ?? []), fk],
  };
}

export function with_hidden_edges(scene: Scene, ids: string[]): Scene {
  const h = new Set(scene.hidden_edges ?? []);
  for (const id of ids) h.add(id);
  return { ...scene, hidden_edges: h };
}

export function override_node_pos(
  scene: Scene,
  id: AnimationID,
  pos: { x: number; y: number },
): Scene {
  return {
    ...scene,
    node_overrides: { ...(scene.node_overrides ?? {}), [id]: pos },
  };
}

export function render_node_as_leaf(scene: Scene, id: AnimationID): Scene {
  const s = new Set(scene.render_as_leaf ?? []);
  s.add(id);
  return { ...scene, render_as_leaf: s };
}

export function hide_node_frame(scene: Scene, id: AnimationID): Scene {
  const s = new Set(scene.no_frame_nodes ?? []);
  s.add(id);
  return { ...scene, no_frame_nodes: s };
}

export function with_eased_width(scene: Scene, id: AnimationID): Scene {
  const s = new Set(scene.ease_node_widths ?? []);
  s.add(id);
  return { ...scene, ease_node_widths: s };
}

// Width of a subtree's bounding box — the horizontal extent the subtree
// occupies in a natural layout. Used by the split choreographer to place
// the orphan right half beyond L's *whole* subtree, not just L's own
// rect; at deeper tree levels L's subtree is much wider than L itself.
export function subtree_width(scene: Scene, id: AnimationID): number {
  return measure(scene, id).width;
}

export function reserve_slot(
  scene: Scene,
  node: AnimationID,
  index: number,
  probe: { id: AnimationID; value: number },
): Scene {
  const n = scene.nodes[node];
  if (!n) return scene;
  // If the placeholder is already present (e.g. we're re-applying the same
  // scene) don't double-insert.
  if (n.data_keys[index]?.id === probe.id) {
    return {
      ...scene,
      probe: {
        id: probe.id,
        value: probe.value,
        attachment: { kind: "in_slot", node, index },
      },
    };
  }
  const placeholder: Key = { id: probe.id, value: probe.value };
  const copy: NodeData = {
    ...n,
    data_keys: [...n.data_keys],
  };
  copy.data_keys.splice(index, 0, placeholder);
  return {
    ...scene,
    nodes: { ...scene.nodes, [node]: copy },
    probe: {
      id: probe.id,
      value: probe.value,
      attachment: { kind: "in_slot", node, index },
    },
  };
}

// ============================================================================
// Layout — Scene → Pose
//
// Four stages, each pure:
//   1. measure(scene)       — recursively size every subtree.
//   2. place(scene, sized)  — stamp absolute (x, y) onto every box.
//   3. place_probe(scene, placed) — resolve the probe's box relative to the
//                                   placed tree.
//   4. normalize(placed, probe)   — compute final width/height; shift so the
//                                   top-left of everything we draw sits at
//                                   (0, 0).
// ============================================================================

const PROBE_GAP = 10;

export const EMPTY_POSE: Pose = {
  nodes: new Map(),
  keys: new Map(),
  slots: new Map(),
  edges: new Map(),
  width: 0,
  height: 0,
  hidden: new Set(),
};

// Subtree measurements — the bounding box of a node's whole subtree plus
// the node's own geometry. Shared between measure and place.
type Measured = {
  id: AnimationID;
  width: number; // subtree bbox
  height: number; // subtree bbox
  node_w: number; // this node's own rect
  node_h: number;
  has_children: boolean;
  children: Measured[];
};

function measure(scene: Scene, id: AnimationID): Measured {
  const n = scene.nodes[id];
  const has_children = n.children.length > 0;
  // `render_as_leaf` makes this node's rect only one row tall (no slot
  // row), even though it still has children in the tree. We still descend
  // into those children so they render below — they'll just be visually
  // detached from the parent until the slot row grows back in.
  const render_leaf = scene.render_as_leaf?.has(id) ?? false;
  const cols = Math.max(
    n.data_keys.length,
    has_children ? n.children.length : 0,
    1,
  );
  const node_w = cols * CELL_W;
  const node_h = has_children && !render_leaf ? 2 * CELL_H : CELL_H;

  const children = n.children.map((cid) => measure(scene, cid));
  const children_w =
    children.reduce((a, c) => a + c.width, 0) +
    Math.max(0, children.length - 1) * H_GAP;
  const children_h = children.length
    ? V_GAP + Math.max(...children.map((c) => c.height))
    : 0;

  return {
    id,
    width: Math.max(node_w, children_w),
    height: node_h + children_h,
    node_w,
    node_h,
    has_children,
    children,
  };
}

type Placed = {
  nodes: Map<AnimationID, NodeBox>;
  keys: Map<AnimationID, KeyBox>;
  slots: Map<string, SlotBox>;
  edges: Map<string, EdgeLine>;
};

function place(
  scene: Scene,
  m: Measured,
  x: number,
  y: number,
  out: Placed,
): void {
  const n = scene.nodes[m.id];
  // Center this node's own rect within its subtree bbox.
  const node_x = x + (m.width - m.node_w) / 2;

  out.nodes.set(m.id, {
    id: m.id,
    x: node_x,
    y,
    w: m.node_w,
    h: m.node_h,
    leaf: !m.has_children,
    ease_width: scene.ease_node_widths?.has(m.id) ? true : undefined,
    no_frame: scene.no_frame_nodes?.has(m.id) ? true : undefined,
  });

  // Top row — key cells share the width evenly across however many keys
  // (plus placeholders) are present.
  const top_cols = Math.max(n.data_keys.length, 1);
  const top_cell_w = m.node_w / top_cols;
  for (let i = 0; i < n.data_keys.length; i++) {
    const k = n.data_keys[i];
    out.keys.set(k.id, {
      id: k.id,
      node: m.id,
      value: k.value,
      x: node_x + i * top_cell_w,
      y,
      w: top_cell_w,
      h: CELL_H,
    });
  }

  if (!m.has_children) return;

  const render_leaf = scene.render_as_leaf?.has(m.id) ?? false;

  // Bottom row — one CELL_W slot per child pointer, left-aligned under the
  // parent. When this node is rendering as a leaf we still *create* each
  // slot but collapse its height to 0, so the lerp from a leaf-rendered
  // pose into a normal pose grows each slot from a flat line into a full
  // cell (instead of popping in).
  for (let i = 0; i < n.children.length; i++) {
    const slot_id = `${m.id}:${i}`;
    out.slots.set(slot_id, {
      id: slot_id,
      node: m.id,
      slot: i,
      x: node_x + i * CELL_W,
      y: y + CELL_H,
      w: CELL_W,
      h: render_leaf ? 0 : CELL_H,
    });
  }

  // Children — center the row of subtrees under the parent and recurse.
  const children_w =
    m.children.reduce((a, c) => a + c.width, 0) +
    Math.max(0, m.children.length - 1) * H_GAP;
  let cx = x + (m.width - children_w) / 2;
  const child_y = y + m.node_h + V_GAP;

  m.children.forEach((cm, i) => {
    // Edge origin: bottom of child-slot row when internal, bottom of key
    // row when rendering as leaf. The lerp between the two gives the
    // "slot row extends and edges reach down to children" visual.
    const slot_x = node_x + (i + 0.5) * CELL_W;
    const slot_y = render_leaf ? y + CELL_H : y + 2 * CELL_H;
    const child_top_x = cx + cm.width / 2;
    const edge_id = `${m.id}->${cm.id}`;
    out.edges.set(edge_id, {
      id: edge_id,
      from: m.id,
      to: cm.id,
      x1: slot_x,
      y1: slot_y,
      x2: child_top_x,
      y2: child_y,
    });
    place(scene, cm, cx, child_y, out);
    cx += cm.width + H_GAP;
  });
}

// Collect every id in a scene subtree rooted at `id`.
function subtree_ids(
  scene: Scene,
  id: AnimationID,
  out: Set<AnimationID> = new Set(),
): Set<AnimationID> {
  if (out.has(id)) return out;
  out.add(id);
  const n = scene.nodes[id];
  if (!n) return out;
  for (const c of n.children) subtree_ids(scene, c, out);
  return out;
}

// Shift a specific subtree (node + descendants) in a Placed by (dx, dy).
// Also shifts the two endpoints of every edge whose from or to is inside
// the subtree, so edges to/from the subtree track the move.
function shift_subtree(
  scene: Scene,
  placed: Placed,
  root: AnimationID,
  dx: number,
  dy: number,
) {
  if (dx === 0 && dy === 0) return;
  const ids = subtree_ids(scene, root);
  for (const id of ids) {
    const nb = placed.nodes.get(id);
    if (nb) placed.nodes.set(id, { ...nb, x: nb.x + dx, y: nb.y + dy });
    const n = scene.nodes[id];
    if (!n) continue;
    for (const k of n.data_keys) {
      const kb = placed.keys.get(k.id);
      if (kb) placed.keys.set(k.id, { ...kb, x: kb.x + dx, y: kb.y + dy });
    }
    for (let i = 0; i < n.children.length; i++) {
      const slot_id = `${id}:${i}`;
      const sb = placed.slots.get(slot_id);
      if (sb) placed.slots.set(slot_id, { ...sb, x: sb.x + dx, y: sb.y + dy });
    }
  }
  for (const [eid, e] of placed.edges) {
    const to_in = ids.has(e.to);
    const from_in = ids.has(e.from);
    if (!to_in && !from_in) continue;
    const next = { ...e };
    if (from_in) {
      next.x1 += dx;
      next.y1 += dy;
    }
    if (to_in) {
      next.x2 += dx;
      next.y2 += dy;
    }
    placed.edges.set(eid, next);
  }
}

function place_probe(
  state: ProbeState | undefined,
  placed: Placed,
): ProbeBox | undefined {
  if (!state) return undefined;
  const { id, value, attachment } = state;

  if (attachment.kind === "above_node") {
    const nb = placed.nodes.get(attachment.node);
    if (!nb) return undefined;
    // Centered horizontally on the node, sitting one cell + gap above it.
    return {
      id,
      value,
      w: CELL_W,
      h: CELL_H,
      x: nb.x + nb.w / 2 - CELL_W / 2,
      y: nb.y - CELL_H - PROBE_GAP,
    };
  }

  // in_slot: the placeholder key with the probe's id is already in the
  // layout. Mirror its box.
  const slot = placed.keys.get(id);
  if (!slot) return undefined;
  return { id, value, x: slot.x, y: slot.y, w: slot.w, h: slot.h };
}

// Shift every placed box + the probe by (dx, dy). Mutates the placed maps
// in place because they were freshly created in this call.
function shift_all(placed: Placed, probe: ProbeBox | undefined, dx: number, dy: number): ProbeBox | undefined {
  if (dx === 0 && dy === 0) return probe;
  for (const [k, b] of placed.nodes)
    placed.nodes.set(k, { ...b, x: b.x + dx, y: b.y + dy });
  for (const [k, b] of placed.keys)
    placed.keys.set(k, { ...b, x: b.x + dx, y: b.y + dy });
  for (const [k, b] of placed.slots)
    placed.slots.set(k, { ...b, x: b.x + dx, y: b.y + dy });
  for (const [k, e] of placed.edges)
    placed.edges.set(k, {
      ...e,
      x1: e.x1 + dx,
      y1: e.y1 + dy,
      x2: e.x2 + dx,
      y2: e.y2 + dy,
    });
  return probe
    ? { ...probe, x: probe.x + dx, y: probe.y + dy }
    : undefined;
}

export function layout_scene(scene: Scene): Pose {
  if (scene.root == null) return EMPTY_POSE;

  // (1) measure
  const sized = measure(scene, scene.root);

  // (2) place — the tree sits below a fixed "probe band" of vertical
  // padding (one cell plus a gap). The band is always reserved, even for
  // keyframes with no probe, so the tree never jumps up/down as the probe
  // comes and goes within an operation (or across operations).
  const probe_band = CELL_H + PROBE_GAP;
  const placed: Placed = {
    nodes: new Map(),
    keys: new Map(),
    slots: new Map(),
    edges: new Map(),
  };
  place(scene, sized, 0, probe_band, placed);

  // (2b) apply node position overrides. For each `(id, pos)` pair we shift
  // the whole subtree rooted at `id` so its node sits at `pos`. Overrides
  // must apply ancestor-first — a later ancestor shift would otherwise
  // move its descendants a second time and clobber their absolute-target
  // overrides. The default for-in iteration order sorts integer keys
  // numerically, which doesn't match tree depth (grow_root can make a
  // parent's id larger than its children's). We BFS from the scene root
  // so parents always process before their children.
  if (scene.node_overrides) {
    const order: AnimationID[] = [];
    const seen = new Set<AnimationID>();
    const queue: AnimationID[] = [scene.root];
    while (queue.length) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      if (id in scene.node_overrides) order.push(id);
      const n = scene.nodes[id];
      if (!n) continue;
      for (const c of n.children) queue.push(c);
    }
    // Any override on a node not reachable from scene.root (e.g. an
    // extra_node) still runs, just last.
    for (const idStr in scene.node_overrides) {
      const id = Number(idStr);
      if (!seen.has(id)) order.push(id);
    }
    for (const id of order) {
      const current = placed.nodes.get(id);
      if (!current) continue;
      const target = scene.node_overrides[id];
      shift_subtree(scene, placed, id, target.x - current.x, target.y - current.y);
    }
  }

  // (2c) place extra subtrees — nodes that exist in `scene.nodes` but
  // weren't reached by the normal traversal from `scene.root`. The right
  // half during split's first phase is rendered this way: the parent has
  // been stripped of it (so parent stays K-wide) and we drop the right
  // subtree at an explicit (x, y) adjacent to left.
  if (scene.extra_nodes?.length) {
    for (const extra of scene.extra_nodes) {
      if (!scene.nodes[extra.id]) continue;
      const m = measure(scene, extra.id);
      place(scene, m, extra.x, extra.y, placed);
    }
  }

  // (3) place the probe relative to the (now placed) tree
  let probe = place_probe(scene.probe, placed);

  // (3b) place any floating keys (median mid-split). We stamp them into the
  // same `keys` map so the player's lerp sees the key by id and interpolates
  // smoothly as the key moves between a tree position (prev pose) and a
  // floating position (this pose) — and later between floating and in-parent.
  if (scene.floating_keys?.length) {
    for (const fk of scene.floating_keys) {
      let x: number;
      let y: number;
      let parent: AnimationID;
      if (fk.anchor.kind === "between_children") {
        const before = placed.nodes.get(fk.anchor.before);
        const after = placed.nodes.get(fk.anchor.after);
        if (!before || !after) continue;
        // Centered in the gap between the two sibling subtrees, at the
        // same row as the children.
        x = (before.x + before.w + after.x) / 2 - CELL_W / 2;
        y = before.y;
        parent = fk.anchor.parent;
      } else {
        x = fk.anchor.x;
        y = fk.anchor.y;
        parent = fk.anchor.parent;
      }
      placed.keys.set(fk.id, {
        id: fk.id,
        node: parent,
        value: fk.value,
        x,
        y,
        w: fk.w ?? CELL_W,
        h: fk.h ?? CELL_H,
      });
    }
  }

  // (3c) collapse hidden edges onto their origin endpoint. Keeps the
  // player's lerp smooth when an edge transitions from hidden → visible
  // across a step boundary: in the hidden pose the edge is a zero-length
  // point at its parent slot, so the lerp into the visible pose has the
  // edge "grow" from the parent downward toward the child instead of
  // appearing at full length. (Hidden edges aren't drawn either way; the
  // collapse only matters for the subsequent lerp.)
  if (scene.hidden_edges) {
    for (const id of scene.hidden_edges) {
      const e = placed.edges.get(id);
      if (!e) continue;
      placed.edges.set(id, { ...e, x2: e.x1, y2: e.y1 });
    }
  }

  // (4) normalize — compute the pose's true bounding box from everything
  // that will actually be drawn, then shift so (minX, minY) = (0, 0). We
  // seed the box with (0, probe_band) so the top padding stays reserved
  // even for probe-less poses, keeping the tree position consistent across
  // keyframes. The box then expands to cover any element that landed
  // outside the measured subtree bbox — e.g. node overrides pushing a
  // subtree sideways in split, or a probe hovering above a non-root node.
  let min_x = 0;
  let min_y = 0;
  let max_x = 0;
  let max_y = probe_band;
  const consume_rect = (x: number, y: number, w: number, h: number) => {
    if (x < min_x) min_x = x;
    if (y < min_y) min_y = y;
    if (x + w > max_x) max_x = x + w;
    if (y + h > max_y) max_y = y + h;
  };
  const consume_point = (x: number, y: number) => consume_rect(x, y, 0, 0);
  for (const b of placed.nodes.values()) consume_rect(b.x, b.y, b.w, b.h);
  for (const b of placed.keys.values()) consume_rect(b.x, b.y, b.w, b.h);
  for (const b of placed.slots.values()) consume_rect(b.x, b.y, b.w, b.h);
  for (const e of placed.edges.values()) {
    consume_point(e.x1, e.y1);
    consume_point(e.x2, e.y2);
  }
  if (probe) consume_rect(probe.x, probe.y, probe.w, probe.h);
  probe = shift_all(placed, probe, -min_x, -min_y);

  // (5) hidden set: placeholder key under a slot-filling probe, plus any
  // edges the choreographer wants to mask (e.g. during split's orphan
  // phases).
  const hidden = new Set<string>();
  if (scene.probe?.attachment.kind === "in_slot")
    hidden.add(String(scene.probe.id));
  if (scene.hidden_edges)
    for (const id of scene.hidden_edges) hidden.add(id);

  return {
    nodes: placed.nodes,
    keys: placed.keys,
    slots: placed.slots,
    edges: placed.edges,
    width: max_x - min_x,
    height: max_y - min_y,
    hidden,
    probe,
  };
}

export { CANVAS_PADDING };
