// core/src/animation/id_generator.ts
var AnimationIDGenerator = class {
  count = 0;
  allocate_id() {
    return ++this.count;
  }
};

// core/src/btree/bounds_searching.ts
function lower_bound_binary_search(keys, value, on_probe) {
  let lo = 0;
  let hi = keys.length;
  while (lo < hi) {
    const mid = lo + Math.floor((hi - lo) / 2);
    on_probe?.(mid, lo, hi);
    if (keys[mid].value < value) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

// core/src/btree/btree.ts
var NO_SNAPSHOT = () => {
  throw new Error("recorder opted out of snapshots via needs_snapshot: false");
};
var MUTATION_EVENTS = /* @__PURE__ */ new Set([
  "insert_merge",
  // split_slide_apart is the first event emitted after `split()` mutates
  // the tree; it owns the post-split clone. The three subsequent split
  // events reuse that cache (no further tree mutation between them).
  "split_slide_apart",
  "grow_root",
  "delete_key"
]);
var Tree = class {
  config;
  event_recorder;
  ids = new AnimationIDGenerator();
  data = { root: null, nodes: {} };
  // Version is bumped by every mutation event we record. `snapshot()` reuses
  // the cached clone whenever the version is unchanged, so a run of read
  // events reuses one clone and a run of mutations clones one per event.
  // yay for garbage collection lol
  version = 0;
  cached_version = -1;
  cached_snapshot;
  constructor(config, event_recorder) {
    this.config = config;
    this.event_recorder = event_recorder;
  }
  node(id) {
    return this.data.nodes[id];
  }
  root_node() {
    return this.data.root == null ? void 0 : this.data.nodes[this.data.root];
  }
  snapshot() {
    if (this.cached_version === this.version && this.cached_snapshot) {
      return this.cached_snapshot;
    }
    this.cached_snapshot = structuredClone(this.data);
    this.cached_version = this.version;
    return this.cached_snapshot;
  }
  record(event) {
    if (MUTATION_EVENTS.has(event.t)) this.version++;
    if (this.event_recorder.needs_snapshot === false) {
      this.event_recorder.record(event, NO_SNAPSHOT);
    } else {
      this.event_recorder.record(event, () => this.snapshot());
    }
  }
  new_node(data_keys = [], children = []) {
    const n = {
      id: this.ids.allocate_id(),
      data_keys,
      children
    };
    this.data.nodes[n.id] = n;
    return n;
  }
  is_full(id) {
    return this.node(id).data_keys.length + 1 === this.config.fanout;
  }
  is_overflow(id) {
    return this.node(id).data_keys.length + 1 > this.config.fanout;
  }
  is_leaf(id) {
    return this.node(id).children.length === 0;
  }
  populate(starting_values) {
    this.data = { root: null, nodes: {} };
    for (const value of starting_values) {
      this.insert({ value, id: this.ids.allocate_id() });
    }
  }
  is_node_bplus_internal(node) {
    return !this.config.inner_nodes_have_data && node.children.length > 0;
  }
  holds_key(node, index, value) {
    const k = node.data_keys[index];
    if (!k || k.value !== value) return false;
    return !this.is_node_bplus_internal(node);
  }
  child_index_for(node, index, value) {
    if (index >= node.data_keys.length) return index;
    const key_at = node.data_keys[index].value;
    if (value > key_at) return index + 1;
    if (value === key_at && this.is_node_bplus_internal(node)) return index + 1;
    return index;
  }
  // Both search modes share one `compare`-recording callback so the event
  // stream has exactly one emission site.
  find_position(id, value) {
    const n = this.node(id);
    const probe = (mid, lo, hi) => this.record({
      t: "compare",
      lo,
      hi,
      key_id: n.data_keys[mid].id,
      node: id
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
  insert_into_leaf(leaf_id, index, key) {
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
  record_split_phases(split) {
    const payload = {
      node: split.src,
      right: split.right,
      median: split.median.id,
      copy: split.copy,
      kind: split.kind
    };
    this.record({ t: "split_slide_apart", ...payload });
    this.record({ t: "split_pull_median", ...payload });
    this.record({ t: "split_parent_grows", ...payload });
    this.record({ t: "split_connect_to_children", ...payload });
  }
  absorb_split(parent_id, descent, split) {
    const p = this.node(parent_id);
    p.data_keys.splice(descent, 0, split.median);
    p.children.splice(descent + 1, 0, split.right);
    this.record_split_phases(split);
    this.record({
      t: "insert_merge",
      node: parent_id,
      key: split.median.id,
      index: descent
    });
  }
  insert(value) {
    if (this.data.root == null) {
      const new_root = this.new_node([value]);
      this.data.root = new_root.id;
      this.record({ t: "grow_root", old_root: null, new_root: new_root.id });
      return;
    }
    if (this.config.insert_mode === "top_down") {
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
  grow_root(split) {
    const old_root = this.data.root;
    const new_root = this.new_node(
      [split.median],
      [this.data.root, split.right]
    );
    this.data.root = new_root.id;
    this.record_split_phases(split);
    this.record({ t: "grow_root", old_root, new_root: new_root.id });
  }
  insert_top_down(id, key) {
    this.record({ t: "visit_insert", node_id: id, value_id: key.id });
    const index = this.find_position(id, key.value);
    if (this.holds_key(this.node(id), index, key.value)) return;
    if (this.is_leaf(id)) return this.insert_into_leaf(id, index, key);
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
      slot: descent
    });
    this.record({ t: "descend", from: id, to: child, slot: descent });
    this.insert_top_down(child, key);
  }
  insert_bottom_up(id, key) {
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
        slot: descent
      });
      this.record({ t: "descend", from: id, to: child, slot: descent });
      const split = this.insert_bottom_up(child, key);
      if (split) this.absorb_split(id, descent, split);
    }
    if (!this.is_overflow(id)) return null;
    this.record({ t: "insert_node_overfill", node: id });
    return this.split(id);
  }
  // Split a full node into (left-keeps-id, right-new) and lift a median.
  //
  // Does NOT record anything — the caller (`absorb_split` or `grow_root`)
  // records `split_connect_to_children` once `right` has actually been
  // connected to the tree, so the snapshot captured at event time is
  // consistent.
  split(id) {
    const n = this.node(id);
    const median_index = Math.floor(n.data_keys.length / 2);
    const bplus_leaf = !this.config.inner_nodes_have_data && this.is_leaf(id);
    const kind = bplus_leaf ? "bplus_leaf" : this.is_node_bplus_internal(n) ? "bplus_internal" : "btree";
    let right;
    let median = n.data_keys[median_index];
    let copy_id;
    if (bplus_leaf) {
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
  search_in_node(id, value) {
    this.record({ t: "visit_read", node: id });
    const index = this.find_position(id, value);
    if (this.holds_key(this.node(id), index, value)) {
      return {
        t: "data",
        data_index: index,
        value: this.node(id).data_keys[index]
      };
    }
    if (this.is_leaf(id)) return null;
    const descent = this.child_index_for(this.node(id), index, value);
    return {
      t: "node",
      child_index: descent,
      value: this.node(id).children[descent]
    };
  }
  search(value) {
    if (this.data.root == null) throw new Error("Can't search a empty tree");
    const search_path = [this.data.root];
    while (true) {
      const current = search_path.at(-1);
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
          slot: outcome.child_index
        });
        this.record({
          t: "descend",
          from: current,
          to: outcome.value,
          slot: outcome.child_index
        });
        search_path.push(outcome.value);
        continue;
      }
      this.record({
        t: "found",
        node: current,
        key: outcome.value.id
      });
      return {
        type: "Success",
        path: search_path,
        result: outcome.value.value
      };
    }
  }
};

// core/src/btree/config.ts
function check_config_for_errors(config) {
  if (config.fanout < 2) {
    return {
      type: "FanoutTooLow",
      message: "B Tree requires a fanout of at least 2"
    };
  }
  if (config.insert_mode == "top_down" && config.fanout === 2) {
    return {
      type: "TopDownFanoutTwo",
      message: "Top Down with fanout=2 creates tons of empty nodes and crashes your browser"
    };
  }
  if (config.insert_mode == "top_down" && config.fanout % 2 === 1) {
    return {
      type: "TopDownOddFanout",
      message: "B Tree's using the top down method must have an even fanout >= 4"
    };
  }
  return true;
}
function check_config_for_warnings(config) {
  const warnings = [];
  if (config.insert_mode === "bottom_up" && config.fanout === 2) {
    warnings.push({
      type: "FanoutTwoBottomUp",
      message: "Fanout 2 is allowed here as an experiment, but it isn't really a valid B-tree. A non-root node needs at least ceil(fanout / 2) \u2212 1 keys, which is 0 at fanout 2, so splits leave empty nodes behind."
    });
  }
  return warnings;
}

// core/src/btree/index.ts
function create_b_tree(config, event_recorder) {
  const possible_config_error = check_config_for_errors(config);
  if (possible_config_error !== true) {
    return {
      error: true,
      ...possible_config_error
    };
  }
  return {
    error: false,
    tree: new Tree(config, event_recorder)
  };
}

// core/src/fill.ts
function range(start, end) {
  const out = [];
  for (let v = start; v <= end; v++) out.push(v);
  return out;
}
function shuffle(values) {
  for (let i = values.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [values[i], values[j]] = [values[j], values[i]];
  }
  return values;
}
function fill_tree_sequential(tree, start, end) {
  const values = range(start, end);
  for (const v of values) tree.insert({ value: v, id: tree.ids.allocate_id() });
  return values;
}
function fill_tree_random(tree, start, end) {
  const values = shuffle(range(start, end));
  for (const v of values) tree.insert({ value: v, id: tree.ids.allocate_id() });
  return values;
}
export {
  AnimationIDGenerator,
  Tree,
  check_config_for_errors,
  check_config_for_warnings,
  create_b_tree,
  fill_tree_random,
  fill_tree_sequential,
  range,
  shuffle
};
