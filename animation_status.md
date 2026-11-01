# Animation pipeline — who owns what

End-to-end: a user action produces a dispatched operation, which carries a
list of `(snapshot, event)` steps; the UI holds a cursor over those steps
and renders the one at the cursor through `OperationPlayer`.

```
UI action ──▶ dispatch() ──▶ Tree.insert / Tree.search
                               │  (mutations + events)
                               ▼
                     BTreeEventRecorder.record
                       (event, snapshot thunk)
                               │
                               ▼
                        rollup_operation ──▶ Operation
                                              │
                             ┌────────────────┴─────────────────┐
                             ▼                                  ▼
                      operations[] signal                 OperationPlayer
                      (tree-context)                      (component/view)
                             │                                  ▲
                             ▼                                  │
                      activeOperation ──▶ cursor ──▶ step_at ───┘
                                       (playback-context, via PlaybackBridge)
```

## Layer responsibilities

### `core` — raw tree + event emission

The data structure and its event stream. Knows nothing about replay,
dispatch, or UI.

- **Tree & data types** — [core/src/btree/btree.ts:12](core/src/btree/btree.ts)
  (`Key`, `NodeData`, `TreeData`, `Snapshot`, `Tree`).
- **Snapshot caching + mutation-bumped version counter** —
  [core/src/btree/btree.ts:49](core/src/btree/btree.ts) (`MUTATION_EVENTS`
  set), [btree.ts:66](core/src/btree/btree.ts) (`version` /
  `cached_version` / `cached_snapshot`), [btree.ts:83](core/src/btree/btree.ts)
  (`snapshot()` returns the cached clone when `version` is unchanged),
  [btree.ts:92](core/src/btree/btree.ts) (`record()` bumps `version` only on
  mutation events). A run of read events (search) shares one clone; each
  mutation forces a fresh one.
- **Shared predicates / helpers** —
  [btree.ts:126](core/src/btree/btree.ts) (`is_node_bplus_internal`),
  [btree.ts:130](core/src/btree/btree.ts) (`holds_key` — true only in
  leaves or classic-B-tree internals; B+ internal matches are routing hits),
  [btree.ts:138](core/src/btree/btree.ts) (`child_index_for` — one place
  for the B+ "match → step right" and post-split "value > median → step
  right" rules), [btree.ts:155](core/src/btree/btree.ts) (`find_position`
  — the single `compare`-recording site shared by linear and binary
  search).
- **Mutation primitives + their events** —
  [btree.ts:179](core/src/btree/btree.ts) (`insert_into_leaf` → emits
  `insert_key`), [btree.ts:188](core/src/btree/btree.ts) (`absorb_split`
  → parent-side splice + `insert_key` for the median),
  [btree.ts:200](core/src/btree/btree.ts) (`insert` — emits
  `insert_start` marker; empty-tree root path goes through
  `new_node` + `insert_into_leaf`),
  [btree.ts:226](core/src/btree/btree.ts) (`grow_root` — emits
  `grow_root`), [btree.ts:split](core/src/btree/btree.ts) (emits `split`
  with `kind: btree | bplus_leaf | bplus_internal`).
- **Read events** emitted during `search` / `search_in_node` —
  `visit`, `compare`, `descend`, `found`, `not_found`.
- **Event + Step + Operation shapes** —
  [core/src/btree/events.ts:8](core/src/btree/events.ts) (`BTreeEvent`:
  `insert_start`, read events, mutation events, reserved `delete_key` /
  `emit`),
  [events.ts:42](core/src/btree/events.ts) (`Step = { snapshot, event }`),
  [events.ts:50](core/src/btree/events.ts)
  (`BTreeOperation = { kind, steps, final }`).
- **`BTreeEventRecorder` interface** —
  [events.ts:56](core/src/btree/events.ts). The contract is
  `record(event, snapshot: () => Snapshot)` (thunk, so a silent recorder
  pays zero clones) + `rollup_operation(kind, final)`. Core does not supply
  an implementation.
- **Config checks** —
  [core/src/btree/config.ts](core/src/btree/config.ts).
  `check_config_for_errors` enforces `fanout ≥ 2` and blocks the
  known-broken combos (top-down requires even fanout; top-down + fanout = 2
  returns the `TopDownFanoutTwo` error).
  `check_config_for_warnings` returns a flat
  `TreeConfigurationWarning[]` — currently fires `FanoutTwoBottomUp` at
  fanout 2 bottom-up with the long-form 2-3 tree advisory.

Not here: a recorder instance, dispatch, result wrapping, rendering.

### `component` — dispatch, operation shape, Solid renderer

Everything the visualiser sees of the tree model. One re-export surface so
`vis` only imports from `"component"`.

- **Package entry** —
  [component/src/index.ts](component/src/index.ts). Re-exports every
  core type (`Tree`, `Snapshot`, `Key`, `BTreeEvent`, …), the two config
  checkers, and the local types below.
- **`build_tree(config, init_values?)`** —
  [component/src/build.ts:46](component/src/build.ts). Wraps
  `create_b_tree` with a `silent_recorder` during init so the init-insert
  run performs **zero** clones; then swaps the tree's recorder to a
  `recording_recorder` for subsequent dispatches. The UI never constructs
  a `BTreeEventRecorder` itself.
- **`dispatch(tree, req)`** —
  [component/src/dispatch.ts:28](component/src/dispatch.ts). Single entry
  for every tree action. Internals via `run()`
  [dispatch.ts:49](component/src/dispatch.ts): `clear` →
  `req`-specific mutation → `rollup_operation(req.kind, tree.snapshot())`
  → spread into `Operation` with `request` + `result`.
- **`OpRequest` union** —
  [dispatch.ts:14](component/src/dispatch.ts).
  `search`, `insert`, `bulk_insert` are live; `delete` and `range_search`
  are reserved types that throw `NotImplementedError`.
- **`Operation = BTreeOperation & { request, result }`** —
  [component/src/operation.ts:30](component/src/operation.ts). The `kind`,
  `steps`, `final` fields are inherited from core's `BTreeOperation`; no
  restatement.
- **`step_at(op, i)` / `step_count(op)`** —
  [operation.ts:35](component/src/operation.ts). The entire "replay
  driver" surface — each `Step` already carries the snapshot the UI
  should render.
- **Shapes & measurement** —
  [component/src/shapes.ts:56](component/src/shapes.ts) (`layout`),
  [shapes.ts:155](component/src/shapes.ts) (`build_shapes`),
  [shapes.ts:163](component/src/shapes.ts) (`measure`). Pure `TreeData` →
  tagged `Shape[]` (each shape carries its `node` / `key` / `slot`), so
  highlighting is a lookup, not a diff.
- **Highlight derivation** —
  [component/src/highlight.ts:13](component/src/highlight.ts).
  `highlight_from(event)` → `{ nodes, keys, edges }` sets covering every
  variant (`insert_start` is a no-op marker; the follow-up mutation
  events carry the emphasis).
- **`<OperationPlayer op? index? fallback? onLayout? />`** —
  [component/src/view.tsx:40](component/src/view.tsx). The exposed Solid
  component. Picks the frame
  (`step_at(op, index).snapshot` → `op.final` → `fallback`), computes
  shapes, overlays the step's highlight, renders SVG. Calls `onLayout`
  with the laid-out dimensions so pan/zoom can live outside.

Not here: operation history, playback clock, pan/zoom, local storage,
Solid contexts.

### `vis/src/tree-context.tsx` — operation history + tree ownership

State that outlives one dispatch: the current tree, past operations, the
active one. Hydrates `treeConfig` / `initValues` from
`local-storage-context`.

- **Builds / rebuilds the tree** via `build_tree` on mount, on config
  change, on `clearData` —
  [tree-context.tsx:84](vis/src/tree-context.tsx),
  [tree-context.tsx:113](vis/src/tree-context.tsx) (`updateConfig`),
  [tree-context.tsx:149](vis/src/tree-context.tsx) (`clearData`).
- **`operations: Accessor<Operation[]>`** signal —
  [tree-context.tsx:80](vis/src/tree-context.tsx). Appended through
  `pushOperation` [tree-context.tsx:88](vis/src/tree-context.tsx).
- **`activeOperation`** = latest op —
  [tree-context.tsx:91](vis/src/tree-context.tsx). What the `PlaybackBridge`
  (and the eventual viz rewrite) binds to.
- **`insertValues()`** — [tree-context.tsx:123](vis/src/tree-context.tsx).
  Dispatches `{ kind: "insert", value }` per value and pushes each
  resulting `Operation`.
- **`draftError` / `draftWarnings`** —
  [tree-context.tsx:100](vis/src/tree-context.tsx),
  [tree-context.tsx:107](vis/src/tree-context.tsx). Reactive wrappers
  over the two core checkers; `ConfigTab` renders both.
- **`SearchTab`** calls `dispatch` directly and uses the exported
  `pushOperation` —
  [vis/src/right_panel/SearchTab.tsx:19](vis/src/right_panel/SearchTab.tsx).

Not here: playback cursor, rendering, how an operation becomes a frame.

### `vis/src/playback-context.tsx` — cursor + clock

Generic timeline state, unaware of what's being played.

- `isPlaying`, `index`, `total`, `speed` signals + setters —
  [playback-context.tsx:30](vis/src/playback-context.tsx).
- `setIndex` is exported so the bridge can rewind on operation change —
  [playback-context.tsx:17](vis/src/playback-context.tsx).
- `stepForward` / `stepBack` / `togglePlay` + the autoplay interval —
  [playback-context.tsx:34–63](vis/src/playback-context.tsx).

Explicitly decoupled from `tree-context`.

### `vis/src/PlaybackBridge.tsx` — the operation → timeline bridge

Renders nothing. Mounted once in `App` inside both providers (via a
fragment next to the `<AppShell>`) so the binding survives left-panel
tab switches.

- Pulls `activeOperation` from `tree-context` and
  `setTotal` / `setIndex` from `playback-context`.
- `createEffect`: whenever `activeOperation` changes, rewinds the cursor
  to 0 and resizes the timeline to `op.steps.length` (or 0 if no op).

### `vis/src/left_panel/EventsTab.tsx` — the event list view

Pure renderer now; no effects.

- Reads `activeOperation` and the playback `index`.
- Renders one `<li>` per `step.event` of the active op, with the active
  class driven by `index()`.
- `describe(event)` is the event → human-string function and has a case
  per `BTreeEvent` variant (including `insert_start`, `split`, `grow_root`,
  reserved `delete_key` / `emit`).

### `vis/src/right_panel/ConfigTab.tsx` — config form + diagnostics

- Renders the fanout / insert_mode / search_mode / inner_nodes_have_data
  inputs. `fanout` input `min` is 2.
- Shows `draftError()` in a red callout and iterates `draftWarnings()`
  through a warm-toned callout
  ([vis/src/ui/Error.module.css](vis/src/ui/Error.module.css) —
  `.error` / `.warning` / `.inline`). Line-height / sizing matches the
  info panel.
- The `Update configuration` button is disabled when the draft has an
  error.

### `vis/src/viz/TreeCanvas.tsx` — pan / zoom / fit

Currently renders `tree.data` directly through local `layout.ts` /
`TreeSvg`. Does not consume operations yet — that's the next migration.
Pan/zoom/fit math lives here
([TreeCanvas.tsx:47–63](vis/src/viz/TreeCanvas.tsx)).

Layout note: on desktop (≥ 701 px) `.main` spans the icon row too (see
[vis/src/layout/AppShell.module.css](vis/src/layout/AppShell.module.css)),
so the SVG canvas extends under the icons. The icon row sits at
`z-index: 2` with `pointer-events: none` so clicks hit the icons but
pan/zoom gestures pass through to the SVG between them.

Planned swap: `TreeCanvas` renders
`<OperationPlayer op={activeOperation()} index={index()} fallback={tree.data} onLayout={...} />`
and feeds `onLayout` dims into the existing fit math.

## Where each concern lives — quick lookup

| Concern                                   | File                                                              |
| ----------------------------------------- | ----------------------------------------------------------------- |
| B-tree mutation logic + helpers           | [core/src/btree/btree.ts](core/src/btree/btree.ts)                 |
| Event union + Step/Operation shape        | [core/src/btree/events.ts](core/src/btree/events.ts)               |
| Snapshot cache + version counter          | [core/src/btree/btree.ts:66](core/src/btree/btree.ts)              |
| Config errors + warnings                  | [core/src/btree/config.ts](core/src/btree/config.ts)               |
| UI-facing tree construction               | [component/src/build.ts](component/src/build.ts)                   |
| Running an op (clear → run → rollup)      | [component/src/dispatch.ts:49](component/src/dispatch.ts) (`run`)  |
| Operation = model op + request/result     | [component/src/operation.ts](component/src/operation.ts)           |
| Layout + measurement                      | [component/src/shapes.ts](component/src/shapes.ts)                 |
| Event → highlight sets                    | [component/src/highlight.ts](component/src/highlight.ts)           |
| Render a frame                            | [component/src/view.tsx](component/src/view.tsx)                   |
| Operation history, active op              | [vis/src/tree-context.tsx](vis/src/tree-context.tsx)               |
| Playback cursor + clock                   | [vis/src/playback-context.tsx](vis/src/playback-context.tsx)       |
| Active-op → timeline bridge               | [vis/src/PlaybackBridge.tsx](vis/src/PlaybackBridge.tsx)           |
| Event list view                           | [vis/src/left_panel/EventsTab.tsx](vis/src/left_panel/EventsTab.tsx) |
| Config form + warnings/errors UI          | [vis/src/right_panel/ConfigTab.tsx](vis/src/right_panel/ConfigTab.tsx) |
| Pan / zoom / fit                          | [vis/src/viz/TreeCanvas.tsx](vis/src/viz/TreeCanvas.tsx)           |
| Shell layout (SVG spans icon row)         | [vis/src/layout/AppShell.module.css](vis/src/layout/AppShell.module.css) |

## Invariants worth remembering

- Nothing outside `core` constructs a `BTreeEventRecorder`.
  `component/build.ts` creates them for the UI (silent during init,
  recording for dispatches); `core/src/btree/btree.test.ts` instantiates a
  test-only one.
- `record()` takes a snapshot **thunk**, so a recorder that doesn't need
  snapshots pays zero clones. `Tree.record` caches by `version`, so a
  dispatched operation performs **one** clone per mutation event and
  **zero** extra clones for read events in between.
- `vis` has zero imports from `"core"` — everything flows through
  `"component"`.
- `step_at(op, i).snapshot` is sufficient to render step `i`. Events are
  highlight metadata only; there is no mutation to replay.
- `fanout ≥ 2` is enforced; `top_down + fanout = 2` is a hard error
  (empty-node explosion); `bottom_up + fanout = 2` is allowed but warned.
- The `PlaybackBridge` is the only place that writes `index` / `total`
  from an operation — the Events tab is purely a view.
