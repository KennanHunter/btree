import type { AnimationID, Snapshot, TreeConfig } from "core";

export type TreeStats = {
  depth: number;
  node_count: number;
  leaf_count: number;
  key_count: number;
  avg_fill: number;
};

export function compute_stats(snapshot: Snapshot, config: TreeConfig): TreeStats {
  const node_ids = Object.keys(snapshot.nodes).map(Number) as AnimationID[];
  const node_count = node_ids.length;

  let key_count = 0;
  let leaf_count = 0;
  for (const id of node_ids) {
    const n = snapshot.nodes[id];
    key_count += n.data_keys.length;
    if (n.children.length === 0) leaf_count++;
  }

  const capacity = config.fanout - 1;
  const avg_fill = node_count === 0 ? 0 : key_count / (node_count * capacity);

  const depth = snapshot.root == null ? 0 : depth_from(snapshot, snapshot.root);

  return { depth, node_count, leaf_count, key_count, avg_fill };
}

function depth_from(snapshot: Snapshot, id: AnimationID): number {
  const n = snapshot.nodes[id];
  if (n.children.length === 0) return 1;
  let max = 0;
  for (const child of n.children) {
    const d = depth_from(snapshot, child);
    if (d > max) max = d;
  }
  return 1 + max;
}
