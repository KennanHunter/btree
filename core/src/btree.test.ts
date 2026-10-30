import { describe, it, expect } from "vitest";
import {
  create_b_tree,
  TreeNode,
  Tree,
  type TreeConfig,
} from "./btree.js";

function make_tree(overrides: Partial<TreeConfig> = {}): Tree {
  const config: TreeConfig = {
    fanout: 4,
    insert_mode: "top_down",
    inner_nodes_have_data: true,
    ...overrides,
  };
  const result = create_b_tree(config);
  if (result.error) throw new Error(`unexpected config error: ${result.type}`);
  return result.tree;
}

function keys_in_order(
  node: TreeNode | undefined,
  out: number[] = [],
): number[] {
  if (!node) return out;
  if (node.children.length === 0) {
    out.push(...node.data_keys);
    return out;
  }
  for (let i = 0; i < node.data_keys.length; i++) {
    keys_in_order(node.children[i], out);
    out.push(node.data_keys[i]);
  }
  keys_in_order(node.children[node.data_keys.length], out);
  return out;
}

function leaf_keys(node: TreeNode | undefined, out: number[] = []): number[] {
  if (!node) return out;
  if (node.children.length === 0) {
    out.push(...node.data_keys);
    return out;
  }
  for (const c of node.children) leaf_keys(c, out);
  return out;
}

function leaf_depths(node: TreeNode, depth = 0, out: number[] = []): number[] {
  if (node.children.length === 0) {
    out.push(depth);
    return out;
  }
  for (const c of node.children) leaf_depths(c, depth + 1, out);
  return out;
}

function assert_bounded(tree: Tree, node: TreeNode) {
  expect(node.data_keys.length).toBeLessThanOrEqual(tree.config.fanout - 1);
  if (node.children.length > 0) {
    expect(node.children.length).toBe(node.data_keys.length + 1);
    for (const c of node.children) assert_bounded(tree, c);
  }
}

describe("create_b_tree", () => {
  it("returns a tree with the given config", () => {
    const result = create_b_tree({
      fanout: 4,
      insert_mode: "top_down",
      inner_nodes_have_data: true,
    });
    expect(result.error).toBe(false);
    if (!result.error) {
      expect(result.tree.config.fanout).toBe(4);
      expect(result.tree.root_node).toBeUndefined();
    }
  });

  it("errors when fanout < 3", () => {
    const result = create_b_tree({
      fanout: 2,
      insert_mode: "bottom_up",
      inner_nodes_have_data: true,
    });
    expect(result.error).toBe(true);
    if (result.error) expect(result.type).toBe("FanoutTooLow");
  });

  it("errors when top_down uses an odd fanout", () => {
    const result = create_b_tree({
      fanout: 5,
      insert_mode: "top_down",
      inner_nodes_have_data: true,
    });
    expect(result.error).toBe(true);
    if (result.error) expect(result.type).toBe("TopDownOddFanout");
  });

  it("allows bottom_up with odd fanout", () => {
    const result = create_b_tree({
      fanout: 3,
      insert_mode: "bottom_up",
      inner_nodes_have_data: true,
    });
    expect(result.error).toBe(false);
  });
});

describe("Tree.insert", () => {
  it("creates a root on first insert", () => {
    const tree = make_tree();
    tree.insert(5);
    expect(tree.root_node?.data_keys).toEqual([5]);
  });

  it("inserts into a leaf in sorted order", () => {
    const tree = make_tree({ fanout: 4 });
    for (const v of [5, 2, 8]) tree.insert(v);
    expect(tree.root_node?.data_keys).toEqual([2, 5, 8]);
    expect(tree.root_node?.children.length).toBe(0);
  });

  it("splits a full root and grows height (top_down)", () => {
    const tree = make_tree({ fanout: 4 });
    for (const v of [1, 2, 3, 4]) tree.insert(v);
    expect(tree.root_node?.children.length).toBeGreaterThan(0);
    expect(keys_in_order(tree.root_node)).toEqual([1, 2, 3, 4]);
  });

  it("splits a full root and grows height (bottom_up)", () => {
    const tree = make_tree({ fanout: 3, insert_mode: "bottom_up" });
    for (const v of [1, 2, 3]) tree.insert(v);
    expect(tree.root_node?.children.length).toBeGreaterThan(0);
    expect(keys_in_order(tree.root_node)).toEqual([1, 2, 3]);
  });

  it("keeps all leaves at the same depth (top_down)", () => {
    const tree = make_tree({ fanout: 4 });
    for (const v of [10, 20, 5, 6, 12, 30, 7, 17, 11, 1, 2, 3])
      tree.insert(v);
    const depths = leaf_depths(tree.root_node!);
    expect(new Set(depths).size).toBe(1);
  });

  it("keeps all leaves at the same depth (bottom_up)", () => {
    const tree = make_tree({ fanout: 3, insert_mode: "bottom_up" });
    for (const v of [10, 20, 5, 6, 12, 30, 7, 17, 11, 1, 2, 3])
      tree.insert(v);
    const depths = leaf_depths(tree.root_node!);
    expect(new Set(depths).size).toBe(1);
  });

  it("maintains sorted in-order traversal across many inserts (top_down)", () => {
    const tree = make_tree({ fanout: 4 });
    const values = [50, 10, 70, 20, 40, 30, 60, 80, 5, 15, 25, 35, 45, 55, 65, 75];
    for (const v of values) tree.insert(v);
    const sorted = [...values].sort((a, b) => a - b);
    expect(keys_in_order(tree.root_node)).toEqual(sorted);
  });

  it("respects fanout bounds on every node", () => {
    const tree = make_tree({ fanout: 4 });
    for (let i = 0; i < 50; i++) tree.insert(i);
    assert_bounded(tree, tree.root_node!);
  });

  it("B+ tree variant keeps every inserted key in the leaves", () => {
    const tree = make_tree({
      fanout: 4,
      insert_mode: "bottom_up",
      inner_nodes_have_data: false,
    });
    const values = [50, 10, 70, 20, 40, 30, 60, 80, 5, 15, 25, 35, 45, 55];
    for (const v of values) tree.insert(v);
    const leaves = leaf_keys(tree.root_node);
    expect([...leaves].sort((a, b) => a - b)).toEqual(
      [...values].sort((a, b) => a - b),
    );
  });
});

describe("TreeNode.is_full", () => {
  it("is true when keys = fanout - 1", () => {
    const tree = make_tree({ fanout: 4 });
    const n = new TreeNode(tree, 1, 2, 3);
    expect(n.is_full()).toBe(true);
  });

  it("is false below the limit", () => {
    const tree = make_tree({ fanout: 4 });
    const n = new TreeNode(tree, 1);
    expect(n.is_full()).toBe(false);
  });
});
