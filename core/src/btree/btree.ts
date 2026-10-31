import { lower_bound_search } from "./bounds_searching";
import type { TreeConfig } from "./config";

export type Split = {
  median: number;
  right: TreeNode;
};

export class TreeNode {
  tree: Tree;
  data_keys: number[] = [];
  children: TreeNode[] = [];

  constructor(tree: Tree, ...values: number[]) {
    this.tree = tree;

    for (const value of values) {
      this.data_keys.push(value);
    }
  }

  is_full(): boolean {
    return this.data_keys.length + 1 === this.tree.config.fanout;
  }

  is_overflow(): boolean {
    return this.data_keys.length + 1 > this.tree.config.fanout;
  }

  /**
   * @returns If value is in a tree node, return that tree node, if not, return the index
   */
  search_for_value(value: number): TreeNode | number | null {
    let found_key = this.search_data_keys_for_lower_bound(value);

    if (this.data_keys[found_key] == value) return found_key;

    if (this.is_leaf_node()) return null;

    // in b+ tree internal nodes, we need to make sure to go to the
    return this.children[found_key];
  }

  /**
   * @returns the left index of the input value
   */
  search_data_keys_for_lower_bound(search_input: number): number {
    if (this.tree.config.search_mode === "linear") {
      let index = this.data_keys.findIndex((k) => search_input <= k);

      if (index === -1) return this.data_keys.length;
      return index;
    }

    return lower_bound_search(this.data_keys, search_input);
  }

  insert_top_down(value: number) {
    let index = this.search_data_keys_for_lower_bound(value);
    if (index === -1) index = this.data_keys.length;

    // unique keys
    if (this.data_keys[index] === value) return;

    if (this.children.length === 0) {
      // inserts at index
      this.data_keys.splice(index, 0, value);
      return;
    }

    if (this.children[index].is_full()) {
      const { median, right } = this.children[index].split();

      this.data_keys.splice(index, 0, median);
      this.children.splice(index + 1, 0, right);

      if (value === median) return;

      if (value > median) {
        this.children[index + 1].insert_top_down(value);

        return;
      }
    }

    this.children[index].insert_top_down(value);
  }

  is_leaf_node(): boolean {
    return this.children.length === 0;
  }

  insert_bottom_up(value: number): Split | null {
    let index = this.search_data_keys_for_lower_bound(value);
    if (index === -1) index = this.data_keys.length;

    // unique keys
    if (this.data_keys[index] === value) return null;

    let is_leaf_node = this.is_leaf_node();

    if (is_leaf_node) {
      // inserts at index
      this.data_keys.splice(index, 0, value);
    } else {
      const maybe_split = this.children[index].insert_bottom_up(value);

      if (maybe_split) {
        this.data_keys.splice(index, 0, maybe_split.median);
        this.children.splice(index + 1, 0, maybe_split.right);
      }
    }

    return this.is_overflow() ? this.split() : null;
  }

  split(): Split {
    let median_index = Math.floor(this.data_keys.length / 2);

    // build the right node

    const is_leaf = this.children.length === 0;
    const is_bplus_leaf = !this.tree.config.inner_nodes_have_data && is_leaf;

    let right: TreeNode;

    if (is_bplus_leaf) {
      // B+ leaf: right keeps the median; a copy goes up as the separator
      right = new TreeNode(this.tree, ...this.data_keys.slice(median_index));
    } else {
      // B-tree node, or B+ internal node: the median moves up, so it's
      // left out of both halves
      right = new TreeNode(
        this.tree,
        ...this.data_keys.slice(median_index + 1),
      );
    }

    right.children = this.children.slice(median_index + 1);

    // get the median

    const median = this.data_keys[median_index];

    // turn this into the left
    this.data_keys = this.data_keys.slice(0, median_index);
    this.children = this.children.slice(0, median_index + 1);

    return {
      median,
      right,
    };
  }
}

export class Tree {
  constructor(config: TreeConfig) {
    this.config = config;
  }

  root_node: TreeNode | undefined = undefined;
  config: TreeConfig;

  populate(starting_values: number[]) {
    this.root_node = undefined;

    for (const value of starting_values) {
      if (this.root_node === undefined) {
        this.root_node = new TreeNode(this, value);

        // events.push({
        //   t: "assign_root",
        //   value,
        // });
      }
    }
  }

  insert(value: number) {
    if (!this.root_node) {
      this.root_node = new TreeNode(this, value);
      return;
    }

    if (this.config.insert_mode === "top_down") {
      // preemptive split if already full
      if (this.root_node.is_full()) {
        this.grow_root(this.root_node.split());
      }
      this.root_node.insert_top_down(value);
      return;
    }

    const split = this.root_node.insert_bottom_up(value);
    if (split) {
      this.grow_root(split);
    }
  }

  private grow_root({ median, right }: Split) {
    const new_root = new TreeNode(this, median);
    new_root.children = [this.root_node!, right];
    this.root_node = new_root;
  }

  search(value: number): SearchResult {
    const search_path: TreeNode[] = [];

    if (!this.root_node)
      return {
        type: "Missing",
        path: [],
        result: null,
      };

    search_path.push(this.root_node);

    while (true) {
      const result = search_path[-1].search_for_value(value);

      if (typeof result === "number") {
        return {
          type: "Success",
          path: search_path,
          result,
        };
      }

      if (result === null) {
        return {
          type: "Missing",
          path: [],
          result: null,
        };
      }

      // must be a child tree node
      search_path.push(result);
    }
  }
}

type SearchResult =
  | { type: "Success"; path: TreeNode[]; result: number }
  | { type: "Missing"; path: TreeNode[]; result: null };
