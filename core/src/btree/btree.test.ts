import { create_b_tree } from ".";
import type { Key, NodeData, Tree } from "./btree";
import { check_config_for_errors, type TreeConfig } from "./config";
import type {
  BTreeEvent,
  BTreeEventRecorder,
  BTreeOperation,
} from "./events";
import { expect, describe, it } from "vitest";

/** Project Keys down to their numeric values, dropping animation ids. */
function key_values(keys: readonly Key[] | undefined): number[] {
  return keys ? keys.map((k) => k.value) : [];
}

function noop_recorder(): BTreeEventRecorder {
  let events: BTreeEvent[] = [];
  return {
    record(e) {
      events.push(e);
    },
    clear() {
      events = [];
    },
    rollup_operation(type): BTreeOperation {
      const op = { type, events: [...events] };
      events = [];
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

  it("errors when fanout < 3", () => {
    const result = create_b_tree(
      {
        fanout: 2,
        insert_mode: "bottom_up",
        inner_nodes_have_data: true,
        search_mode: "binary",
      },
      noop_recorder(),
    );
    expect(result.error).toBe(true);
    if (result.error) {
      expect(result.type).toBe("FanoutTooLow");
      expect(result.message).toBe("B Tree requires a fanout of at least 3");
    }
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

  it("flags fanout below 3", () => {
    const r = check_config_for_errors({ ...base, fanout: 2, insert_mode: "bottom_up" });
    expect(r).toEqual({
      type: "FanoutTooLow",
      message: "B Tree requires a fanout of at least 3",
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
