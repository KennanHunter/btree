import { create_b_tree } from ".";
import type { Key, NodeData, Tree } from "./btree";
import { check_config_for_errors, type TreeConfig } from "./config";
import type {
  BTreeEventRecorder,
  BTreeOperation,
  Step,
} from "./events";
import { expect, describe, it } from "vitest";

/** Project Keys down to their numeric values, dropping animation ids. */
function key_values(keys: readonly Key[] | undefined): number[] {
  return keys ? keys.map((k) => k.value) : [];
}

function noop_recorder(): BTreeEventRecorder {
  let steps: Step[] = [];
  return {
    record(event, snapshot) {
      steps.push({ event, snapshot: snapshot() });
    },
    clear() {
      steps = [];
    },
    rollup_operation(kind, final): BTreeOperation {
      const op = { kind, steps: [...steps], final };
      steps = [];
      return op;
    },
  };
}

function make_tree(overrides: Partial<TreeConfig> = {}): Tree {
  const config: TreeConfig = {
    fanout: 4,
    insert_mode: "top_down",
    inner_nodes_have_data: true,
    search_mode: "binary",
    ...overrides,
  };
  const result = create_b_tree(config, noop_recorder());
  if (result.error) throw new Error(`unexpected config error: ${result.type}`);
  return result.tree;
}

function keys_in_order(
  tree: Tree,
  node: NodeData | undefined,
  out: number[] = [],
): number[] {
  if (!node) return out;
  if (node.children.length === 0) {
    out.push(...key_values(node.data_keys));
    return out;
  }
  for (let i = 0; i < node.data_keys.length; i++) {
    keys_in_order(tree, tree.node(node.children[i]), out);
    out.push(node.data_keys[i].value);
  }
  keys_in_order(tree, tree.node(node.children[node.data_keys.length]), out);
  return out;
}

function leaf_keys(
  tree: Tree,
  node: NodeData | undefined,
  out: number[] = [],
): number[] {
  if (!node) return out;
  if (node.children.length === 0) {
    out.push(...key_values(node.data_keys));
    return out;
  }
  for (const c of node.children) leaf_keys(tree, tree.node(c), out);
  return out;
}

function leaf_depths(
  tree: Tree,
  node: NodeData,
  depth = 0,
  out: number[] = [],
): number[] {
  if (node.children.length === 0) {
    out.push(depth);
    return out;
  }
  for (const c of node.children) leaf_depths(tree, tree.node(c), depth + 1, out);
  return out;
}

function assert_bounded(tree: Tree, node: NodeData) {
  expect(node.data_keys.length).toBeLessThanOrEqual(tree.config.fanout - 1);
  if (node.children.length > 0) {
    expect(node.children.length).toBe(node.data_keys.length + 1);
    for (const c of node.children) assert_bounded(tree, tree.node(c));
  }
}

describe("create_b_tree", () => {
  it("returns a tree with the given config", () => {
    const result = create_b_tree(
      {
        fanout: 4,
        insert_mode: "top_down",
        inner_nodes_have_data: true,
        search_mode: "binary",
      },
      noop_recorder(),
    );
    expect(result.error).toBe(false);
    if (!result.error) {
      expect(result.tree.config.fanout).toBe(4);
      expect(result.tree.root_node()).toBeUndefined();
    }
  });

  it("errors when fanout < 2", () => {
    const result = create_b_tree(
      {
        fanout: 1,
        insert_mode: "bottom_up",
        inner_nodes_have_data: true,
        search_mode: "binary",
      },
      noop_recorder(),
    );
    expect(result.error).toBe(true);
    if (result.error) {
      expect(result.type).toBe("FanoutTooLow");
      expect(result.message).toBe("B Tree requires a fanout of at least 2");
    }
  });

  it("accepts fanout = 2", () => {
    const result = create_b_tree(
      {
        fanout: 2,
        insert_mode: "bottom_up",
        inner_nodes_have_data: true,
        search_mode: "binary",
      },
      noop_recorder(),
    );
    expect(result.error).toBe(false);
  });

  it("errors when top_down uses an odd fanout", () => {
    const result = create_b_tree(
      {
        fanout: 5,
        insert_mode: "top_down",
        inner_nodes_have_data: true,
        search_mode: "binary",
      },
      noop_recorder(),
    );
    expect(result.error).toBe(true);
    if (result.error) {
      expect(result.type).toBe("TopDownOddFanout");
      expect(result.message).toBe(
        "B Tree's using the top down method must have an even fanout >= 4",
      );
    }
  });

  it("allows bottom_up with odd fanout", () => {
    const result = create_b_tree(
      {
        fanout: 3,
        insert_mode: "bottom_up",
        inner_nodes_have_data: true,
        search_mode: "binary",
      },
      noop_recorder(),
    );
    expect(result.error).toBe(false);
  });
});

describe("check_config_for_errors", () => {
  const base: TreeConfig = {
    fanout: 4,
    insert_mode: "top_down",
    inner_nodes_have_data: true,
    search_mode: "binary",
  };

  it("returns true for a valid config", () => {
    expect(check_config_for_errors(base)).toBe(true);
  });

  it("flags fanout below 2", () => {
    const r = check_config_for_errors({ ...base, fanout: 1, insert_mode: "bottom_up" });
    expect(r).toEqual({
      type: "FanoutTooLow",
      message: "B Tree requires a fanout of at least 2",
    });
  });

  it("flags top_down with odd fanout", () => {
    const r = check_config_for_errors({ ...base, fanout: 5 });
    expect(r).toEqual({
      type: "TopDownOddFanout",
      message:
        "B Tree's using the top down method must have an even fanout >= 4",
    });
  });

  it("allows bottom_up with odd fanout", () => {
    expect(
      check_config_for_errors({ ...base, fanout: 5, insert_mode: "bottom_up" }),
    ).toBe(true);
  });
});

describe("Tree.insert", () => {
  it("creates a root on first insert", () => {
    const tree = make_tree();
    tree.insert(5);
    expect(key_values(tree.root_node()?.data_keys)).toEqual([5]);
  });

  it("inserts into a leaf in sorted order", () => {
    const tree = make_tree({ fanout: 4 });
    for (const v of [5, 2, 8]) tree.insert(v);
    expect(key_values(tree.root_node()?.data_keys)).toEqual([2, 5, 8]);
    expect(tree.root_node()?.children.length).toBe(0);
  });

  it("splits a full root and grows height (top_down)", () => {
    const tree = make_tree({ fanout: 4 });
    for (const v of [1, 2, 3, 4]) tree.insert(v);
    expect(tree.root_node()?.children.length).toBeGreaterThan(0);
    expect(keys_in_order(tree, tree.root_node())).toEqual([1, 2, 3, 4]);
  });

  it("splits a full root and grows height (bottom_up)", () => {
    const tree = make_tree({ fanout: 3, insert_mode: "bottom_up" });
    for (const v of [1, 2, 3]) tree.insert(v);
    expect(tree.root_node()?.children.length).toBeGreaterThan(0);
    expect(keys_in_order(tree, tree.root_node())).toEqual([1, 2, 3]);
  });

  it("keeps all leaves at the same depth (top_down)", () => {
    const tree = make_tree({ fanout: 4 });
    for (const v of [10, 20, 5, 6, 12, 30, 7, 17, 11, 1, 2, 3]) tree.insert(v);
    const depths = leaf_depths(tree, tree.root_node()!);
    expect(new Set(depths).size).toBe(1);
  });

  it("keeps all leaves at the same depth (bottom_up)", () => {
    const tree = make_tree({ fanout: 3, insert_mode: "bottom_up" });
    for (const v of [10, 20, 5, 6, 12, 30, 7, 17, 11, 1, 2, 3]) tree.insert(v);
    const depths = leaf_depths(tree, tree.root_node()!);
    expect(new Set(depths).size).toBe(1);
  });

  it("maintains sorted in-order traversal across many inserts (top_down)", () => {
    const tree = make_tree({ fanout: 4 });
    const values = [
      50, 10, 70, 20, 40, 30, 60, 80, 5, 15, 25, 35, 45, 55, 65, 75,
    ];
    for (const v of values) tree.insert(v);
    const sorted = [...values].sort((a, b) => a - b);
    expect(keys_in_order(tree, tree.root_node())).toEqual(sorted);
  });

  it("respects fanout bounds on every node", () => {
    const tree = make_tree({ fanout: 4 });
    for (let i = 0; i < 50; i++) tree.insert(i);
    assert_bounded(tree, tree.root_node()!);
  });

  it("B+ tree variant keeps every inserted key in the leaves", () => {
    const tree = make_tree({
      fanout: 4,
      insert_mode: "bottom_up",
      inner_nodes_have_data: false,
    });
    const values = [50, 10, 70, 20, 40, 30, 60, 80, 5, 15, 25, 35, 45, 55];
    for (const v of values) tree.insert(v);
    const leaves = leaf_keys(tree, tree.root_node());
    expect([...leaves].sort((a, b) => a - b)).toEqual(
      [...values].sort((a, b) => a - b),
    );
  });
});

describe("Tree.is_full", () => {
  const make_populated = (fanout: number, values: number[]) => {
    const tree = make_tree({ fanout });
    const n = tree.new_node(
      values.map((value) => ({ value, id: tree.ids.allocate_id() })),
    );
    return { tree, n };
  };

  it("is true when keys = fanout - 1", () => {
    const { tree, n } = make_populated(4, [1, 2, 3]);
    expect(key_values(n.data_keys)).toEqual([1, 2, 3]);
    expect(tree.is_full(n.id)).toBe(true);
  });

  it("is false below the limit", () => {
    const { tree, n } = make_populated(4, [1]);
    expect(key_values(n.data_keys)).toEqual([1]);
    expect(tree.is_full(n.id)).toBe(false);
  });
});

// --- Randomized invariant fuzz --------------------------------------------
// Seeded RNG so failures reproduce. mulberry32 is enough for this.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Walk every node and check the structural invariants. The caller supplies
 * `expected`: the sorted unique set of values that have been inserted so far
 * (B-tree in-order traversal / B+ leaf concatenation must equal it).
 *
 * Throws an Error with a precise message on first violation so the fuzz
 * loop fails loudly.
 */
function assert_invariants(tree: Tree, expected_sorted: number[]) {
  const cfg = tree.config;
  const data = tree.data;
  const root = tree.root_node();
  if (!root) {
    expect(expected_sorted).toEqual([]);
    return;
  }

  const max_keys = cfg.fanout - 1;
  const min_keys = Math.ceil(cfg.fanout / 2) - 1;
  const is_bplus = !cfg.inner_nodes_have_data;

  const node_ids = new Set<number>();
  const key_ids = new Set<number>();
  const leaf_depths: number[] = [];

  // Returns [min, max] key values present in the subtree.
  function walk(id: number, depth: number, is_root: boolean): [number, number] {
    const n = data.nodes[id];
    if (node_ids.has(n.id)) throw new Error(`duplicate node id ${n.id}`);
    node_ids.add(n.id);

    // keys sorted + unique within the node, ids unique
    for (let i = 0; i < n.data_keys.length; i++) {
      const k = n.data_keys[i];
      if (key_ids.has(k.id)) throw new Error(`duplicate key id ${k.id}`);
      key_ids.add(k.id);
      if (i > 0 && n.data_keys[i - 1].value >= k.value) {
        throw new Error(`unsorted/duplicate keys in node ${n.id}`);
      }
    }

    // fill bounds
    if (n.data_keys.length > max_keys) {
      throw new Error(`node ${n.id} over max fill (${n.data_keys.length}/${max_keys})`);
    }
    if (!is_root && n.data_keys.length < min_keys) {
      throw new Error(
        `node ${n.id} under min fill (${n.data_keys.length}/${min_keys})`,
      );
    }

    if (n.children.length === 0) {
      leaf_depths.push(depth);
      // At fanout = 2, min_keys == 0 — an empty right-half leaf is a
      // legitimate split outcome, so only flag empty leaves when the
      // min-fill rule would actually forbid them.
      if (n.data_keys.length === 0 && !is_root && min_keys > 0) {
        throw new Error(`empty leaf ${n.id}`);
      }
      if (n.data_keys.length === 0) {
        return [Infinity, -Infinity];
      }
      const vs = n.data_keys.map((k) => k.value);
      return [vs[0]!, vs[vs.length - 1]!];
    }

    // internal: #children = #keys + 1
    if (n.children.length !== n.data_keys.length + 1) {
      throw new Error(
        `node ${n.id} children/keys mismatch (${n.children.length} vs ${n.data_keys.length})`,
      );
    }

    let overall_min = Infinity;
    let overall_max = -Infinity;
    for (let i = 0; i < n.children.length; i++) {
      const [cmin, cmax] = walk(n.children[i], depth + 1, false);
      overall_min = Math.min(overall_min, cmin);
      overall_max = Math.max(overall_max, cmax);

      // separator relations
      if (i < n.data_keys.length) {
        const sep = n.data_keys[i].value;
        if (!(cmax < sep)) {
          throw new Error(
            `left child ${n.children[i]} max ${cmax} not < separator ${sep}`,
          );
        }
      }
      if (i > 0) {
        const sep = n.data_keys[i - 1].value;
        if (is_bplus) {
          // B+ internal: separator is the min of the right subtree
          if (!(cmin >= sep)) {
            throw new Error(
              `right child ${n.children[i]} min ${cmin} not >= separator ${sep}`,
            );
          }
        } else {
          // Classic B-tree: strictly greater (the separator itself lives in the parent)
          if (!(cmin > sep)) {
            throw new Error(
              `right child ${n.children[i]} min ${cmin} not > separator ${sep}`,
            );
          }
        }
      }
    }

    return [overall_min, overall_max];
  }

  walk(root.id, 0, true);

  // all leaves at the same depth
  const depth_set = new Set(leaf_depths);
  if (depth_set.size > 1) {
    throw new Error(`uneven leaf depths: ${[...depth_set].join(",")}`);
  }

  // contents
  const found: number[] =
    is_bplus ? leaf_keys(tree, root) : keys_in_order(tree, root);
  if (found.length !== expected_sorted.length) {
    throw new Error(
      `expected ${expected_sorted.length} values, got ${found.length}`,
    );
  }
  for (let i = 0; i < found.length; i++) {
    if (found[i] !== expected_sorted[i]) {
      throw new Error(
        `at ${i}: expected ${expected_sorted[i]}, got ${found[i]}`,
      );
    }
  }
}

type Combo = {
  insert_mode: "top_down" | "bottom_up";
  inner_nodes_have_data: boolean;
  search_mode: "linear" | "binary";
  fanout: number;
};

function* every_combo(): Generator<Combo> {
  for (const insert_mode of ["top_down", "bottom_up"] as const) {
    for (const inner_nodes_have_data of [true, false]) {
      for (const search_mode of ["linear", "binary"] as const) {
        for (let fanout = 2; fanout <= 8; fanout++) {
          // Top-down pre-split balance requires even fanout ≥ 4.
          if (insert_mode === "top_down" && (fanout % 2 === 1 || fanout < 4)) {
            continue;
          }
          yield { insert_mode, inner_nodes_have_data, search_mode, fanout };
        }
      }
    }
  }
}

describe("Tree.insert invariants (randomized fuzz)", () => {
  for (const combo of every_combo()) {
    const label = `${combo.insert_mode} fanout=${combo.fanout} ${combo.inner_nodes_have_data ? "btree" : "b+"} search=${combo.search_mode}`;

    it(`holds invariants over 500 inserts — ${label}`, () => {
      const tree = make_tree(combo);
      const rng = mulberry32(0xb7ee ^ combo.fanout ^ (combo.insert_mode === "top_down" ? 1 : 2));
      const unique = new Set<number>();
      for (let i = 0; i < 500; i++) {
        const v = Math.floor(rng() * 10000);
        tree.insert(v);
        unique.add(v);
        const sorted = [...unique].sort((a, b) => a - b);
        try {
          assert_invariants(tree, sorted);
        } catch (e) {
          throw new Error(
            `after insert #${i + 1} (value ${v}) [${label}]: ${(e as Error).message}`,
          );
        }
      }
    });
  }
});
