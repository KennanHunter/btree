import {
  AnimationIDGenerator,
  type AnimationID,
} from "../animation/id_generator";
import { lower_bound_binary_search } from "./bounds_searching";
import type { TreeConfig } from "./config";
import type { BTreeEvent, BTreeEventRecorder, BTreeOperation } from "./events";

export type Key = { id: AnimationID; value: number };

export type Split = {
  median: Key;
  right: TreeNode;
};

export class TreeNode {
  tree: Tree;
  data_keys: Key[] = [];
  children: TreeNode[] = [];
  node_animation_id: AnimationID;

  constructor(tree: Tree) {
    this.tree = tree;
    this.node_animation_id = this.generate_animation_id();
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
  search_for_value(
    value: number,
  ):
    | { t: "node"; child_index: number; value: TreeNode }
    | { t: "data"; data_index: number; value: Key }
    | null {
    this.record({
      t: "visit",
      node: this.node_animation_id,
    });

    let found_key = this.search_data_keys_for_lower_bound(value);

    if (this.data_keys[found_key]?.value == value)
      return {
        t: "data",
        data_index: found_key,
        value: this.data_keys[found_key],
      };

    if (this.is_leaf_node()) return null;

    // in b+ tree internal nodes, we need to make sure to go to the right one
    const is_bplus_leaf =
      !this.tree.config.inner_nodes_have_data && this.is_leaf_node();

    if (is_bplus_leaf) {
      return {
        t: "node",
        child_index: found_key + 1,
        value: this.children[found_key + 1],
      };
    }

    return {
      t: "node",
      child_index: found_key,
      value: this.children[found_key],
    };
  }

  /**
   * @returns the left index of the input value
   */
  search_data_keys_for_lower_bound(search_input: number): number {
    if (this.tree.config.search_mode === "linear") {
      for (let i = 0; i < this.data_keys.length; i++) {
        this.record({
          t: "compare",
          lo: i,
          hi: this.data_keys.length,
          key_id: this.data_keys[i].id,
          node: this.node_animation_id,
        });

        if (search_input <= this.data_keys[i].value) {
          return i;
        }
      }

      return this.data_keys.length;
    }

    return lower_bound_binary_search(
      this.data_keys,
      search_input,
      (mid, lo, hi) => {
        this.record({
          t: "compare",
          lo,
          hi,
          key_id: this.data_keys[mid].id,
          node: this.node_animation_id,
        });
      },
    );
  }

  insert_top_down(value: number) {
    let index = this.search_data_keys_for_lower_bound(value);

    // unique keys
    if (this.data_keys[index]?.value === value) return;

    if (this.children.length === 0) {
      // inserts at index
      this.data_keys.splice(index, 0, {
        value,
        id: this.generate_animation_id(),
      });
      return;
    }

    if (this.children[index].is_full()) {
      const { median, right } = this.children[index].split();

      this.data_keys.splice(index, 0, median);
      this.children.splice(index + 1, 0, right);

      if (value === median.value) return;

      if (value > median.value) {
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

    // unique keys
    if (this.data_keys[index]?.value === value) return null;

    let is_leaf_node = this.is_leaf_node();

    if (is_leaf_node) {
      // inserts at index
      this.data_keys.splice(index, 0, {
        value,
        id: this.generate_animation_id(),
      });
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

    const is_bplus_leaf =
      !this.tree.config.inner_nodes_have_data && this.is_leaf_node();

    let right: TreeNode;

    let median = this.data_keys[median_index];

    if (is_bplus_leaf) {
      // B+ leaf: right keeps the median; a copy goes up as the separator
      right = new TreeNode(this.tree);
      right.data_keys = this.data_keys.slice(median_index);

      // since we want to differentiate the copy that goes up as the seperator, we need a new animation id
      median = {
        value: median.value,
        id: this.generate_animation_id(),
      };
    } else {
      // B-tree node, or B+ internal node: the median moves up, so it's
      // left out of both halves
      right = new TreeNode(this.tree);
      right.data_keys = this.data_keys.slice(median_index + 1);
    }

    right.children = this.children.slice(median_index + 1);

    // get the median

    // turn this current node into the left
    this.data_keys = this.data_keys.slice(0, median_index);
    this.children = this.children.slice(0, median_index + 1);

    return {
      median,
      right,
    };
  }

  generate_animation_id(): AnimationID {
    return this.tree.animation_id_generator.allocate_id();
  }

  record(event: BTreeEvent) {
    this.tree.event_recorder.record(event);
  }
}

export class Tree {
  constructor(config: TreeConfig, event_recorder: BTreeEventRecorder) {
    this.config = config;
    this.event_recorder = event_recorder;
  }

  config: TreeConfig;
  event_recorder: BTreeEventRecorder;

  root_node: TreeNode | undefined = undefined;
  animation_id_generator: AnimationIDGenerator = new AnimationIDGenerator();

  populate(starting_values: number[]) {
    this.root_node = undefined;

    for (const value of starting_values) {
      this.insert(value);
    }
  }

  insert(value: number) {
    if (!this.root_node) {
      this.root_node = new TreeNode(this);
      this.root_node.data_keys = [
        { value, id: this.animation_id_generator.allocate_id() },
      ];
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
    const new_root = new TreeNode(this);

    new_root.data_keys = [median];

    new_root.children = [this.root_node!, right];
    this.root_node = new_root;
  }

  search(value: number): { result: SearchResult; operation: BTreeOperation } {
    this.event_recorder.clear();

    const search_path: TreeNode[] = [];

    if (!this.root_node) throw new Error("Can't search a empty tree");

    search_path.push(this.root_node);

    let result = ((): SearchResult => {
      while (true) {
        const node = search_path.at(-1)!;
        const outcome = node.search_for_value(value);

        if (outcome === null) {
          this.event_recorder.record({
            t: "not_found",
            node: node.node_animation_id,
          });

          return {
            type: "Missing",
            path: search_path,
            result: null,
          };
        }

        if (outcome.t === "node") {
          this.event_recorder.record({
            t: "descend",
            from: node.node_animation_id,
            to: outcome.value.node_animation_id,
            slot: outcome.child_index,
          });

          search_path.push(outcome.value);
          continue;
        }

        this.event_recorder.record({
          t: "found",
          node: node.node_animation_id,
          key: outcome.value.id,
        });

        return {
          type: "Success",
          path: search_path,
          result: outcome.value.value,
        };
      }
    })();

    let operation = this.event_recorder.rollup_operation("search");

    return { result, operation };
  }
}

type SearchResult =
  | { type: "Success"; path: TreeNode[]; result: number }
  | { type: "Missing"; path: TreeNode[]; result: null };
