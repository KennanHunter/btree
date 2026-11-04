import type { AnimationID, BTreeEvent } from "../../core/src";

export type Highlight = {
  nodes: Set<AnimationID>;
  keys: Set<AnimationID>;
  edges: Set<string>; // `${from}->${to}`
  slots: Set<string>; // `${node}:${slot}` — child-pointer cell
  // Nodes that should render in the "danger" palette (red fill/stroke)
  // and shake. Used for `insert_node_overfill` to flag "this node has
  // just exceeded fanout and is about to split."
  alarm_nodes: Set<AnimationID>;
  // Preferred key id to center the follow-camera on. When set, the camera
  // tracks this single key instead of the full highlight bbox centroid —
  // used during splits so the median stays pinned while the two halves
  // slide apart.
  anchor_key?: AnimationID;
};

export function empty_highlight(): Highlight {
  return {
    nodes: new Set(),
    keys: new Set(),
    edges: new Set(),
    slots: new Set(),
    alarm_nodes: new Set(),
  };
}

export function highlight_from(event: BTreeEvent | undefined): Highlight {
  const h = empty_highlight();
  if (!event) return h;

  switch (event.t) {
    case "visit_read":
    case "not_found":
      h.nodes.add(event.node);
      return h;

    case "insert_node_overfill":
      // Both ordinary active-emphasis and the alarm set so the shake
      // picks it up but it still reads as the "current focus" node.
      h.nodes.add(event.node);
      h.alarm_nodes.add(event.node);
      return h;

    case "visit_insert":
      h.nodes.add(event.node_id);
      return h;

    case "found":
      h.nodes.add(event.node);
      h.keys.add(event.key);
      return h;

    case "compare":
      h.nodes.add(event.node);
      h.keys.add(event.key_id);
      return h;

    case "descend":
    case "ascend":
      h.nodes.add(event.from);
      h.nodes.add(event.to);
      h.edges.add(`${event.from}->${event.to}`);
      return h;

    case "select_descent_child":
      // Light the child-pointer slot in the parent (not the edge),
      // so the user sees which pointer we're about to follow.
      h.nodes.add(event.from);
      h.slots.add(`${event.from}:${event.slot}`);
      return h;

    case "insert_widen":
    case "insert_merge":
    case "insert_median_found":
    case "delete_key":
      h.nodes.add(event.node);
      h.keys.add(event.key);
      return h;

    case "split_pull_median":
    case "split_parent_grows":
    case "split_slide_apart":
    case "split_connect_to_children":
      h.nodes.add(event.node);
      h.nodes.add(event.right);
      h.keys.add(event.median);
      if (event.copy != null) h.keys.add(event.copy);
      // Pin the camera to the median so the follow-center doesn't swing
      // across the screen as the right half slides out.
      h.anchor_key = event.median;
      return h;

    case "grow_root":
      if (event.old_root != null) h.nodes.add(event.old_root);
      h.nodes.add(event.new_root);
      return h;

    case "emit":
      h.nodes.add(event.node);
      h.keys.add(event.key);
      return h;
  }
}
