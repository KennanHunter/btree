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

// component/src/build.ts
function recording_recorder() {
  let steps = [];
  return {
    record(event, snapshot) {
      steps.push({ event, snapshot: snapshot() });
    },
    clear() {
      steps = [];
    },
    rollup_operation(kind, final) {
      const op = { kind, steps, final };
      steps = [];
      return op;
    }
  };
}
function silent_recorder() {
  return {
    needs_snapshot: false,
    record() {
    },
    clear() {
    },
    rollup_operation(kind, final) {
      return { kind, steps: [], final };
    }
  };
}
function build_tree(config, init_values = []) {
  const result = create_b_tree(config, silent_recorder());
  if (result.error) {
    return { ok: false, error: result };
  }
  for (const v of init_values)
    result.tree.insert({ value: v, id: result.tree.ids.allocate_id() });
  result.tree.event_recorder = recording_recorder();
  return { ok: true, tree: result.tree };
}

// component/src/dispatch.ts
var NotImplementedError = class extends Error {
  constructor(what) {
    super(`${what} is not implemented yet`);
    this.name = "NotImplementedError";
  }
};
function dispatch(tree, req) {
  switch (req.kind) {
    case "search":
      return run(tree, req, (t) => t.search(req.value));
    case "insert":
      return run(tree, req, (t) => {
        const key = { value: req.value, id: t.ids.allocate_id() };
        t.insert(key);
        return { type: "Insert", value: req.value, key };
      });
    case "bulk_insert":
      return run(tree, req, (t) => {
        const keys = req.values.map((v) => ({
          value: v,
          id: t.ids.allocate_id()
        }));
        for (const k of keys) t.insert(k);
        return { type: "BulkInsert", values: req.values, keys };
      });
    case "delete":
      throw new NotImplementedError("delete");
    case "range_search":
      throw new NotImplementedError("range_search");
  }
}
function run(tree, req, mutate) {
  tree.event_recorder.clear();
  const result = mutate(tree);
  const op = tree.event_recorder.rollup_operation(req.kind, tree.snapshot());
  return { ...op, request: req, result };
}

// component/src/fit.ts
function fit_to_viewport(i) {
  const pad = i.padding ?? 0;
  const sx = (i.viewW - pad) / Math.max(1, i.contentW);
  const sy = (i.viewH - pad) / Math.max(1, i.contentH);
  const scale = Math.min(sx, sy, i.maxScale ?? 1);
  return {
    scale,
    panX: (i.viewW - i.contentW * scale) / 2,
    panY: (i.viewH - i.contentH * scale) / 2
  };
}

// component/src/highlight.ts
function empty_highlight() {
  return {
    nodes: /* @__PURE__ */ new Set(),
    keys: /* @__PURE__ */ new Set(),
    edges: /* @__PURE__ */ new Set(),
    slots: /* @__PURE__ */ new Set(),
    alarm_nodes: /* @__PURE__ */ new Set()
  };
}
function highlight_from(event) {
  const h = empty_highlight();
  if (!event) return h;
  switch (event.t) {
    case "visit_read":
    case "not_found":
      h.nodes.add(event.node);
      return h;
    case "insert_node_overfill":
      h.nodes.add(event.node);
      h.alarm_nodes.add(event.node);
      return h;
    case "visit_insert":
      h.nodes.add(event.node_id);
      return h;
    case "found":
      h.nodes.add(event.node);
      h.keys.add(event.key);
      return h;
    case "compare":
      h.nodes.add(event.node);
      h.keys.add(event.key_id);
      return h;
    case "descend":
    case "ascend":
      h.nodes.add(event.from);
      h.nodes.add(event.to);
      h.edges.add(`${event.from}->${event.to}`);
      return h;
    case "select_descent_child":
      h.nodes.add(event.from);
      h.slots.add(`${event.from}:${event.slot}`);
      return h;
    case "insert_widen":
    case "insert_merge":
    case "insert_median_found":
    case "delete_key":
      h.nodes.add(event.node);
      h.keys.add(event.key);
      return h;
    case "split_pull_median":
    case "split_parent_grows":
    case "split_slide_apart":
    case "split_connect_to_children":
      h.nodes.add(event.node);
      h.nodes.add(event.right);
      h.keys.add(event.median);
      if (event.copy != null) h.keys.add(event.copy);
      h.anchor_key = event.median;
      return h;
    case "grow_root":
      if (event.old_root != null) h.nodes.add(event.old_root);
      h.nodes.add(event.new_root);
      return h;
    case "emit":
      h.nodes.add(event.node);
      h.keys.add(event.key);
      return h;
  }
}

// component/src/operation.ts
function describe_operation(op) {
  const r = op.request;
  switch (r.kind) {
    case "search":
      return `Searching for ${r.value}`;
    case "insert":
      return `Inserting ${r.value}`;
    case "bulk_insert":
      return `Bulk inserting ${r.values.length} values`;
    case "delete":
      return `Deleting ${r.value}`;
    case "range_search":
      return `Range search [${r.lo}, ${r.hi}]`;
  }
}
function step_count(op) {
  return op.steps.length;
}
function step_at(op, i) {
  return op.steps[i];
}

// component/src/view.tsx
import {
  createEffect,
  createMemo,
  createSignal as createSignal2,
  For,
  onCleanup,
  onMount,
  Show,
  untrack
} from "solid-js";

// component/src/player.ts
import { createSignal } from "solid-js";

// component/src/ease.ts
var easeInOutCubic = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
var easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

// component/src/scene.ts
function scene_from_snapshot(data) {
  const nodes = {};
  for (const nid in data.nodes) {
    const n = data.nodes[nid];
    nodes[nid] = {
      id: n.id,
      data_keys: [...n.data_keys],
      children: [...n.children]
    };
  }
  return { root: data.root, nodes };
}
function attach_probe_above(scene, node, probe) {
  return {
    ...scene,
    probe: {
      id: probe.id,
      value: probe.value,
      attachment: { kind: "above_node", node }
    }
  };
}
function with_eased_width(scene, id) {
  const s = new Set(scene.ease_node_widths ?? []);
  s.add(id);
  return { ...scene, ease_node_widths: s };
}
function reserve_slot(scene, node, index, probe) {
  const n = scene.nodes[node];
  if (!n) return scene;
  if (n.data_keys[index]?.id === probe.id) {
    return {
      ...scene,
      probe: {
        id: probe.id,
        value: probe.value,
        attachment: { kind: "in_slot", node, index }
      }
    };
  }
  const placeholder = { id: probe.id, value: probe.value };
  const copy = {
    ...n,
    data_keys: [...n.data_keys]
  };
  copy.data_keys.splice(index, 0, placeholder);
  return {
    ...scene,
    nodes: { ...scene.nodes, [node]: copy },
    probe: {
      id: probe.id,
      value: probe.value,
      attachment: { kind: "in_slot", node, index }
    }
  };
}
var PROBE_GAP = 10;
var EMPTY_POSE = {
  nodes: /* @__PURE__ */ new Map(),
  keys: /* @__PURE__ */ new Map(),
  slots: /* @__PURE__ */ new Map(),
  edges: /* @__PURE__ */ new Map(),
  width: 0,
  height: 0,
  min_x: 0,
  hidden: /* @__PURE__ */ new Set()
};
function measure(scene, id) {
  const n = scene.nodes[id];
  const has_children = n.children.length > 0;
  const render_leaf = scene.render_as_leaf?.has(id) ?? false;
  const cols = Math.max(
    n.data_keys.length,
    has_children ? n.children.length : 0,
    1
  );
  const node_w = cols * CELL_W;
  const node_h = has_children && !render_leaf ? 2 * CELL_H : CELL_H;
  const children = n.children.map((cid) => measure(scene, cid));
  const children_w = children.reduce((a, c) => a + c.width, 0) + Math.max(0, children.length - 1) * H_GAP;
  const children_h = children.length ? V_GAP + Math.max(...children.map((c) => c.height)) : 0;
  return {
    id,
    width: Math.max(node_w, children_w),
    height: node_h + children_h,
    node_w,
    node_h,
    has_children,
    children
  };
}
function place(scene, m, x, y, out) {
  const n = scene.nodes[m.id];
  const node_x = x + (m.width - m.node_w) / 2;
  out.nodes.set(m.id, {
    id: m.id,
    x: node_x,
    y,
    w: m.node_w,
    h: m.node_h,
    leaf: !m.has_children,
    ease_width: scene.ease_node_widths?.has(m.id) ? true : void 0,
    no_frame: scene.no_frame_nodes?.has(m.id) ? true : void 0
  });
  const top_cols = Math.max(n.data_keys.length, 1);
  const top_cell_w = m.node_w / top_cols;
  for (let i = 0; i < n.data_keys.length; i++) {
    const k = n.data_keys[i];
    out.keys.set(k.id, {
      id: k.id,
      node: m.id,
      value: k.value,
      x: node_x + i * top_cell_w,
      y,
      w: top_cell_w,
      h: CELL_H
    });
  }
  if (!m.has_children) return;
  const render_leaf = scene.render_as_leaf?.has(m.id) ?? false;
  for (let i = 0; i < n.children.length; i++) {
    const slot_id = `${m.id}:${i}`;
    out.slots.set(slot_id, {
      id: slot_id,
      node: m.id,
      slot: i,
      x: node_x + i * CELL_W,
      y: y + CELL_H,
      w: CELL_W,
      h: render_leaf ? 0 : CELL_H
    });
  }
  const children_w = m.children.reduce((a, c) => a + c.width, 0) + Math.max(0, m.children.length - 1) * H_GAP;
  let cx = x + (m.width - children_w) / 2;
  const child_y = y + m.node_h + V_GAP;
  m.children.forEach((cm, i) => {
    const slot_x = node_x + (i + 0.5) * CELL_W;
    const slot_y = render_leaf ? y + CELL_H : y + 2 * CELL_H;
    const child_top_x = cx + cm.width / 2;
    const edge_id = `${m.id}->${cm.id}`;
    out.edges.set(edge_id, {
      id: edge_id,
      from: m.id,
      to: cm.id,
      x1: slot_x,
      y1: slot_y,
      x2: child_top_x,
      y2: child_y
    });
    place(scene, cm, cx, child_y, out);
    cx += cm.width + H_GAP;
  });
}
function subtree_ids(tree, id, out = /* @__PURE__ */ new Set()) {
  if (out.has(id)) return out;
  out.add(id);
  const n = tree.nodes[id];
  if (!n) return out;
  for (const c of n.children) subtree_ids(tree, c, out);
  return out;
}
function shift_subtree(scene, placed, root, dx, dy) {
  if (dx === 0 && dy === 0) return;
  const ids = subtree_ids(scene, root);
  for (const id of ids) {
    const nb = placed.nodes.get(id);
    if (nb) placed.nodes.set(id, { ...nb, x: nb.x + dx, y: nb.y + dy });
    const n = scene.nodes[id];
    if (!n) continue;
    for (const k of n.data_keys) {
      const kb = placed.keys.get(k.id);
      if (kb) placed.keys.set(k.id, { ...kb, x: kb.x + dx, y: kb.y + dy });
    }
    for (let i = 0; i < n.children.length; i++) {
      const slot_id = `${id}:${i}`;
      const sb = placed.slots.get(slot_id);
      if (sb) placed.slots.set(slot_id, { ...sb, x: sb.x + dx, y: sb.y + dy });
    }
  }
  for (const [eid, e] of placed.edges) {
    const to_in = ids.has(e.to);
    const from_in = ids.has(e.from);
    if (!to_in && !from_in) continue;
    const next = { ...e };
    if (from_in) {
      next.x1 += dx;
      next.y1 += dy;
    }
    if (to_in) {
      next.x2 += dx;
      next.y2 += dy;
    }
    placed.edges.set(eid, next);
  }
}
function place_probe(state, placed) {
  if (!state) return void 0;
  const { id, value, attachment } = state;
  if (attachment.kind === "above_node") {
    const nb = placed.nodes.get(attachment.node);
    if (!nb) return void 0;
    return {
      id,
      value,
      w: CELL_W,
      h: CELL_H,
      x: nb.x + nb.w / 2 - CELL_W / 2,
      y: nb.y - CELL_H - PROBE_GAP
    };
  }
  const slot = placed.keys.get(id);
  if (!slot) return void 0;
  return { id, value, x: slot.x, y: slot.y, w: slot.w, h: slot.h };
}
function shift_all(placed, probe, dx, dy) {
  if (dx === 0 && dy === 0) return probe;
  for (const [k, b] of placed.nodes)
    placed.nodes.set(k, { ...b, x: b.x + dx, y: b.y + dy });
  for (const [k, b] of placed.keys)
    placed.keys.set(k, { ...b, x: b.x + dx, y: b.y + dy });
  for (const [k, b] of placed.slots)
    placed.slots.set(k, { ...b, x: b.x + dx, y: b.y + dy });
  for (const [k, e] of placed.edges)
    placed.edges.set(k, {
      ...e,
      x1: e.x1 + dx,
      y1: e.y1 + dy,
      x2: e.x2 + dx,
      y2: e.y2 + dy
    });
  return probe ? { ...probe, x: probe.x + dx, y: probe.y + dy } : void 0;
}
function layout_scene(scene) {
  if (scene.root == null) return EMPTY_POSE;
  const sized = measure(scene, scene.root);
  const probe_band = CELL_H + PROBE_GAP;
  const placed = {
    nodes: /* @__PURE__ */ new Map(),
    keys: /* @__PURE__ */ new Map(),
    slots: /* @__PURE__ */ new Map(),
    edges: /* @__PURE__ */ new Map()
  };
  place(scene, sized, 0, probe_band, placed);
  if (scene.node_overrides) {
    const order = [];
    const seen = /* @__PURE__ */ new Set();
    const queue = [scene.root];
    while (queue.length) {
      const id = queue.shift();
      if (seen.has(id)) continue;
      seen.add(id);
      if (id in scene.node_overrides) order.push(id);
      const n = scene.nodes[id];
      if (!n) continue;
      for (const c of n.children) queue.push(c);
    }
    for (const idStr in scene.node_overrides) {
      const id = Number(idStr);
      if (!seen.has(id)) order.push(id);
    }
    for (const id of order) {
      const current = placed.nodes.get(id);
      if (!current) continue;
      const target = scene.node_overrides[id];
      shift_subtree(scene, placed, id, target.x - current.x, target.y - current.y);
    }
  }
  if (scene.extra_nodes?.length) {
    for (const extra of scene.extra_nodes) {
      if (!scene.nodes[extra.id]) continue;
      const m = measure(scene, extra.id);
      place(scene, m, extra.x, extra.y, placed);
    }
  }
  let probe = place_probe(scene.probe, placed);
  if (scene.floating_keys?.length) {
    for (const fk of scene.floating_keys) {
      let x;
      let y;
      let parent;
      if (fk.anchor.kind === "between_children") {
        const before = placed.nodes.get(fk.anchor.before);
        const after = placed.nodes.get(fk.anchor.after);
        if (!before || !after) continue;
        x = (before.x + before.w + after.x) / 2 - CELL_W / 2;
        y = before.y;
        parent = fk.anchor.parent;
      } else {
        x = fk.anchor.x;
        y = fk.anchor.y;
        parent = fk.anchor.parent;
      }
      placed.keys.set(fk.id, {
        id: fk.id,
        node: parent,
        value: fk.value,
        x,
        y,
        w: fk.w ?? CELL_W,
        h: fk.h ?? CELL_H
      });
    }
  }
  if (scene.hidden_edges) {
    for (const id of scene.hidden_edges) {
      const e = placed.edges.get(id);
      if (!e) continue;
      placed.edges.set(id, { ...e, x2: e.x1, y2: e.y1 });
    }
  }
  let min_x = Infinity;
  let min_y = 0;
  let max_x = -Infinity;
  let max_y = probe_band;
  const consume_rect = (x, y, w, h) => {
    if (x < min_x) min_x = x;
    if (y < min_y) min_y = y;
    if (x + w > max_x) max_x = x + w;
    if (y + h > max_y) max_y = y + h;
  };
  const consume_point = (x, y) => consume_rect(x, y, 0, 0);
  for (const b of placed.nodes.values()) consume_rect(b.x, b.y, b.w, b.h);
  for (const b of placed.keys.values()) consume_rect(b.x, b.y, b.w, b.h);
  for (const b of placed.slots.values()) consume_rect(b.x, b.y, b.w, b.h);
  for (const e of placed.edges.values()) {
    consume_point(e.x1, e.y1);
    consume_point(e.x2, e.y2);
  }
  if (probe) consume_rect(probe.x, probe.y, probe.w, probe.h);
  if (!Number.isFinite(min_x)) min_x = 0;
  if (!Number.isFinite(max_x)) max_x = 0;
  const root_box = placed.nodes.get(scene.root);
  const root_center_x = root_box ? root_box.x + root_box.w / 2 : 0;
  probe = shift_all(placed, probe, -root_center_x, -min_y);
  const hidden = /* @__PURE__ */ new Set();
  if (scene.probe?.attachment.kind === "in_slot")
    hidden.add(String(scene.probe.id));
  if (scene.hidden_edges)
    for (const id of scene.hidden_edges) hidden.add(id);
  return {
    nodes: placed.nodes,
    keys: placed.keys,
    slots: placed.slots,
    edges: placed.edges,
    width: max_x - min_x,
    height: max_y - min_y,
    min_x: min_x - root_center_x,
    hidden,
    probe
  };
}

// component/src/pose_edit.ts
function clone_pose(p) {
  return {
    nodes: new Map(p.nodes),
    keys: new Map(p.keys),
    slots: new Map(p.slots),
    edges: new Map(p.edges),
    width: p.width,
    height: p.height,
    min_x: p.min_x,
    hidden: new Set(p.hidden),
    probe: p.probe ? { ...p.probe } : void 0
  };
}
function shift_subtree_in_pose(pose, snapshot, root, dx, dy) {
  if (dx === 0 && dy === 0) return;
  const ids = subtree_ids(snapshot, root);
  for (const id of ids) {
    const nb = pose.nodes.get(id);
    if (nb) pose.nodes.set(id, { ...nb, x: nb.x + dx, y: nb.y + dy });
    const n = snapshot.nodes[id];
    if (!n) continue;
    for (const k of n.data_keys) {
      const kb = pose.keys.get(k.id);
      if (kb) pose.keys.set(k.id, { ...kb, x: kb.x + dx, y: kb.y + dy });
    }
    for (let i = 0; i < n.children.length; i++) {
      const slot_id = `${id}:${i}`;
      const sb = pose.slots.get(slot_id);
      if (sb) pose.slots.set(slot_id, { ...sb, x: sb.x + dx, y: sb.y + dy });
    }
  }
  for (const [eid, e] of pose.edges) {
    const to_in = ids.has(e.to);
    const from_in = ids.has(e.from);
    if (!to_in && !from_in) continue;
    const next = { ...e };
    if (from_in) {
      next.x1 += dx;
      next.y1 += dy;
    }
    if (to_in) {
      next.x2 += dx;
      next.y2 += dy;
    }
    pose.edges.set(eid, next);
  }
}
function pin_subtree_to(pose, snapshot, root, target_x, target_y) {
  const nb = pose.nodes.get(root);
  if (!nb) return;
  shift_subtree_in_pose(
    pose,
    snapshot,
    root,
    target_x - nb.x,
    target_y - nb.y
  );
}
function shift_node_only(pose, snapshot, id, dx, dy) {
  if (dx === 0 && dy === 0) return;
  const nb = pose.nodes.get(id);
  if (nb) pose.nodes.set(id, { ...nb, x: nb.x + dx, y: nb.y + dy });
  const n = snapshot.nodes[id];
  if (!n) return;
  for (const k of n.data_keys) {
    const kb = pose.keys.get(k.id);
    if (kb) pose.keys.set(k.id, { ...kb, x: kb.x + dx, y: kb.y + dy });
  }
  for (let i = 0; i < n.children.length; i++) {
    const slot_id = `${id}:${i}`;
    const sb = pose.slots.get(slot_id);
    if (sb) pose.slots.set(slot_id, { ...sb, x: sb.x + dx, y: sb.y + dy });
  }
  for (const [eid, e] of pose.edges) {
    if (e.from !== id) continue;
    pose.edges.set(eid, { ...e, x1: e.x1 + dx, y1: e.y1 + dy });
  }
}
function move_node_only(pose, snapshot, id, target) {
  const nb = pose.nodes.get(id);
  if (!nb) return;
  const dx = target.x !== void 0 ? target.x - nb.x : 0;
  const dy = target.y !== void 0 ? target.y - nb.y : 0;
  shift_node_only(pose, snapshot, id, dx, dy);
}
function move_key(pose, key_id, change) {
  const kb = pose.keys.get(key_id);
  if (!kb) return;
  const next = {
    ...kb,
    x: change.x ?? kb.x,
    y: change.y ?? kb.y,
    w: change.w ?? kb.w,
    h: change.h ?? kb.h
  };
  pose.keys.set(key_id, next);
}
function hide_edges(pose, ids) {
  for (const id of ids) {
    pose.hidden.add(id);
    const e = pose.edges.get(id);
    if (!e) continue;
    pose.edges.set(id, { ...e, x2: e.x1, y2: e.y1 });
  }
}
function hide_node_frame(pose, id) {
  const nb = pose.nodes.get(id);
  if (!nb) return;
  pose.nodes.set(id, { ...nb, no_frame: true });
}
function render_node_as_leaf(pose, id) {
  const nb = pose.nodes.get(id);
  if (!nb) return;
  for (const [slot_id, slot] of pose.slots) {
    if (slot.node !== id) continue;
    pose.slots.set(slot_id, { ...slot, h: 0 });
  }
}
function set_ease_width(pose, id) {
  const nb = pose.nodes.get(id);
  if (!nb) return;
  pose.nodes.set(id, { ...nb, ease_width: true });
}
function recompute_bounds(pose) {
  let min_x = Infinity;
  let max_x = -Infinity;
  const consume = (x, w) => {
    if (x < min_x) min_x = x;
    if (x + w > max_x) max_x = x + w;
  };
  for (const b of pose.nodes.values()) consume(b.x, b.w);
  for (const b of pose.keys.values()) consume(b.x, b.w);
  for (const b of pose.slots.values()) consume(b.x, b.w);
  for (const e of pose.edges.values()) {
    const emin = Math.min(e.x1, e.x2);
    const emax = Math.max(e.x1, e.x2);
    if (emin < min_x) min_x = emin;
    if (emax > max_x) max_x = emax;
  }
  if (pose.probe) consume(pose.probe.x, pose.probe.w);
  if (!Number.isFinite(min_x)) min_x = 0;
  if (!Number.isFinite(max_x)) max_x = 0;
  pose.min_x = min_x;
  pose.width = max_x - min_x;
}

// component/src/choreograph.ts
function lookup_value(op, id) {
  const r = op.result;
  if (r.type === "Insert" && r.key.id === id) return r.key.value;
  if (r.type === "BulkInsert") {
    for (const k of r.keys) if (k.id === id) return k.value;
  }
  for (const nid in op.final.nodes) {
    for (const k of op.final.nodes[nid].data_keys) {
      if (k.id === id) return k.value;
    }
  }
  return NaN;
}
function resolve_probe_at(op, index) {
  if (op.kind !== "insert" && op.kind !== "bulk_insert") return void 0;
  for (let j = index; j >= 0; j--) {
    const s = step_at(op, j);
    if (!s) continue;
    const e = s.event;
    if (e.t === "visit_insert") {
      const id = e.value_id;
      return { id, value: lookup_value(op, id) };
    }
    if (e.t === "insert_merge" || e.t === "insert_median_found")
      return void 0;
  }
  return void 0;
}
function current_probe_target(op, up_to) {
  for (let j = up_to; j >= 0; j--) {
    const s = step_at(op, j);
    if (!s) continue;
    const e = s.event;
    if (e.t === "visit_insert") return { kind: "above", node: e.node_id };
    if (e.t === "descend") return { kind: "above", node: e.to };
    if (e.t === "insert_widen")
      return { kind: "in_slot", node: e.node, index: e.index };
    if (e.t === "insert_merge" || e.t === "insert_median_found") return void 0;
  }
  return void 0;
}
function find_parent(data, child) {
  for (const pid in data.nodes) {
    if (data.nodes[pid].children.includes(child)) return Number(pid);
  }
  return void 0;
}
function with_parked_probe(scene, ctx, up_to) {
  if (ctx.probe_id === void 0 || ctx.probe_value === void 0) return scene;
  const probe = { id: ctx.probe_id, value: ctx.probe_value };
  const target = current_probe_target(ctx.op, up_to);
  if (!target) return scene;
  if (target.kind === "above")
    return attach_probe_above(scene, target.node, probe);
  return reserve_slot(scene, target.node, target.index, probe);
}
function split_phase_pose(ctx, i, ev, snapshot, phase, slide_sub = "final") {
  const base_scene = with_parked_probe(scene_from_snapshot(snapshot), ctx, i);
  const baseline = layout_scene(base_scene);
  const pose = clone_pose(baseline);
  const parent_id = find_parent(snapshot, ev.node);
  if (parent_id === void 0) return pose;
  const parent_node = snapshot.nodes[parent_id];
  const grandparent = find_parent(snapshot, parent_id);
  const is_fresh_root = grandparent === void 0 && parent_node.children.length === 2;
  const parent_key_id = ev.copy ?? ev.median;
  const edge_left = `${parent_id}->${ev.node}`;
  const edge_right = `${parent_id}->${ev.right}`;
  let pre_split_step;
  for (let j = i - 1; j >= 0; j--) {
    const s = step_at(ctx.op, j);
    if (!s) break;
    if (!s.snapshot.nodes[ev.right]) {
      pre_split_step = s;
      break;
    }
  }
  const prev_pose = pre_split_step ? layout_scene(scene_from_snapshot(pre_split_step.snapshot)) : void 0;
  const prev_parent = prev_pose?.nodes.get(parent_id);
  if (phase === "split_connect_to_children") {
    if (parent_node.data_keys.length === 1) {
      hide_node_frame(pose, parent_id);
    }
    recompute_bounds(pose);
    return pose;
  }
  if (phase === "split_parent_grows") {
    const pre_count = pre_split_step ? pre_split_step.snapshot.nodes[parent_id]?.children.length ?? 0 : 0;
    for (let si = pre_count; si < parent_node.children.length; si++) {
      pose.hidden.add(`${parent_id}:${si}`);
    }
    hide_edges(pose, [edge_left, edge_right]);
    if (is_fresh_root) {
      hide_node_frame(pose, parent_id);
      render_node_as_leaf(pose, parent_id);
    } else {
      set_ease_width(pose, parent_id);
    }
    recompute_bounds(pose);
    return pose;
  }
  if (is_fresh_root) {
    hide_node_frame(pose, parent_id);
    for (let si = 0; si < parent_node.children.length; si++) {
      pose.hidden.add(`${parent_id}:${si}`);
    }
  }
  hide_edges(pose, [edge_left, edge_right]);
  if (prev_parent) {
    const nb = pose.nodes.get(parent_id);
    if (nb) {
      pose.nodes.set(parent_id, {
        ...nb,
        x: prev_parent.x,
        y: prev_parent.y,
        w: prev_parent.w
      });
    }
  }
  if (prev_pose && pre_split_step) {
    const pre_split_parent = pre_split_step.snapshot.nodes[parent_id];
    if (pre_split_parent) {
      for (const pre_key of pre_split_parent.data_keys) {
        if (pre_key.id === parent_key_id) continue;
        const prev_kb = prev_pose.keys.get(pre_key.id);
        if (!prev_kb) continue;
        move_key(pose, pre_key.id, {
          x: prev_kb.x,
          y: prev_kb.y,
          w: prev_kb.w
        });
      }
      if (!is_fresh_root) {
        const pre_count = pre_split_parent.children.length;
        for (let i2 = 0; i2 < pre_count; i2++) {
          const slot_id = `${parent_id}:${i2}`;
          const prev_slot = prev_pose.slots.get(slot_id);
          const cur_slot = pose.slots.get(slot_id);
          if (!prev_slot || !cur_slot) continue;
          pose.slots.set(slot_id, {
            ...cur_slot,
            x: prev_slot.x,
            y: prev_slot.y,
            w: prev_slot.w
          });
        }
        for (let i2 = pre_count; i2 < parent_node.children.length; i2++) {
          pose.hidden.add(`${parent_id}:${i2}`);
        }
      }
    }
  }
  const L_box = pose.nodes.get(ev.node);
  const R_box = pose.nodes.get(ev.right);
  if (!L_box || !R_box) return pose;
  const median_w = CELL_W;
  const prev_overflow = prev_pose?.nodes.get(ev.node);
  const row_y = L_box.y;
  const overflow_node_x = prev_overflow?.x ?? L_box.x;
  const overflow_node_w = prev_overflow?.w ?? L_box.w;
  const overflow_node_center = overflow_node_x + overflow_node_w / 2;
  const spread_node_w = L_box.w + 2 * H_GAP + median_w + R_box.w;
  const spread_delta = slide_sub === "final" ? Math.max(0, (spread_node_w - overflow_node_w) / 2) : 0;
  if (prev_pose) {
    const L_children = snapshot.nodes[ev.node]?.children ?? [];
    const R_children = snapshot.nodes[ev.right]?.children ?? [];
    for (const cid of [...L_children, ...R_children]) {
      const prev_child = prev_pose.nodes.get(cid);
      const cur_child = pose.nodes.get(cid);
      if (!prev_child || !cur_child) continue;
      pin_subtree_to(pose, snapshot, cid, prev_child.x, cur_child.y);
    }
  }
  if (pre_split_step && prev_pose) {
    const pre_split_parent = pre_split_step.snapshot.nodes[parent_id];
    if (pre_split_parent) {
      const l_pre_idx = pre_split_parent.children.indexOf(ev.node);
      for (const sib_id of parent_node.children) {
        if (sib_id === ev.node || sib_id === ev.right) continue;
        const prev_box = prev_pose.nodes.get(sib_id);
        if (!prev_box) continue;
        const sib_pre_idx = pre_split_parent.children.indexOf(sib_id);
        const direction = sib_pre_idx < 0 || l_pre_idx < 0 ? 0 : sib_pre_idx < l_pre_idx ? -1 : 1;
        pin_subtree_to(
          pose,
          snapshot,
          sib_id,
          prev_box.x + direction * spread_delta,
          prev_box.y
        );
      }
    }
  }
  if (phase === "split_slide_apart" && slide_sub === "init") {
    move_node_only(pose, snapshot, ev.node, {
      x: overflow_node_x,
      y: row_y
    });
    move_node_only(pose, snapshot, ev.right, {
      x: overflow_node_x + overflow_node_w - R_box.w,
      y: row_y
    });
    move_key(pose, parent_key_id, {
      x: overflow_node_center - median_w / 2,
      y: row_y,
      w: median_w
    });
    recompute_bounds(pose);
    return pose;
  }
  const spread_L_node_x = overflow_node_center - median_w / 2 - H_GAP - L_box.w;
  const spread_R_node_x = overflow_node_center + median_w / 2 + H_GAP;
  const spread_median_x = overflow_node_center - median_w / 2;
  move_node_only(pose, snapshot, ev.node, {
    x: spread_L_node_x,
    y: row_y
  });
  move_node_only(pose, snapshot, ev.right, {
    x: spread_R_node_x,
    y: row_y
  });
  if (phase === "split_slide_apart") {
    move_key(pose, parent_key_id, {
      x: spread_median_x,
      y: row_y,
      w: median_w
    });
  } else {
    const parent_in_baseline = baseline.nodes.get(parent_id);
    const parent_y = parent_in_baseline?.y ?? row_y;
    const halfway_y = (row_y + parent_y) / 2;
    move_key(pose, parent_key_id, {
      x: spread_median_x,
      y: halfway_y,
      w: median_w
    });
  }
  recompute_bounds(pose);
  return pose;
}
function step_total_weight(op, index) {
  const probe = resolve_probe_at(op, index);
  const kfs = choreograph({
    op,
    index,
    probe_id: probe?.id,
    probe_value: probe?.value
  });
  return kfs.reduce((a, k) => a + k.weight, 0) || 1;
}
function choreograph(ctx) {
  const { op, index: i } = ctx;
  const step = step_at(op, i);
  if (!step) return [];
  const snapshot = step.snapshot;
  const ev = step.event;
  const has_probe = ctx.probe_id !== void 0 && ctx.probe_value !== void 0;
  const probe = has_probe ? { id: ctx.probe_id, value: ctx.probe_value } : void 0;
  let scene;
  switch (ev.t) {
    case "visit_insert":
      scene = scene_from_snapshot(snapshot);
      if (probe) scene = attach_probe_above(scene, ev.node_id, probe);
      break;
    case "select_descent_child":
      scene = scene_from_snapshot(snapshot);
      if (probe) scene = attach_probe_above(scene, ev.from, probe);
      break;
    case "descend":
      scene = scene_from_snapshot(snapshot);
      if (probe) scene = attach_probe_above(scene, ev.to, probe);
      break;
    case "insert_widen": {
      scene = scene_from_snapshot(snapshot);
      if (probe) scene = reserve_slot(scene, ev.node, ev.index, probe);
      scene = with_eased_width(scene, ev.node);
      break;
    }
    case "insert_merge":
    case "insert_median_found":
      scene = scene_from_snapshot(snapshot);
      break;
    case "split_slide_apart":
      return [
        {
          pose: split_phase_pose(ctx, i, ev, snapshot, ev.t, "init"),
          weight: 0,
          ease: easeInOutCubic
        },
        {
          pose: split_phase_pose(ctx, i, ev, snapshot, ev.t, "final"),
          weight: 1,
          ease: easeInOutCubic
        }
      ];
    case "split_pull_median":
    case "split_parent_grows":
    case "split_connect_to_children":
      return [
        {
          pose: split_phase_pose(ctx, i, ev, snapshot, ev.t),
          weight: 1,
          ease: easeInOutCubic
        }
      ];
    default: {
      scene = scene_from_snapshot(snapshot);
      if (probe) {
        const target = current_probe_target(op, i);
        if (target?.kind === "above")
          scene = attach_probe_above(scene, target.node, probe);
        else if (target?.kind === "in_slot")
          scene = reserve_slot(scene, target.node, target.index, probe);
      }
    }
  }
  const pose = layout_scene(scene);
  const ease = ev.t === "insert_merge" || ev.t === "insert_median_found" ? easeOutCubic : easeInOutCubic;
  return [{ pose, weight: 1, ease }];
}
function entry_pose(ctx) {
  const kfs = choreograph(ctx);
  if (kfs.length === 0) {
    const step = step_at(ctx.op, ctx.index);
    const data = step ? step.snapshot : ctx.op.final;
    return layout_scene(scene_from_snapshot(data));
  }
  return kfs[0].pose;
}

// component/src/player.ts
var EMPTY_POSE2 = {
  nodes: /* @__PURE__ */ new Map(),
  keys: /* @__PURE__ */ new Map(),
  slots: /* @__PURE__ */ new Map(),
  edges: /* @__PURE__ */ new Map(),
  width: 0,
  height: 0,
  min_x: 0,
  hidden: /* @__PURE__ */ new Set()
};
var lerp = (a, b, t) => a + (b - a) * t;
function lerp_node(a, b, t) {
  return {
    id: b.id,
    leaf: b.leaf,
    ease_width: b.ease_width,
    no_frame: b.no_frame,
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    w: b.ease_width ? lerp(a.w, b.w, t) : b.w,
    h: lerp(a.h, b.h, t)
  };
}
function lerp_key(a, b, t) {
  return {
    id: b.id,
    node: b.node,
    value: b.value,
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    w: lerp(a.w, b.w, t),
    h: lerp(a.h, b.h, t)
  };
}
function lerp_slot(a, b, t) {
  return {
    id: b.id,
    node: b.node,
    slot: b.slot,
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    w: lerp(a.w, b.w, t),
    h: lerp(a.h, b.h, t)
  };
}
function lerp_edge(a, b, t) {
  return {
    id: b.id,
    from: b.from,
    to: b.to,
    x1: lerp(a.x1, b.x1, t),
    y1: lerp(a.y1, b.y1, t),
    x2: lerp(a.x2, b.x2, t),
    y2: lerp(a.y2, b.y2, t)
  };
}
function lerp_probe(a, b, t) {
  if (!b) return void 0;
  if (!a) return b;
  if (a.id !== b.id) return b;
  return {
    id: b.id,
    value: b.value,
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    w: lerp(a.w, b.w, t),
    h: lerp(a.h, b.h, t)
  };
}
function lerp_pose(from, to, t) {
  const nodes = /* @__PURE__ */ new Map();
  for (const [id, box] of to.nodes) {
    const prev = from.nodes.get(id);
    nodes.set(id, prev ? lerp_node(prev, box, t) : box);
  }
  const keys = /* @__PURE__ */ new Map();
  for (const [id, box] of to.keys) {
    const prev = from.keys.get(id);
    keys.set(id, prev ? lerp_key(prev, box, t) : box);
  }
  const slots = /* @__PURE__ */ new Map();
  for (const [id, box] of to.slots) {
    const prev = from.slots.get(id);
    slots.set(id, prev ? lerp_slot(prev, box, t) : box);
  }
  const edges = /* @__PURE__ */ new Map();
  for (const [id, line] of to.edges) {
    const prev = from.edges.get(id);
    edges.set(id, prev ? lerp_edge(prev, line, t) : line);
  }
  return {
    nodes,
    keys,
    slots,
    edges,
    width: lerp(from.width, to.width, t),
    height: lerp(from.height, to.height, t),
    min_x: lerp(from.min_x, to.min_x, t),
    hidden: to.hidden,
    probe: lerp_probe(from.probe, to.probe, t)
  };
}
function create_player(stepMs) {
  const [shown, setShown] = createSignal(EMPTY_POSE2);
  let raf = 0;
  let lastOp;
  const cancel = () => {
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };
  const snap = (pose) => {
    cancel();
    setShown(pose);
  };
  const tween_through = (from, kfs) => {
    cancel();
    if (kfs.length === 0) return;
    const base_ms = Math.max(1, stepMs());
    const phases = [];
    let cursor = 0;
    for (let i = 0; i < kfs.length; i++) {
      const kf = kfs[i];
      const dur = base_ms * kf.weight;
      phases.push({
        from: i === 0 ? from : kfs[i - 1].pose,
        to: kf.pose,
        ease: kf.ease,
        start: cursor,
        end: cursor + dur
      });
      cursor += dur;
    }
    const total = cursor;
    const t0 = performance.now();
    const tick = (now) => {
      const elapsed = now - t0;
      if (elapsed >= total) {
        setShown(phases[phases.length - 1].to);
        raf = 0;
        return;
      }
      let p = phases[0];
      for (const phase of phases) {
        if (elapsed < phase.end) {
          p = phase;
          break;
        }
      }
      const local = (elapsed - p.start) / (p.end - p.start);
      setShown(lerp_pose(p.from, p.to, p.ease(local)));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  };
  const update = (ctx, prev_index) => {
    if (!ctx) {
      lastOp = void 0;
      snap(EMPTY_POSE2);
      return;
    }
    const kfs = choreograph(ctx);
    if (kfs.length === 0) {
      snap(entry_pose(ctx));
      lastOp = ctx.op;
      return;
    }
    const sameOp = lastOp === ctx.op;
    const contiguous = sameOp && prev_index !== void 0 && ctx.index === prev_index + 1;
    if (contiguous) {
      tween_through(shown(), kfs);
    } else {
      snap(kfs[kfs.length - 1].pose);
    }
    lastOp = ctx.op;
  };
  return { shown, update, snap, dispose: cancel };
}

// component/src/view.tsx
var CELL_W = 48;
var CELL_H = 32;
var H_GAP = 24;
var V_GAP = 56;
var CANVAS_PADDING = 8;
function highlight_at(op, index) {
  const step = step_at(op, index);
  return highlight_from(step?.event);
}
var node_state = (h, id) => h.alarm_nodes.has(id) ? "alarm" : h.nodes.has(id) ? "active" : "idle";
var key_state = (h, id) => h.keys.has(id) ? "active" : "idle";
var edge_state = (h, id) => h.edges.has(id) ? "active" : "idle";
function highlight_bounds(pose, h) {
  let min_x = Infinity;
  let min_y = Infinity;
  let max_x = -Infinity;
  let max_y = -Infinity;
  let seen = false;
  const consume = (x, y, w, h2) => {
    seen = true;
    if (x < min_x) min_x = x;
    if (y < min_y) min_y = y;
    if (x + w > max_x) max_x = x + w;
    if (y + h2 > max_y) max_y = y + h2;
  };
  for (const id of h.nodes) {
    const b = pose.nodes.get(id);
    if (b) consume(b.x, b.y, b.w, b.h);
  }
  for (const id of h.keys) {
    const b = pose.keys.get(id);
    if (b) consume(b.x, b.y, b.w, b.h);
  }
  for (const id of h.edges) {
    const e = pose.edges.get(id);
    if (e) {
      const ex = Math.min(e.x1, e.x2);
      const ey = Math.min(e.y1, e.y2);
      consume(ex, ey, Math.abs(e.x2 - e.x1), Math.abs(e.y2 - e.y1));
    }
  }
  if (!seen) return null;
  return { x: min_x, y: min_y, w: max_x - min_x, h: max_y - min_y };
}
function OperationPlayer(props) {
  const [imperative_step, setImperativeStep] = createSignal2(
    void 0
  );
  const active_index = () => props.index !== void 0 ? props.index : imperative_step();
  const probe_meta = createMemo(() => {
    const op = props.op;
    const i = active_index();
    if (!op || i === void 0) return void 0;
    return resolve_probe_at(op, i);
  });
  const dest_highlight = createMemo(() => {
    const op = props.op;
    const i = active_index();
    if (!op || i === void 0) return empty_highlight();
    return highlight_at(op, i);
  });
  const player = create_player(() => props.stepMs ?? 400);
  onCleanup(() => player.dispose());
  let prev_index = void 0;
  createEffect(() => {
    const op = props.op;
    const i = props.index;
    const probe = probe_meta();
    untrack(() => {
      if (!op || i === void 0) {
        player.update(void 0, prev_index);
      } else {
        const ctx = {
          op,
          index: i,
          probe_id: probe?.id,
          probe_value: probe?.value
        };
        player.update(ctx, prev_index);
      }
      prev_index = i;
    });
  });
  const shown = player.shown;
  const EMPTY_POSE_FROM = {
    nodes: /* @__PURE__ */ new Map(),
    keys: /* @__PURE__ */ new Map(),
    slots: /* @__PURE__ */ new Map(),
    edges: /* @__PURE__ */ new Map(),
    width: 0,
    height: 0,
    min_x: 0,
    hidden: /* @__PURE__ */ new Set()
  };
  const renderAt = (step, t) => {
    const op = props.op;
    if (!op) return;
    const total_steps = step_count(op);
    if (total_steps === 0) return;
    const s = Math.max(0, Math.min(total_steps - 1, Math.floor(step)));
    setImperativeStep(s);
    const probe = resolve_probe_at(op, s);
    const ctx = {
      op,
      index: s,
      probe_id: probe?.id,
      probe_value: probe?.value
    };
    const kfs = choreograph(ctx);
    if (kfs.length === 0) return;
    let from;
    if (s === 0) {
      from = EMPTY_POSE_FROM;
    } else {
      const prev_probe = resolve_probe_at(op, s - 1);
      const prev_ctx = {
        op,
        index: s - 1,
        probe_id: prev_probe?.id,
        probe_value: prev_probe?.value
      };
      const prev_kfs = choreograph(prev_ctx);
      from = prev_kfs.length ? prev_kfs[prev_kfs.length - 1].pose : EMPTY_POSE_FROM;
    }
    const total_weight = kfs.reduce((a, k) => a + k.weight, 0);
    const clamped_t = Math.max(0, Math.min(1, t));
    if (total_weight === 0) {
      player.snap(kfs[kfs.length - 1].pose);
      return;
    }
    const target = clamped_t * total_weight;
    let acc = 0;
    for (let i = 0; i < kfs.length; i++) {
      const w = kfs[i].weight;
      const is_last = i === kfs.length - 1;
      if (target <= acc + w || is_last) {
        const phase_from = i === 0 ? from : kfs[i - 1].pose;
        const phase_to = kfs[i].pose;
        const local = w === 0 ? 1 : Math.min(1, Math.max(0, (target - acc) / w));
        player.snap(lerp_pose(phase_from, phase_to, kfs[i].ease(local)));
        return;
      }
      acc += w;
    }
  };
  onMount(() => {
    props.onReady?.({
      renderAt,
      getBounds: () => ({
        width: shown().width + CANVAS_PADDING * 2,
        height: shown().height + CANVAS_PADDING * 2
      }),
      stepCount: () => props.op ? step_count(props.op) : 0
    });
  });
  const nodeIds = createMemo(() => [...shown().nodes.keys()]);
  const edgeIds = createMemo(() => [...shown().edges.keys()]);
  const childrenByNode = createMemo(() => {
    const p = shown();
    const keys = /* @__PURE__ */ new Map();
    const slots = /* @__PURE__ */ new Map();
    const orphan_keys = [];
    const orphan_slots = [];
    for (const key of p.keys.values()) {
      if (p.nodes.has(key.node)) {
        const arr = keys.get(key.node) ?? [];
        arr.push(key);
        keys.set(key.node, arr);
      } else {
        orphan_keys.push(key);
      }
    }
    for (const slot of p.slots.values()) {
      if (p.nodes.has(slot.node)) {
        const arr = slots.get(slot.node) ?? [];
        arr.push(slot);
        slots.set(slot.node, arr);
      } else {
        orphan_slots.push(slot);
      }
    }
    return { keys, slots, orphan_keys, orphan_slots };
  });
  createEffect(() => {
    const p = shown();
    props.onLayout?.({ width: p.width, height: p.height });
  });
  const svg_x = (pose_x) => pose_x + CANVAS_PADDING - shown().min_x;
  const svg_y = (pose_y) => pose_y + CANVAS_PADDING;
  createEffect(() => {
    const probe = shown().probe;
    if (probe) {
      props.onAnimationCenter?.({
        x: svg_x(probe.x + probe.w / 2),
        y: svg_y(probe.y + probe.h / 2)
      });
      return;
    }
    const hl2 = dest_highlight();
    if (hl2.anchor_key !== void 0) {
      const k = shown().keys.get(hl2.anchor_key);
      if (k) {
        props.onAnimationCenter?.({
          x: svg_x(k.x + k.w / 2),
          y: svg_y(k.y + k.h / 2)
        });
        return;
      }
    }
    const bounds = highlight_bounds(shown(), hl2);
    if (!bounds) {
      props.onAnimationCenter?.(void 0);
      return;
    }
    props.onAnimationCenter?.({
      x: svg_x(bounds.x + bounds.w / 2),
      y: svg_y(bounds.y + bounds.h / 2)
    });
  });
  const totalW = () => shown().width + CANVAS_PADDING * 2;
  const totalH = () => shown().height + CANVAS_PADDING * 2;
  const hl = dest_highlight;
  const hidden = () => shown().hidden;
  const not_hidden = (id) => !hidden().has(String(id));
  return <svg
    class={props.class}
    style={props.style}
    xmlns="http://www.w3.org/2000/svg"
    width={totalW()}
    height={totalH()}
  >
      <style>{SVG_STYLE}</style>
      <g
    transform={`translate(${CANVAS_PADDING - shown().min_x}, ${CANVAS_PADDING})`}
  >
        <For each={edgeIds()}>
          {(id) => <Show when={not_hidden(id) && shown().edges.get(id)}>
              {(edge) => <EdgeView edge={edge()} state={edge_state(hl(), id)} />}
            </Show>}
        </For>

        <For each={nodeIds()}>
          {(id) => <Show when={not_hidden(id) && shown().nodes.get(id)}>
              {(box) => <NodeView
    box={box()}
    state={node_state(hl(), id)}
    slots={childrenByNode().slots.get(id) ?? []}
    keys={childrenByNode().keys.get(id) ?? []}
    hidden={hidden()}
    highlight={hl()}
  />}
            </Show>}
        </For>

        {
    /* Orphan slots / keys — their parent isn't in the current pose
       (e.g. the floating median before the fresh root appears).
       Rendered at top level with absolute positions. */
  }
        <For each={childrenByNode().orphan_slots}>
          {(slot) => <Show when={not_hidden(slot.id)}>
              <SlotView
    slot={slot}
    origin={{ x: 0, y: 0 }}
    alarm={hl().alarm_nodes.has(slot.node)}
    active={hl().slots.has(slot.id)}
  />
            </Show>}
        </For>

        <For each={childrenByNode().orphan_keys}>
          {(key) => <Show when={not_hidden(String(key.id))}>
              <KeyView
    keyBox={key}
    state={key_state(hl(), key.id)}
    origin={{ x: 0, y: 0 }}
    alarm={hl().alarm_nodes.has(key.node)}
  />
            </Show>}
        </For>

        <Show when={shown().probe}>
          {(probe) => <ProbeView probe={probe()} />}
        </Show>
      </g>
    </svg>;
}
var COLOR = {
  node_fill: "#2c2c2c",
  node_stroke: "#4a4a4a",
  text_idle: "#e8e8e8",
  edge_idle: "#888",
  active_fill: "#4a3a1f",
  active_stroke: "#f0b060",
  active_text: "#ffd890",
  alarm_fill: "#4a1f1f",
  alarm_stroke: "#f06060"
};
var SVG_STYLE = `
  /* Only the node groups and the probe get promoted to their own
     compositor layer. Keys and slots are now DOM children of their
     parent node's <g>, so they ride that layer naturally \u2014 giving them
     their own \`will-change\` would split them off into separate layers
     again and reintroduce the per-layer timing drift that was making
     them trail behind the node under load. */
  g.node, g.probe {
    will-change: transform;
  }
  path.edge {
    will-change: d;
  }
  g.node[data-state="alarm"],
  g.key[data-alarm="true"],
  g.slot[data-alarm="true"] {
    transform-box: fill-box;
    transform-origin: center;
    animation: btree-overfill-shake 320ms ease-in-out infinite;
  }
  @keyframes btree-overfill-shake {
    0%, 100% { translate: 0 0; }
    25%      { translate: -2px 0; }
    75%      { translate: 2px 0; }
  }
`;
function SlotView(props) {
  const rx = () => props.slot.x - props.origin.x;
  const ry = () => props.slot.y - props.origin.y;
  return <g
    class="slot"
    data-alarm={props.alarm ? "true" : void 0}
    style={{ transform: `translate(${rx()}px, ${ry()}px)` }}
  >
      <rect
    width={props.slot.w}
    height={props.slot.h}
    fill={props.active ? COLOR.active_fill : COLOR.node_fill}
    stroke={props.active ? COLOR.active_stroke : COLOR.node_stroke}
    stroke-width={props.active ? 1.5 : 1}
  />
    </g>;
}
function NodeView(props) {
  const fill = () => props.state === "alarm" ? COLOR.alarm_fill : props.state === "active" ? COLOR.active_fill : COLOR.node_fill;
  const stroke = () => props.state === "alarm" ? COLOR.alarm_stroke : props.state === "active" ? COLOR.active_stroke : COLOR.node_stroke;
  const strokeW = () => props.state === "alarm" ? 3 : props.state === "active" ? 1.5 : 1;
  const origin = () => ({ x: props.box.x, y: props.box.y });
  const alarmed = () => props.state === "alarm";
  return <g
    class="node"
    data-state={props.state}
    style={{ transform: `translate(${props.box.x}px, ${props.box.y}px)` }}
  >
      <Show when={!props.box.no_frame}>
        <rect
    width={props.box.w}
    height={props.box.h}
    fill={fill()}
    stroke={stroke()}
    stroke-width={strokeW()}
  />
      </Show>
      <For each={props.slots}>
        {(slot) => <Show when={!props.hidden.has(slot.id)}>
            <SlotView
    slot={slot}
    origin={origin()}
    alarm={alarmed()}
    active={props.highlight.slots.has(slot.id)}
  />
          </Show>}
      </For>
      <For each={props.keys}>
        {(key) => <Show when={!props.hidden.has(String(key.id))}>
            <KeyView
    keyBox={key}
    state={key_state(props.highlight, key.id)}
    origin={origin()}
    alarm={alarmed()}
  />
          </Show>}
      </For>
    </g>;
}
function KeyView(props) {
  const active = () => props.state === "active";
  const rx = () => props.keyBox.x - props.origin.x;
  const ry = () => props.keyBox.y - props.origin.y;
  return <g
    class="key"
    data-state={props.state}
    data-alarm={props.alarm ? "true" : void 0}
    style={{ transform: `translate(${rx()}px, ${ry()}px)` }}
  >
      <rect
    width={props.keyBox.w}
    height={props.keyBox.h}
    fill={active() ? COLOR.active_fill : COLOR.node_fill}
    stroke={active() ? COLOR.active_stroke : COLOR.node_stroke}
    stroke-width={active() ? 1.5 : 1}
  />
      <text
    x={props.keyBox.w / 2}
    y={props.keyBox.h / 2}
    fill={active() ? COLOR.active_text : COLOR.text_idle}
    font-size="14"
    font-family="Helvetica, Helvetica Neue, Arial, sans-serif"
    text-anchor="middle"
    dominant-baseline="central"
  >
        {props.keyBox.value}
      </text>
    </g>;
}
function EdgeView(props) {
  const active = () => props.state === "active";
  const path = () => `M ${props.edge.x1} ${props.edge.y1} L ${props.edge.x2} ${props.edge.y2}`;
  return <path
    class="edge"
    data-state={props.state}
    d={path()}
    fill="none"
    stroke={active() ? COLOR.active_stroke : COLOR.edge_idle}
    stroke-width={active() ? 2.25 : 1.5}
  />;
}
function ProbeView(props) {
  return <g
    class="probe"
    data-role="probe"
    style={{
      transform: `translate(${props.probe.x}px, ${props.probe.y}px)`
    }}
  >
      <rect
    width={props.probe.w}
    height={props.probe.h}
    fill={COLOR.active_fill}
    stroke={COLOR.active_stroke}
    stroke-width={1.5}
    rx={4}
  />
      <text
    x={props.probe.w / 2}
    y={props.probe.h / 2}
    fill={COLOR.active_text}
    font-size="14"
    font-family="Helvetica, Helvetica Neue, Arial, sans-serif"
    text-anchor="middle"
    dominant-baseline="central"
  >
        {props.probe.value}
      </text>
    </g>;
}
export {
  CANVAS_PADDING,
  CELL_H,
  CELL_W,
  H_GAP,
  NotImplementedError,
  OperationPlayer,
  V_GAP,
  build_tree,
  check_config_for_errors,
  check_config_for_warnings,
  choreograph,
  describe_operation,
  dispatch,
  empty_highlight,
  fill_tree_random,
  fill_tree_sequential,
  fit_to_viewport,
  highlight_at,
  highlight_from,
  recording_recorder,
  resolve_probe_at,
  step_at,
  step_count,
  step_total_weight
};
