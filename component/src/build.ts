import {
  create_b_tree,
  type BTreeEvent,
  type BTreeEventRecorder,
  type BTreeOperation,
  type BTreeOperationKind,
  type Snapshot,
  type Step,
  type Tree,
  type TreeConfig,
  type TreeConfigurationError,
} from "#core";
export type BuildResult =
  | { ok: true; tree: Tree }
  | { ok: false; error: TreeConfigurationError };

// Captures events but never materializes snapshots. Used while rolling up a
// dispatched Operation — `dispatch` calls `snapshot()` once at the end via
// `rollup_operation`, and we don't want extra clones for every intermediate
// read event.
export function recording_recorder(): BTreeEventRecorder {
  let steps: Step[] = [];
  return {
    record(event: BTreeEvent, snapshot: () => Snapshot) {
      steps.push({ event, snapshot: snapshot() });
    },
    clear() {
      steps = [];
    },
    rollup_operation(kind: BTreeOperationKind, final: Snapshot): BTreeOperation {
      const op = { kind, steps, final };
      steps = [];
      return op;
    },
  };
}

// Discards everything. The `snapshot` thunk is never called, so init-insert
// runs do zero `structuredClone`s.
function silent_recorder(): BTreeEventRecorder {
  return {
    needs_snapshot: false,
    record() {
      /* drop */
    },
    clear() {
      /* no state */
    },
    rollup_operation(kind: BTreeOperationKind, final: Snapshot): BTreeOperation {
      return { kind, steps: [], final };
    },
  };
}

export function build_tree(
  config: TreeConfig,
  init_values: number[] = [],
): BuildResult {
  const result = create_b_tree(config, silent_recorder());
  if (result.error) {
    return { ok: false, error: result };
  }
  for (const v of init_values)
    result.tree.insert({ value: v, id: result.tree.ids.allocate_id() });
  // Swap in a real recorder now that init is done; future dispatches want
  // their events captured.
  result.tree.event_recorder = recording_recorder();
  return { ok: true, tree: result.tree };
}

