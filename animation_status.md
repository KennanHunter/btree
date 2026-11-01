# Animation pipeline — who owns what

End-to-end: a user action produces a dispatched operation, which carries a
list of `(snapshot, event)` steps; the UI holds a cursor over those steps
and renders the one at the cursor through `OperationPlayer`.

```
UI action ──▶ dispatch() ──▶ Tree mutates + emits events
                               │
                               ▼
                          BTreeEventRecorder
                       captures (event, snapshot)
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
                                       (playback-context)
```

## Layer responsibilities

### `core` — raw tree + event emission
*The data structure and the per-mutation event stream. Knows nothing about
replay, snapshots-per-step as a product, or UI.*

- **Tree & data types** — [core/src/btree/btree.ts:12](core/src/btree/btree.ts) (`Key`, `NodeData`, `TreeData`, `Snapshot`, `Tree`).
- **The private `record()` helper** that pairs every event with the tree's
  current snapshot — [core/src/btree/btree.ts:70](core/src/btree/btree.ts).
  Every mutation and traversal site calls `this.record(...)`; this is the
  single point that forces "snapshot per event".
- **Mutation events emitted at the mutation sites** —
  `grow_root` ([btree.ts:108](core/src/btree/btree.ts), [btree.ts:131](core/src/btree/btree.ts)),
  `insert_key` ([btree.ts:109](core/src/btree/btree.ts), [btree.ts:143](core/src/btree/btree.ts), [btree.ts:152](core/src/btree/btree.ts), [btree.ts:174](core/src/btree/btree.ts)),
  `split` ([btree.ts:180](core/src/btree/btree.ts)).
- **Read events** emitted during search —
  `compare`/`visit`/`descend`/`found`/`not_found` ([btree.ts:226](core/src/btree/btree.ts) onward).
- **Event + Step + Operation shapes** — [core/src/btree/events.ts:8](core/src/btree/events.ts) (`BTreeEvent`), [events.ts:42](core/src/btree/events.ts) (`Step`), [events.ts:50](core/src/btree/events.ts) (`BTreeOperation`).
- **`BTreeEventRecorder` interface** — [events.ts:56](core/src/btree/events.ts). The contract is `record(event, snapshot)` + `rollup_operation(kind, final)`; core does not supply an implementation.

What `core` does *not* do: own a recorder instance, decide when to clear/roll
up (the caller does), know about `OpRequest`/dispatch, or render anything.

### `component` — dispatch, operation shape, Solid renderer
*Everything the visualiser sees of the tree model.*

- **Package entry** — [component/src/index.ts](component/src/index.ts). Re-exports every type `vis` uses, so `vis` only imports from `"component"`.
- **`build_tree(config, init_values?)`** — [component/src/build.ts:38](component/src/build.ts). Wraps `create_b_tree` with a `silent_recorder` so the UI never constructs one. Init-insert events are dropped (not a dispatched op).
- **`dispatch(tree, req)`** — [component/src/dispatch.ts:28](component/src/dispatch.ts). Single entry for every tree action. Internals in `run()` at [dispatch.ts:49](component/src/dispatch.ts): clear recorder → mutate → `rollup_operation(req.kind, tree.snapshot())` → spread into `Operation`.
- **`OpRequest` union** — [dispatch.ts:14](component/src/dispatch.ts). `search`, `insert`, `bulk_insert` are live; `delete` and `range_search` are reserved types that throw `NotImplementedError`.
- **`Operation = BTreeOperation & { request, result }`** — [component/src/operation.ts:30](component/src/operation.ts). The `kind`, `steps`, `final` fields are inherited from core's `BTreeOperation`.
- **`step_at(op, i)` / `step_count(op)`** — [operation.ts:35](component/src/operation.ts). The entire "replay driver" surface. There is no `executeEvent` — each `Step` already carries the snapshot the UI should render.
- **Shapes & measurement** — [component/src/shapes.ts:56](component/src/shapes.ts) (`layout`), [shapes.ts:155](component/src/shapes.ts) (`build_shapes`), [shapes.ts:163](component/src/shapes.ts) (`measure`). Pure functions from `TreeData` to SVG shapes, each shape tagged with the `node`/`key`/`slot` it belongs to so highlighting is possible without diffing.
- **Highlight derivation** — [component/src/highlight.ts:13](component/src/highlight.ts). Maps a single `BTreeEvent` to `{ nodes, keys, edges }` sets covering every event variant.
- **`<OperationPlayer op={} index={} fallback={} onLayout={} />`** — [component/src/view.tsx:40](component/src/view.tsx). The exposed Solid component. Picks the frame (`step_at(op, index)` → fallback to `op.final` → fallback to `fallback`), computes shapes, computes highlights, renders the SVG. Reports layout dimensions to the parent via `onLayout` so pan/zoom can live outside.

What `component` does *not* do: hold the operation history, run a playback
clock, do pan/zoom, know about Solid contexts or local storage.

### `vis/src/tree-context.tsx` — operation history + tree ownership
*State that outlives one dispatch: the current tree, the list of past
operations, the active one.*

- **Builds / rebuilds the tree** via `build_tree` on mount, on config change, on `clearData` — [vis/src/tree-context.tsx:81](vis/src/tree-context.tsx), [tree-context.tsx:105](vis/src/tree-context.tsx), [tree-context.tsx:139](vis/src/tree-context.tsx).
- **`operations: Accessor<Operation[]>`** signal — [tree-context.tsx:77](vis/src/tree-context.tsx). Appended through `pushOperation` ([tree-context.tsx:85](vis/src/tree-context.tsx)).
- **`activeOperation`** = latest op — [tree-context.tsx:88](vis/src/tree-context.tsx). This is what EventsTab and (eventually) the renderer bind to.
- **`insertValues()`** — [tree-context.tsx:114](vis/src/tree-context.tsx). Dispatches `{ kind: "insert", value }` per value and pushes each resulting `Operation`.
- **`SearchTab`** calls `dispatch` directly and uses the exported `pushOperation` — [vis/src/right_panel/SearchTab.tsx:19](vis/src/right_panel/SearchTab.tsx).

What `tree-context` does *not* do: track a playback cursor, render, or know
how an operation becomes a frame.

### `vis/src/playback-context.tsx` — cursor + clock
*Generic timeline state, unaware of what's being played.*

- `isPlaying`, `index`, `total`, `speed` signals and their setters — [playback-context.tsx:30](vis/src/playback-context.tsx).
- `setIndex` is exported so consumers can rewind on operation change — [playback-context.tsx:17](vis/src/playback-context.tsx), [playback-context.tsx:72](vis/src/playback-context.tsx).
- `stepForward` / `stepBack` / `togglePlay` and the autoplay interval — [playback-context.tsx:34–63](vis/src/playback-context.tsx).

Explicitly decoupled from `tree-context`: this context does not know an
operation exists. The bridge happens in whichever UI chooses to drive it.

### `vis/src/left_panel/EventsTab.tsx` — the bridge
*The one place that joins `activeOperation` to the playback timeline.*

- Pulls `activeOperation` from `tree-context` and `setTotal`/`setIndex`/`index` from `playback-context` — [EventsTab.tsx:35](vis/src/left_panel/EventsTab.tsx).
- On every change of `activeOperation`, rewinds the cursor and resizes the timeline — [EventsTab.tsx:40–44](vis/src/left_panel/EventsTab.tsx).
- Renders one `<li>` per `step.event` of the active op, with the active class driven by `index()` — [EventsTab.tsx:60–75](vis/src/left_panel/EventsTab.tsx).
- `describe(event)` is the event → human-string function for the UI; it has a case per `BTreeEvent` variant — [EventsTab.tsx:7](vis/src/left_panel/EventsTab.tsx).

### `vis/src/viz/TreeCanvas.tsx` — pan / zoom / fit
*Currently renders `tree.data` directly through local `layout.ts` /
`TreeSvg`. Does not consume operations yet. Pan/zoom/fit math lives here
([TreeCanvas.tsx:47–63](vis/src/viz/TreeCanvas.tsx)) and will stay here when the renderer swap happens.*

The in-progress migration: `TreeCanvas` will stop using its local
`buildShapes` and render `<OperationPlayer op={activeOperation()} index={index()} fallback={tree.data} onLayout={...} />` instead, feeding `onLayout` dims into the existing fit math.

## Where each concern lives — quick lookup

| Concern                                | File                                                           |
| -------------------------------------- | -------------------------------------------------------------- |
| B-tree mutation logic                  | [core/src/btree/btree.ts](core/src/btree/btree.ts)              |
| Event variants + Step/Operation shape  | [core/src/btree/events.ts](core/src/btree/events.ts)            |
| Snapshot-per-event capture             | [core/src/btree/btree.ts:70](core/src/btree/btree.ts) (`Tree.record`) |
| UI-facing tree construction            | [component/src/build.ts](component/src/build.ts)                |
| Running an op (clear → run → rollup)   | [component/src/dispatch.ts:49](component/src/dispatch.ts) (`run`) |
| Operation = model op + request/result  | [component/src/operation.ts](component/src/operation.ts)        |
| Layout + measurement                   | [component/src/shapes.ts](component/src/shapes.ts)              |
| Event → highlight sets                 | [component/src/highlight.ts](component/src/highlight.ts)        |
| Render a frame                         | [component/src/view.tsx](component/src/view.tsx)                |
| Operation history, active op           | [vis/src/tree-context.tsx](vis/src/tree-context.tsx)            |
| Playback cursor + clock                | [vis/src/playback-context.tsx](vis/src/playback-context.tsx)    |
| Event list ↔ timeline binding          | [vis/src/left_panel/EventsTab.tsx](vis/src/left_panel/EventsTab.tsx) |
| Pan / zoom / fit                       | [vis/src/viz/TreeCanvas.tsx](vis/src/viz/TreeCanvas.tsx)        |

## Invariants worth remembering

- Nothing outside `core` constructs a `BTreeEventRecorder`. `component/build.ts` is the only place a real one is instantiated for the UI; `core/src/btree/btree.test.ts` instantiates a test-only one.
- Every `record()` call captures `this.snapshot()` — one `structuredClone` per event. If this becomes a cost, change it in `Tree.record` ([core/src/btree/btree.ts:70](core/src/btree/btree.ts)) without touching `component` or `vis`.
- `vis` has zero imports from `"core"` — everything flows through `"component"`.
- `step_at(op, i).snapshot` is sufficient to render step `i`. Events are
  highlight metadata only; there is no mutation to replay.
