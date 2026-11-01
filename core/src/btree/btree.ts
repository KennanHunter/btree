import {
  AnimationIDGenerator,
  type AnimationID,
} from "../animation/id_generator";
import { lower_bound_binary_search } from "./bounds_searching";
import type { TreeConfig } from "./config";
import type { BTreeEventRecorder, BTreeOperation } from "./events";

// https://developer.mozilla.org/en-US/docs/Web/API/Window/structuredClone
declare function structuredClone<T>(value: T): T;

export type Key = { id: AnimationID; value: number };

export type NodeData = {
  id: AnimationID;
  data_keys: Key[];
  children: AnimationID[];
};

export type TreeData = {
  root: AnimationID | null;
  nodes: Record<AnimationID, NodeData>;
};

export type DeepReadonly<T> = T extends (infer U)[]
  ? ReadonlyArray<DeepReadonly<U>>
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

export type Snapshot = DeepReadonly<TreeData>;

export type Split = {
  median: Key;
  right: AnimationID;
};

type SearchOutcome =
  | { t: "node"; child_index: number; value: AnimationID }
  | { t: "data"; data_index: number; value: Key }
  | null;

type SearchResult =
  | { type: "Success"; path: AnimationID[]; result: number }
  | { type: "Missing"; path: AnimationID[]; result: null };

export class Tree {
  config: TreeConfig;
  event_recorder: BTreeEventRecorder;
  ids: AnimationIDGenerator = new AnimationIDGenerator();
  data: TreeData = { root: null, nodes: {} };

  constructor(config: TreeConfig, event_recorder: BTreeEventRecorder) {
    this.config = config;
    this.event_recorder = event_recorder;
  }

  node(id: AnimationID): NodeData {
    return this.data.nodes[id];
  }

  root_node(): NodeData | undefined {
    return this.data.root == null ? undefined : this.data.nodes[this.data.root];
  }

  snapshot(): Snapshot {
    return structuredClone(this.data);
  }

  new_node(data_keys: Key[] = [], children: AnimationID[] = []): NodeData {
    const n: NodeData = {
      id: this.ids.allocate_id(),
      data_keys,
      children,
    };
    this.data.nodes[n.id] = n;
    return n;
  }

  is_full(id: AnimationID): boolean {
    return this.node(id).data_keys.length + 1 === this.config.fanout;
  }

  is_overflow(id: AnimationID): boolean {
    return this.node(id).data_keys.length + 1 > this.config.fanout;
  }

  is_leaf(id: AnimationID): boolean {
    return this.node(id).children.length === 0;
  }

  populate(starting_values: number[]) {
    this.data = { root: null, nodes: {} };
    for (const value of starting_values) {
      this.insert(value);
    }
  }

  insert(value: number) {
    if (this.data.root == null) {
      const n = this.new_node([{ value, id: this.ids.allocate_id() }]);
      this.data.root = n.id;
      return;
    }

    if (this.config.insert_mode === "top_down") {
      // with top down we split before we insert,
      // this prevents cascading to the root node
      if (this.is_full(this.data.root)) {
        this.grow_root(this.split(this.data.root));
      }
      this.insert_top_down(this.data.root, value);
      return;
    }

    const split = this.insert_bottom_up(this.data.root, value);
    if (split) this.grow_root(split);
  }

  private grow_root({ median, right }: Split) {
    const new_root = this.new_node([median], [this.data.root!, right]);
    this.data.root = new_root.id;
  }

  insert_top_down(id: AnimationID, value: number) {
    const n = this.node(id);
    const index = this.search_lower_bound(id, value);

    if (n.data_keys[index]?.value === value) return;

    if (n.children.length === 0) {
      n.data_keys.splice(index, 0, {
        value,
        id: this.ids.allocate_id(),
      });
      return;
    }

    if (this.is_full(n.children[index])) {
      const { median, right } = this.split(n.children[index]);

      n.data_keys.splice(index, 0, median);
      n.children.splice(index + 1, 0, right);

      if (value === median.value) return;

      if (value > median.value) {
        this.insert_top_down(n.children[index + 1], value);
        return;
      }
    }

    this.insert_top_down(n.children[index], value);
  }

  insert_bottom_up(id: AnimationID, value: number): Split | null {
    const n = this.node(id);
    const index = this.search_lower_bound(id, value);

    if (n.data_keys[index]?.value === value) return null;

    if (this.is_leaf(id)) {
      n.data_keys.splice(index, 0, {
        value,
        id: this.ids.allocate_id(),
      });
    } else {
      const maybe_split = this.insert_bottom_up(n.children[index], value);
      if (maybe_split) {
        n.data_keys.splice(index, 0, maybe_split.median);
        n.children.splice(index + 1, 0, maybe_split.right);
      }
    }

    return this.is_overflow(id) ? this.split(id) : null;
  }

  split(id: AnimationID): Split {
    const n = this.node(id);
    const median_index = Math.floor(n.data_keys.length / 2);

    const is_bplus_leaf =
      !this.config.inner_nodes_have_data && this.is_leaf(id);

    let right: NodeData;
    let median = n.data_keys[median_index];

    if (is_bplus_leaf) {
      // B+ leaf: right keeps the median; a copy goes up as the separator
      right = this.new_node(n.data_keys.slice(median_index));
      median = { value: median.value, id: this.ids.allocate_id() };
    } else {
      // B-tree node, or B+ internal node: the median moves up
      right = this.new_node(n.data_keys.slice(median_index + 1));
    }

    right.children = n.children.slice(median_index + 1);

    n.data_keys = n.data_keys.slice(0, median_index);
    n.children = n.children.slice(0, median_index + 1);

    return { median, right: right.id };
  }

  search_lower_bound(id: AnimationID, value: number): number {
    const n = this.node(id);

    if (this.config.search_mode === "linear") {
      for (let i = 0; i < n.data_keys.length; i++) {
        this.event_recorder.record({
          t: "compare",
          lo: i,
          hi: n.data_keys.length,
          key_id: n.data_keys[i].id,
          node: id,
        });

        if (value <= n.data_keys[i].value) return i;
      }
      return n.data_keys.length;
    }

    return lower_bound_binary_search(n.data_keys, value, (mid, lo, hi) => {
      this.event_recorder.record({
        t: "compare",
        lo,
        hi,
        key_id: n.data_keys[mid].id,
        node: id,
      });
    });
  }

  search_in_node(id: AnimationID, value: number): SearchOutcome {
    const n = this.node(id);

    this.event_recorder.record({ t: "visit", node: id });

    const found_key = this.search_lower_bound(id, value);

    if (n.data_keys[found_key]?.value === value) {
      return {
        t: "data",
        data_index: found_key,
        value: n.data_keys[found_key],
      };
    }

    if (this.is_leaf(id)) return null;

    const is_bplus_leaf =
      !this.config.inner_nodes_have_data && this.is_leaf(id);

    if (is_bplus_leaf) {
      return {
        t: "node",
        child_index: found_key + 1,
        value: n.children[found_key + 1],
      };
    }

    return {
      t: "node",
      child_index: found_key,
      value: n.children[found_key],
    };
  }

  search(value: number): { result: SearchResult; operation: BTreeOperation } {
    this.event_recorder.clear();

    if (this.data.root == null) throw new Error("Can't search a empty tree");

    const search_path: AnimationID[] = [this.data.root];

    const result = ((): SearchResult => {
      while (true) {
        const current = search_path.at(-1)!;
        const outcome = this.search_in_node(current, value);

        if (outcome === null) {
          this.event_recorder.record({ t: "not_found", node: current });
          return { type: "Missing", path: search_path, result: null };
        }

        if (outcome.t === "node") {
          this.event_recorder.record({
            t: "descend",
            from: current,
            to: outcome.value,
            slot: outcome.child_index,
          });
          search_path.push(outcome.value);
          continue;
        }

        this.event_recorder.record({
          t: "found",
          node: current,
          key: outcome.value.id,
        });
        return {
          type: "Success",
          path: search_path,
          result: outcome.value.value,
        };
      }
    })();

    const operation = this.event_recorder.rollup_operation(
      "search",
      this.snapshot(),
    );

    return { result, operation };
  }
}
