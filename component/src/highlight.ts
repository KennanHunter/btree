import type { AnimationID, BTreeEvent } from "core";

export type Highlight = {
  nodes: Set<AnimationID>;
  keys: Set<AnimationID>;
  edges: Set<string>; // `${from}->${to}`
};

export function empty_highlight(): Highlight {
  return { nodes: new Set(), keys: new Set(), edges: new Set() };
}

export function highlight_from(event: BTreeEvent | undefined): Highlight {
  const h = empty_highlight();
  if (!event) return h;

  switch (event.t) {
    case "insert_start":
      // Marker only — nothing on the tree to highlight; the mutation events
      // that follow carry the real emphasis.
      return h;

    case "visit":
    case "not_found":
      h.nodes.add(event.node);
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

    case "insert_key":
    case "delete_key":
      h.nodes.add(event.node);
      h.keys.add(event.key);
      return h;

    case "split":
      h.nodes.add(event.node);
      h.nodes.add(event.right);
      h.keys.add(event.median);
      if (event.copy != null) h.keys.add(event.copy);
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
