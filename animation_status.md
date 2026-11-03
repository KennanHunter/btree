# Animation pipeline — who owns what

End-to-end: a user action is dispatched as a `BTreeOperation`, which carries
a list of `(snapshot, event)` steps. The UI holds a cursor over those steps.
On every change to `(operation, cursor)`, a **choreographer** turns the step
into one or more **keyframes**, each one a fully-laid-out `Pose`. A JS
**player** tweens between consecutive poses on `requestAnimationFrame`, and
the `OperationPlayer` component renders whatever the player's current pose
says.

```
UI action
  ──▶ dispatch() ──▶ Tree.insert / Tree.search ──▶ BTreeEventRecorder
                       (mutation + event stream)        │
                                                        ▼
                                                 rollup_operation
                                                        │
                                                        ▼
                                                   Operation
                                                        │
                             ┌──────────────────────────┴───────────────────┐
                             ▼                                              ▼
                     operations[] signal                             OperationPlayer
                     (vis/tree-context)                              (component/view)
                             │                                              ▲
                             ▼                                              │
                     activeOperation ──▶ cursor ──▶ step_at ──▶ choreograph ─┤
                                       (vis/playback-context)                │
                                                                             ▼
                                                                     player.tween ──▶ shown pose
```

The replay is **not** done by mutating the tree. Each step already carries
the snapshot it describes, and the choreographer treats that snapshot as a
pure input to a scene builder.

## Core (`core/src/btree/`)

The data structure, mutation primitives, and the event stream. Knows nothing
about replay, dispatch, or UI.

- **Tree & types** — [btree.ts](core/src/btree/btree.ts) (`Key`, `NodeData`,
  `TreeData`, `Snapshot`, `Tree`). `AnimationID = number` (stable id per
  node/key for the duration of the tree).
- **Snapshot caching** — [btree.ts:52–64](core/src/btree/btree.ts). The
  `MUTATION_EVENTS` set names the events that bump the clone version:
  `insert_merge`, `split_slide_apart`, `grow_root`, `delete_key`. Non-
  mutation events reuse the cached clone. In particular, **the four
  split sub-events share one clone** — `split_slide_apart` is recorded
  first and owns the fresh clone.
- **Mutation primitives** —
  [`insert_into_leaf`](core/src/btree/btree.ts) emits `insert_widen`
  then `insert_merge`; [`split`](core/src/btree/btree.ts) performs the
  structural change but **records nothing** — recording is the caller's
  job so the first event the UI sees already reflects a fully-connected
  tree. [`absorb_split`](core/src/btree/btree.ts) and
  [`grow_root`](core/src/btree/btree.ts) run `record_split_phases`
  (emits four split sub-events) then record `insert_merge` or
  `grow_root` respectively.
- **Insert path emissions** — `insert_bottom_up` and `insert_top_down`
  emit `visit_insert` on entry and `descend` before recursion, so the
  UI can "park a probe" above the current node and slide it between
  nodes during the descent.
- **Empty-tree fast path** — [btree.ts:214–221](core/src/btree/btree.ts).
  Inserting into an empty tree creates a leaf **with the key already
  inside** and records just one `grow_root` event — no `visit_insert` /
  `insert_widen` / `insert_merge` triple, so there's no probe animation
  for the first key.
- **Event union** — [events.ts](core/src/btree/events.ts). Current
  variants:
  - Reads: `visit_read`, `found`, `not_found`, `compare`, `descend`,
    `ascend`.
  - Insert bookkeeping: `visit_insert`, `insert_widen`, `insert_merge`,
    `insert_median_found`, `insert_node_is_overflowing`.
  - Split (four phases, same payload, interpreted by the choreographer):
    `split_slide_apart` → `split_pull_median` → `split_parent_grows` →
    `split_connect_to_children`.
  - `grow_root`, reserved `delete_key` / `emit`.

## Component (`component/src/`)

Everything the visualiser sees of the tree model. One re-export surface so
`vis` only ever imports from `"component"`.

### Dispatch + operation shape

- **`dispatch(tree, req)`** — [dispatch.ts](component/src/dispatch.ts).
  Allocates a `Key` for inserts up front (so the id/value map is
  recoverable even when the value is a duplicate and the key never
  enters the tree), runs the mutation, and rolls up events into an
  `Operation`. The allocated keys are attached to the result as
  `InsertResult.key` / `BulkInsertResult.keys`.
- **`Operation`** — [operation.ts](component/src/operation.ts). Core's
  `BTreeOperation` decorated with `request` and `result`. `step_at(op, i)`
  is the entire "replay driver" surface — each `Step` carries the
  snapshot the UI should render.

### Pose, Scene, Layout

Scene → Pose is the pure half of the pipeline. The choreographer builds
scenes; the player + renderer consume poses.

- **`Pose` and `Keyframe`** — [pose.ts](component/src/pose.ts). A pose is
  a fully laid-out frame keyed by stable `AnimationID`s plus an optional
  floating `ProbeBox` (the value being inserted during a descent) and a
  `hidden` set of DOM ids that should not render (used e.g. to mask the
  parent→child edges during the orphan phases of split). A keyframe is
  `{ pose, weight, ease }` — one phase of a step's animation.
- **`Scene`** — [scene.ts](component/src/scene.ts). A logical description
  of what to draw at one moment in time. Has no coordinates. Field by
  field:
  - `root`, `nodes` — the underlying tree. Started from a snapshot via
    `scene_from_snapshot` which deep-copies the arrays so builders
    below can mutate without touching the snapshot.
  - `probe?: ProbeState` — the insert probe, with an `above_node` or
    `in_slot` attachment.
  - `floating_keys?: FloatingKey[]` — keys rendered outside any node's
    `data_keys` (e.g. the median pulled out of the splitting node). Two
    anchor kinds: `between_children` (midpoint of two sibling subtrees
    at the children row) and `at_point` (explicit x, y, pre-shift).
  - `hidden_edges?: Set<string>` — edge ids the layout should still
    compute (so geometry stays consistent across phases) but the pose
    should mark hidden.
  - `node_overrides?` — after normal layout, each `(id, pos)` shifts the
    *subtree* rooted at `id` so its node sits at `pos`. Used to spread
    L and R apart in `split_slide_apart`.
  - `render_as_leaf?: Set<AnimationID>` — the node renders without its
    slot row (`node_h = CELL_H`). The slot cells are still placed but
    with `h = 0` so the lerp to normal rendering grows them from a flat
    line into a full cell. Used for the parent during the "children
    detached" phases of a fresh-root split so phase 4 reads as "the
    parent extends downwards".
  - `extra_nodes?` — subtrees to render *outside* the normal root
    traversal, at explicit `(x, y)`. Used by `split_slide_apart` to
    show the new right half as an orphan sibling of the shrunken left
    before the parent has absorbed it.
  - Builders: `attach_probe_above`, `reserve_slot`,
    `remove_key_from_node`, `remove_child_from_node`,
    `with_floating_key`, `with_hidden_edges`, `override_node_pos`,
    `render_node_as_leaf`, `with_extra_node`.
- **`layout_scene(scene) → Pose`** — [scene.ts](component/src/scene.ts).
  Four stages, each pure:
  1. **measure** every subtree's bounding box (recursive).
  2. **place** nodes/keys/slot-cells/edges, with the tree sitting below
     a fixed probe-band of vertical padding so the pose's y position
     doesn't jump when the probe comes and goes.
  3. **place extras** — apply `node_overrides` (subtree shifts) then
     `extra_nodes` (orphan subtrees) then the probe then floating keys.
  4. **normalize** — bounding-box across *every* placed element
     (including overrides, extras, probe, floating), then shift so
     `(minX, minY) = (0, 0)` and emit the pose's `width`/`height`.

### Choreographer

- **`choreograph(ctx) → Keyframe[]`** —
  [choreograph.ts](component/src/choreograph.ts). Switch on the event
  kind. Insert-path events attach/park the probe:
  - `visit_insert` / `descend` → probe above the current node.
  - `insert_widen` → `reserve_slot` so the leaf already renders at its
    final width, with the probe filling the reserved cell. The pose
    hides the placeholder key by id.
  - `insert_merge` / `insert_median_found` → plain snapshot, no probe
    (the key is in the tree now).
  - Default (read events, overflow marker) → plain snapshot. If the
    operation is still carrying a probe, `current_probe_target` walks
    back to the most recent `visit_insert` / `descend` / `insert_widen`
    and re-attaches, so compares and visit_reads during a descent
    don't drop the probe.
  - Each of the four split events delegates to `split_phase_scene`.
- **Split, four phases** — `split_phase_scene`:
  1. **`split_slide_apart`** — parent stripped back to its pre-split
     size (median removed from `data_keys`, right removed from
     `children`). The right half is `with_extra_node`'d at
     `L.right + SPREAD` (where `SPREAD = CELL_W + 2 * H_GAP`, chosen so
     the open channel between L and R has room for the median plus one
     H_GAP on each side). Any siblings right of L in the stripped
     parent shift by `SPREAD + r_w` so they don't collide. For a
     fresh root (parent is new and has no grandparent), the parent is
     elided entirely via `scene.root = ev.node`. The floating median
     is anchored in the middle of the channel at L's row — centred
     between L and R with H_GAP of gap on both sides.
  2. **`split_pull_median`** — same scaffold as phase 1 except the
     floating median's y is lifted to the midpoint between the
     children row and the natural parent row (or held in place if the
     parent isn't visible). The lerp from phase 1 reads as "the median
     climbs toward where it's about to land."
  3. **`split_parent_grows`** — the natural (fully-connected) snapshot
     with the parent→L and parent→R edges hidden. The lerp from phase
     2 pulls the median the rest of the way into the parent slot and
     widens the parent in one coherent motion. The right half slides
     from its orphan position into its real child slot.
  4. **`split_connect_to_children`** — the natural snapshot with
     nothing stripped and no edges hidden. Edges snap in; if the
     parent was render-as-leaf during phase 3, the slot row extends
     downwards here.
- **`resolve_probe_at(op, index)`** — walks back to the most recent
  `visit_insert` and returns `{id, value}`, with the value looked up
  from the operation's result (`Insert`/`BulkInsert`) — a snapshot
  lookup would miss values that were duplicates and never entered the
  tree. Returns undefined once we hit `insert_merge` /
  `insert_median_found` (the probe has dissolved into the tree).

### Player

- **`create_player(stepMs)`** — [player.ts](component/src/player.ts).
  JS-driven `requestAnimationFrame` tween between poses.
  `tween_through(from, kfs)` chains all the choreographer's keyframes:
  the first one tweens `from → kfs[0].pose`, each subsequent one takes
  `kfs[i-1].pose → kfs[i].pose`, and each phase's duration is
  `stepMs * weight`. Non-contiguous index jumps (scrubs, operation
  changes) snap directly to the last keyframe's pose so the user
  doesn't see an animation of a step they didn't play into.
- **`lerp_pose(from, to, t)`**:
  - **Nodes** — position interpolated. `w` interpolated **except for
    leaves**: a leaf's width changes in integer cell counts (insert
    widen, split shrink) and interpolating produces an awkward half-
    cell rect, so leaves snap.
  - **Keys** — fully interpolated (position + size).
  - **Slots, edges** — fully interpolated.
  - **Probe** — fully interpolated. If one pose has it and the other
    doesn't, we use whichever exists (so the probe appears or
    disappears cleanly in one tick rather than popping mid-tween).
  - **Width / height** — pose dimensions are interpolated so the SVG
    container follows the tween.
- The player reads `shown()` inside `tween_through`. The driving
  `createEffect` in `view.tsx` wraps `player.update(...)` in `untrack`
  so the `shown` reads don't register as effect dependencies —
  otherwise every rAF tick would re-fire the effect and snap the tween
  to its destination.

### View

- **`<OperationPlayer op? index? stepMs? onLayout? onAnimationCenter? />`** —
  [view.tsx](component/src/view.tsx).
  - Memoises `resolve_probe_at(op, index)` per step.
  - Memoises `highlight_at(op, index)` per step for colour emphasis
    (not for geometry — geometry comes from the pose).
  - On `(op, index, probe_meta)` change, builds a `Ctx` and calls
    `player.update(ctx, prev_index)` inside `untrack`.
  - Renders four `<For>` loops keyed by stable id (node, slot, key,
    edge) plus a `<Show>` for the probe. SVG `width`/`height` and
    `onLayout` are driven by the *interpolated* pose, so the container
    tweens along with the content.
- The `<rect>` / `<g>` elements use plain inline transforms — no CSS
  transitions. All motion comes from Solid re-rendering with the
  player's interpolated values each rAF.
- **`highlight_from(event)`** — [highlight.ts](component/src/highlight.ts).
  Pure event → `{nodes, keys, edges}` sets. Covers every current event
  variant including the four split sub-events (same payload shape).

## Where each concern lives — quick lookup

| Concern                                       | File                                                                 |
| --------------------------------------------- | -------------------------------------------------------------------- |
| B-tree mutation + split/insert emissions      | [core/src/btree/btree.ts](core/src/btree/btree.ts)                   |
| Event union                                   | [core/src/btree/events.ts](core/src/btree/events.ts)                 |
| Snapshot cache + mutation markers             | [core/src/btree/btree.ts:52–64](core/src/btree/btree.ts)             |
| Dispatch + id-preserving result               | [component/src/dispatch.ts](component/src/dispatch.ts)               |
| `Pose` / `Keyframe` / `ProbeBox` types        | [component/src/pose.ts](component/src/pose.ts)                       |
| Scene type + builders + `layout_scene`        | [component/src/scene.ts](component/src/scene.ts)                     |
| Event → keyframes                             | [component/src/choreograph.ts](component/src/choreograph.ts)         |
| Multi-phase rAF player                        | [component/src/player.ts](component/src/player.ts)                   |
| Easing functions                              | [component/src/ease.ts](component/src/ease.ts)                       |
| SVG renderer + layout constants + box types   | [component/src/view.tsx](component/src/view.tsx)                     |
| Event → highlight sets                        | [component/src/highlight.ts](component/src/highlight.ts)             |
| Operation history, active op                  | [vis/src/tree-context.tsx](vis/src/tree-context.tsx)                 |
| Playback cursor + clock                       | [vis/src/playback-context.tsx](vis/src/playback-context.tsx)         |
| SVG/PNG capture utility                       | [vis/src/dev_panel/capture.ts](vis/src/dev_panel/capture.ts)         |

## Invariants worth remembering

- The four split sub-events share one post-split snapshot clone.
  `split_slide_apart` is the first-emitted mutation marker; the others
  reuse its cache.
- Scene builders are pure and compositional. `layout_scene` only reads
  from the scene — no cross-call state.
- Node widths lerp for internal nodes but snap for leaves (integer cell
  counts).
- The player's `shown` signal is read inside its tween loop; the view's
  effect must `untrack` the `player.update` call or every rAF tick will
  cancel the ongoing tween and snap to destination.
- `fanout ≥ 2` is enforced; `top_down + fanout = 2` is a hard error;
  `bottom_up + fanout = 2` is allowed but warned.
- `vis` has zero imports from `"core"` — everything flows through
  `"component"`.
