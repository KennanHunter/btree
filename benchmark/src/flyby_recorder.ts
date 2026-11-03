import type {
  BTreeEvent,
  BTreeEventRecorder,
  BTreeOperation,
  BTreeOperationKind,
  Snapshot,
} from "core";

export type EventKind = BTreeEvent["t"];

export type EventCounts = Record<EventKind, number>;

const EVENT_KINDS: EventKind[] = [
  "visit_read",
  "found",
  "not_found",
  "compare",
  "descend",
  "ascend",
  "visit_insert",
  "insert_widen",
  "insert_merge",
  "insert_median_found",
  "insert_node_overfill",
  "split_pull_median",
  "split_parent_grows",
  "split_slide_apart",
  "split_connect_to_children",
  "grow_root",
  "delete_key",
  "emit",
];

export function empty_counts(): EventCounts {
  const out = {} as EventCounts;
  for (const k of EVENT_KINDS) out[k] = 0;
  return out;
}

export type OperationCounts = {
  kind: BTreeOperationKind;
  counts: EventCounts;
};

export class FlybyRecorder implements BTreeEventRecorder {
  readonly needs_snapshot = false;
  total: EventCounts = empty_counts();
  per_operation: OperationCounts[] = [];
  private current: EventCounts = empty_counts();

  record(event: BTreeEvent, _snapshot: () => Snapshot): void {
    this.total[event.t]++;
    this.current[event.t]++;
  }

  rollup_operation(kind: BTreeOperationKind, final?: Snapshot): BTreeOperation {
    this.per_operation.push({ kind, counts: this.current });
    this.current = empty_counts();
    return { kind, steps: [], final: final as Snapshot };
  }

  clear(): void {
    this.total = empty_counts();
    this.per_operation = [];
    this.current = empty_counts();
  }
}
