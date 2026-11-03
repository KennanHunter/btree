import {
  AnimationIDGenerator,
  type AnimationID,
} from "../animation/id_generator";
import { lower_bound_binary_search } from "./bounds_searching";
import type { TreeConfig } from "./config";
import type { BTreeEvent, BTreeEventRecorder, SplitKind } from "./events";

// https://developer.mozilla.org/en-US/docs/Web/API/Window/structuredClone
declare function structuredClone<T>(value: T): T;

const NO_SNAPSHOT = (): never => {
  throw new Error("recorder opted out of snapshots via needs_snapshot: false");
};

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
  src: AnimationID;
  median: Key;
  right: AnimationID;
  kind: SplitKind;
  copy?: AnimationID;
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
// Events that bump the snapshot-cache version. These are the "first event
// after a mutation" markers — the version bump forces `snapshot()` to clone
// fresh. The other split sub-events share that one clone because the tree
// doesn't mutate again between them.
const MUTATION_EVENTS = new Set<BTreeEvent["t"]>([
  "insert_merge",
  // split_slide_apart is the first event emitted after `split()` mutates
  // the tree; it owns the post-split clone. The three subsequent split
  // events reuse that cache (no further tree mutation between them).
  "split_slide_apart",
  "grow_root",
  "delete_key",
] as const);

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
    if (this.event_recorder.needs_snapshot === false) {
      this.event_recorder.record(event, NO_SNAPSHOT);
    } else {
      this.event_recorder.record(event, () => this.snapshot());
    }
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
      this.insert({ value, id: this.ids.allocate_id() });
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

  private insert_into_leaf(leaf_id: AnimationID, index: number, key: Key) {
    this.record({ t: "insert_widen", node: leaf_id, key: key.id, index });

    this.node(leaf_id).data_keys.splice(index, 0, key);

    this.record({ t: "insert_merge", node: leaf_id, key: key.id, index });
  }

  // Parent-side half of a child split. The median goes between the original
  // left child and its new right half, so `descent` (not the pre-descent
  // lookup index) is the correct splice position.
  //
  // Event order matters: the raw `split()` call only mutated the leaves and
  // left `right` orphaned (not reachable from the root), so recording the
  // split event there would hand the UI an inconsistent snapshot. We wait
  // until the parent has absorbed the median and connected `right`, then
  // emit `split_connect_to_children` so the first snapshot the UI sees of
  // the split is a fully-connected tree. The follow-up `insert_merge` keeps
  // the parent-side "median landed" visual.
  // Emit the three-phase split event stream once the split is fully
  // connected. Each event carries identical payload — the choreographer
  // uses `t` to drive distinct keyframes. Non-mutating events share the
  // cached snapshot, so this is three events for essentially one clone.
  private record_split_phases(split: Split) {
    const payload = {
      node: split.src,
      right: split.right,
      median: split.median.id,
      copy: split.copy,
      kind: split.kind,
    } as const;
    // Order: slide_apart → pull_median → parent_grows → connect. The two
    // halves emerge and separate first (parent still at pre-split width);
    // then the median is pulled out between them; then the parent widens to
    // absorb the median; finally the edges snap in.
    this.record({ t: "split_slide_apart", ...payload });
    this.record({ t: "split_pull_median", ...payload });
    this.record({ t: "split_parent_grows", ...payload });
    this.record({ t: "split_connect_to_children", ...payload });
  }

  private absorb_split(parent_id: AnimationID, descent: number, split: Split) {
    const p = this.node(parent_id);
    p.data_keys.splice(descent, 0, split.median);
    p.children.splice(descent + 1, 0, split.right);
    this.record_split_phases(split);
    this.record({
      t: "insert_merge",
      node: parent_id,
      key: split.median.id,
      index: descent,
    });
  }

  insert(value: Key) {
    if (this.data.root == null) {
      // Empty-tree fast path: no probe animation, no widen/merge dance —
      // just stand the root up with the key already in it.
      const new_root = this.new_node([value]);
      this.data.root = new_root.id;
      this.record({ t: "grow_root", old_root: null, new_root: new_root.id });
      return;
    }

    if (this.config.insert_mode === "top_down") {
      // Pre-split so recursion never has to bubble a split back up.
      if (this.is_full(this.data.root)) {
        this.record({ t: "insert_node_overfill", node: this.data.root });
        this.grow_root(this.split(this.data.root));
      }
      this.insert_top_down(this.data.root, value);
      return;
    }

    const split = this.insert_bottom_up(this.data.root, value);
    if (split) this.grow_root(split);
  }

  // Grow a new root above the split: the median becomes the only key in
  // the new root, and left (old root) + right become its two children.
  // Same ordering trick as `absorb_split`: emit `split_connect_to_children`
  // first (now that `right` is reachable), then `grow_root`.
  private grow_root(split: Split) {
    const old_root = this.data.root;
    const new_root = this.new_node(
      [split.median],
      [this.data.root!, split.right],
    );
    this.data.root = new_root.id;
    this.record_split_phases(split);
    this.record({ t: "grow_root", old_root, new_root: new_root.id });
  }

  insert_top_down(id: AnimationID, key: Key) {
    this.record({ t: "visit_insert", node_id: id, value_id: key.id });

    const index = this.find_position(id, key.value);
    if (this.holds_key(this.node(id), index, key.value)) return;

    if (this.is_leaf(id)) return this.insert_into_leaf(id, index, key);

    // Pre-split a full child; after absorbing, re-check for an exact match
    // at the just-inserted median before descending.
    if (this.is_full(this.node(id).children[index])) {
      const child_id = this.node(id).children[index];
      this.record({ t: "insert_node_overfill", node: child_id });
      this.absorb_split(id, index, this.split(child_id));
      if (this.holds_key(this.node(id), index, key.value)) return;
    }

    const descent = this.child_index_for(this.node(id), index, key.value);
    const child = this.node(id).children[descent];
    this.record({
      t: "select_descent_child",
      from: id,
      to: child,
      slot: descent,
    });
    this.record({ t: "descend", from: id, to: child, slot: descent });
    this.insert_top_down(child, key);
  }

  insert_bottom_up(id: AnimationID, key: Key): Split | null {
    this.record({ t: "visit_insert", node_id: id, value_id: key.id });

    const index = this.find_position(id, key.value);
    if (this.holds_key(this.node(id), index, key.value)) return null;

    if (this.is_leaf(id)) {
      this.insert_into_leaf(id, index, key);
    } else {
      const descent = this.child_index_for(this.node(id), index, key.value);
      const child = this.node(id).children[descent];
      this.record({
        t: "select_descent_child",
        from: id,
        to: child,
        slot: descent,
      });
      this.record({ t: "descend", from: id, to: child, slot: descent });
      const split = this.insert_bottom_up(child, key);
      if (split) this.absorb_split(id, descent, split);
    }
    if (!this.is_overflow(id)) return null;
    // UI beat: flash the overfull node red before the structural split
    // kicks in. Non-mutation event — reuses the current snapshot clone.
    this.record({ t: "insert_node_overfill", node: id });
    return this.split(id);
  }

  // Split a full node into (left-keeps-id, right-new) and lift a median.
  //
  // Does NOT record anything — the caller (`absorb_split` or `grow_root`)
  // records `split_connect_to_children` once `right` has actually been
  // connected to the tree, so the snapshot captured at event time is
  // consistent.
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
      // B+ leaf: right keeps the median; a fresh copy with a NEW id goes up
      // as separator. The id change is what lets the UI animate the copy
      // as a distinct key arriving in the parent.
      right = this.new_node(n.data_keys.slice(median_index));
      median = { value: median.value, id: this.ids.allocate_id() };
      copy_id = median.id;
    } else {
      right = this.new_node(n.data_keys.slice(median_index + 1));
    }

    right.children = n.children.slice(median_index + 1);
    n.data_keys = n.data_keys.slice(0, median_index);
    n.children = n.children.slice(0, median_index + 1);

    return { src: id, median, right: right.id, kind, copy: copy_id };
  }

  search_in_node(id: AnimationID, value: number): NodeSearchOutcome {
    this.record({ t: "visit_read", node: id });

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
          t: "select_descent_child",
          from: current,
          to: outcome.value,
          slot: outcome.child_index,
        });
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
