import {
  AnimationIDGenerator,
  type AnimationID,
} from "../animation/id_generator";
import { lower_bound_binary_search } from "./bounds_searching";
import type { TreeConfig } from "./config";
import type { BTreeEvent, BTreeEventRecorder, SplitKind } from "./events";

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

type NodeSearchOutcome =
  | { t: "node"; child_index: number; value: AnimationID }
  | { t: "data"; data_index: number; value: Key }
  | null;

export type SearchResult =
  | { type: "Success"; path: AnimationID[]; result: number }
  | { type: "Missing"; path: AnimationID[]; result: null };

// Only these events bump the version counter; read events share the cached
// snapshot (so a search emits many events for one clone).
const MUTATION_EVENTS = new Set<BTreeEvent["t"]>([
  "insert_key",
  "split",
  "grow_root",
  "delete_key",
]);

export class Tree {
  config: TreeConfig;
  event_recorder: BTreeEventRecorder;
  ids: AnimationIDGenerator = new AnimationIDGenerator();
  data: TreeData = { root: null, nodes: {} };

  // Version is bumped by every mutation event we record. `snapshot()` reuses
  // the cached clone whenever the version is unchanged, so a run of read
  // events reuses one clone and a run of mutations clones one per event.
  // yay for garbage collection lol
  private version = 0;
  private cached_version = -1;
  private cached_snapshot: Snapshot | undefined;

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
    if (this.cached_version === this.version && this.cached_snapshot) {
      return this.cached_snapshot;
    }
    this.cached_snapshot = structuredClone(this.data);
    this.cached_version = this.version;
    return this.cached_snapshot;
  }

  private record(event: BTreeEvent) {
    if (MUTATION_EVENTS.has(event.t)) this.version++;
    this.event_recorder.record(event, () => this.snapshot());
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

  private is_node_bplus_internal(node: NodeData): boolean {
    return !this.config.inner_nodes_have_data && node.children.length > 0;
  }

  private holds_key(node: NodeData, index: number, value: number): boolean {
    const k = node.data_keys[index];

    if (!k || k.value !== value) return false;

    return !this.is_node_bplus_internal(node);
  }

  private child_index_for(
    node: NodeData,
    index: number,
    value: number,
  ): number {
    if (index >= node.data_keys.length) return index;

    const key_at = node.data_keys[index].value;

    if (value > key_at) return index + 1;
    if (value === key_at && this.is_node_bplus_internal(node)) return index + 1;

    return index;
  }

  // Both search modes share one `compare`-recording callback so the event
  // stream has exactly one emission site.
  private find_position(id: AnimationID, value: number): number {
    const n = this.node(id);

    const probe = (mid: number, lo: number, hi: number) =>
      this.record({
        t: "compare",
        lo,
        hi,
        key_id: n.data_keys[mid].id,
        node: id,
      });

    if (this.config.search_mode === "linear") {
      for (let i = 0; i < n.data_keys.length; i++) {
        probe(i, i, n.data_keys.length);

        if (value <= n.data_keys[i].value) return i;
      }
      return n.data_keys.length;
    }

    return lower_bound_binary_search(n.data_keys, value, probe);
  }

  private insert_into_leaf(leaf_id: AnimationID, index: number, value: number) {
    const key: Key = { value, id: this.ids.allocate_id() };
    this.node(leaf_id).data_keys.splice(index, 0, key);
    this.record({ t: "insert_key", node: leaf_id, key: key.id, index });
  }

  // Parent-side half of a child split. The median goes between the original
  // left child and its new right half, so `descent` (not the pre-descent
  // lookup index) is the correct splice position.
  private absorb_split(parent_id: AnimationID, descent: number, split: Split) {
    const p = this.node(parent_id);
    p.data_keys.splice(descent, 0, split.median);
    p.children.splice(descent + 1, 0, split.right);
    this.record({
      t: "insert_key",
      node: parent_id,
      key: split.median.id,
      index: descent,
    });
  }

  insert(value: number) {
    this.record({ t: "insert_start", value });

    if (this.data.root == null) {
      const new_root = this.new_node();

      this.data.root = new_root.id;
      this.record({ t: "grow_root", old_root: null, new_root: new_root.id });
      this.insert_into_leaf(new_root.id, 0, value);

      return;
    }

    if (this.config.insert_mode === "top_down") {
      // Pre-split so recursion never has to bubble a split back up.
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
    const old_root = this.data.root;
    const new_root = this.new_node([median], [this.data.root!, right]);
    this.data.root = new_root.id;
    this.record({ t: "grow_root", old_root, new_root: new_root.id });
  }

  insert_top_down(id: AnimationID, value: number) {
    const index = this.find_position(id, value);
    if (this.holds_key(this.node(id), index, value)) return;

    if (this.is_leaf(id)) return this.insert_into_leaf(id, index, value);

    // Pre-split a full child; after absorbing, re-check for an exact match
    // at the just-inserted median before descending.
    if (this.is_full(this.node(id).children[index])) {
      this.absorb_split(id, index, this.split(this.node(id).children[index]));
      if (this.holds_key(this.node(id), index, value)) return;
    }

    const descent = this.child_index_for(this.node(id), index, value);
    this.insert_top_down(this.node(id).children[descent], value);
  }

  insert_bottom_up(id: AnimationID, value: number): Split | null {
    const index = this.find_position(id, value);
    if (this.holds_key(this.node(id), index, value)) return null;

    if (this.is_leaf(id)) {
      this.insert_into_leaf(id, index, value);
    } else {
      const descent = this.child_index_for(this.node(id), index, value);
      const split = this.insert_bottom_up(
        this.node(id).children[descent],
        value,
      );
      if (split) this.absorb_split(id, descent, split);
    }
    return this.is_overflow(id) ? this.split(id) : null;
  }

  split(id: AnimationID): Split {
    const n = this.node(id);

    const median_index = Math.floor(n.data_keys.length / 2);

    const bplus_leaf = !this.config.inner_nodes_have_data && this.is_leaf(id);

    const kind: SplitKind = bplus_leaf
      ? "bplus_leaf"
      : this.is_node_bplus_internal(n)
        ? "bplus_internal"
        : "btree";

    let right: NodeData;
    let median = n.data_keys[median_index];
    let copy_id: AnimationID | undefined;

    if (bplus_leaf) {
      // B+ leaf: right keeps the median; a fresh copy goes up as separator.
      right = this.new_node(n.data_keys.slice(median_index));

      // we consider a split to move the median from the leaf but then create
      // a new instance of the median (shown by allocating a new id) and
      // moving it to the right node
      median = { value: median.value, id: this.ids.allocate_id() };
      copy_id = median.id;
    } else {
      right = this.new_node(n.data_keys.slice(median_index + 1));
    }

    right.children = n.children.slice(median_index + 1);
    n.data_keys = n.data_keys.slice(0, median_index);
    n.children = n.children.slice(0, median_index + 1);

    this.record({
      t: "split",
      node: id,
      right: right.id,
      median: median.id,
      copy: copy_id,
      kind,
    });

    return { median, right: right.id };
  }

  search_in_node(id: AnimationID, value: number): NodeSearchOutcome {
    this.record({ t: "visit", node: id });

    const index = this.find_position(id, value);
    if (this.holds_key(this.node(id), index, value)) {
      return {
        t: "data",
        data_index: index,
        value: this.node(id).data_keys[index],
      };
    }

    if (this.is_leaf(id)) return null;

    const descent = this.child_index_for(this.node(id), index, value);
    return {
      t: "node",
      child_index: descent,
      value: this.node(id).children[descent],
    };
  }

  search(value: number): SearchResult {
    if (this.data.root == null) throw new Error("Can't search a empty tree");

    const search_path: AnimationID[] = [this.data.root];

    while (true) {
      const current = search_path.at(-1)!;
      const outcome = this.search_in_node(current, value);

      if (outcome === null) {
        this.record({ t: "not_found", node: current });
        return { type: "Missing", path: search_path, result: null };
      }

      if (outcome.t === "node") {
        this.record({
          t: "descend",
          from: current,
          to: outcome.value,
          slot: outcome.child_index,
        });
        search_path.push(outcome.value);
        continue;
      }

      this.record({
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
  }
}
