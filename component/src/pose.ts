import type { AnimationID } from "@kennanhunter/btree/core";
import type { EdgeLine, KeyBox, NodeBox, SlotBox } from "./view";

// A floating value cell. The choreographer uses it for the insert "probe"
// (the value being inserted, hovering above the tree during the descent)
// and nothing else — but the shape is identical to a KeyBox, so lerping
// between a probe and a tree key (e.g. the insert's final merged cell)
// is a smooth motion.
export type ProbeBox = {
  id: AnimationID;
  value: number;
  x: number;
  y: number;
  w: number;
  h: number;
};

// A fully laid-out frame, keyed by stable AnimationIDs so the player can
// find corresponding elements across keyframes and interpolate between
// them. Produced by `layout_scene` and consumed by the player.
//
// Coord anchor: `scene.root`'s x-center sits at x = 0. Elements left of
// the root have negative x. y is normalized so the top of what's drawn
// (probe band or tree top) sits at y = 0. `min_x` is the leftmost x
// seen; the view translates by `-min_x` at render time so negative
// content lands inside the SVG viewport. Anchoring on the root makes
// symmetric motion (e.g. siblings sliding apart as the middle widens)
// visible as actual `Δx` deltas in the pose instead of being erased by
// a per-pose `shift_all(-min_x)` normalization.
export type Pose = {
  nodes: Map<AnimationID, NodeBox>;
  keys: Map<AnimationID, KeyBox>;
  slots: Map<string, SlotBox>;
  edges: Map<string, EdgeLine>;
  width: number;
  height: number;
  // Leftmost x in the pose, measured from root.center_x = 0. Negative
  // when the subtree extends left of the root (common for widening or
  // multi-child trees). The view uses this to pick its outer translate.
  min_x: number;
  probe?: ProbeBox;
  // DOM ids (`${from}->${to}` for edges, `String(id)` for keys/nodes) that
  // the view should not draw. Used e.g. to mask the parent→child edges
  // during the orphan phases of split.
  hidden: Set<string>;
};

// One phase of a step's animation. The choreographer may return several
// of these per step; the player chains them, giving each a duration
// proportional to its `weight` out of the step's base `stepMs`.
export type Keyframe = {
  pose: Pose;
  weight: number;
  ease: (t: number) => number;
};
