// We call them BTreeEvents to avoid conflicts with the DOM Event interface.

import type { AnimationID } from "../animation/id_generator";
import type { Snapshot } from "./btree";

export type SplitKind = "btree" | "bplus_leaf" | "bplus_internal";

export type BTreeEvent =
  // markers
  | { t: "insert_start"; value: number }
  // read events
  | { t: "visit"; node: AnimationID }
  | { t: "found"; node: AnimationID; key: AnimationID }
  | { t: "not_found"; node: AnimationID }
  | {
      t: "compare";
      node: AnimationID;
      key_id: AnimationID;
      lo: number;
      hi: number;
    }
  | { t: "descend"; from: AnimationID; to: AnimationID; slot: number }
  | { t: "ascend"; from: AnimationID; to: AnimationID }
  // mutation events
  | {
      t: "insert_key";
      node: AnimationID;
      key: AnimationID;
      index: number;
    }
  | {
      t: "split";
      node: AnimationID;
      right: AnimationID;
      median: AnimationID;
      copy?: AnimationID;
      kind: SplitKind;
    }
  | { t: "grow_root"; old_root: AnimationID | null; new_root: AnimationID }
  // reserved — not emitted yet, exposed so UI switches stay exhaustive
  | { t: "delete_key"; node: AnimationID; key: AnimationID; index: number }
  | { t: "emit"; node: AnimationID; key: AnimationID };

export type Step = {
  snapshot: Snapshot;
  event: BTreeEvent;
};

export type BTreeOperationKind =
  "search" | "insert" | "bulk_insert" | "delete" | "range_search";

export type BTreeOperation = {
  kind: BTreeOperationKind;
  steps: Step[];
  final: Snapshot;
};

export interface BTreeEventRecorder {
  /**
   * `snapshot` is a thunk because taking a snapshot is expensive. Recorders
   * that don't need it (e.g. the silent one used for init-insert runs) can
   * simply never call it.
   */
  record(event: BTreeEvent, snapshot: () => Snapshot): void;
  clear(): void;
  rollup_operation(kind: BTreeOperationKind, final: Snapshot): BTreeOperation;
}
