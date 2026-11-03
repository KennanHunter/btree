import type { Tree } from "./btree/btree.js";

export function range(start: number, end: number): number[] {
  const out: number[] = [];
  for (let v = start; v <= end; v++) out.push(v);
  return out;
}

export function shuffle(values: number[]): number[] {
  for (let i = values.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [values[i], values[j]] = [values[j], values[i]];
  }

  return values;
}

export function fill_tree_sequential(
  tree: Tree,
  start: number,
  end: number,
): number[] {
  const values = range(start, end);

  for (const v of values) tree.insert({ value: v, id: tree.ids.allocate_id() });

  return values;
}

export function fill_tree_random(tree: Tree, start: number, end: number): number[] {
  const values = shuffle(range(start, end));

  for (const v of values) tree.insert({ value: v, id: tree.ids.allocate_id() });

  return values;
}
