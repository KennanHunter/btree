// We call them BTreeEvents to avoid conflicts with the DOM Event interface.

import type { AnimationID } from "../animation/id_generator";
import type { Snapshot } from "./btree";

export type SplitKind = "btree" | "bplus_leaf" | "bplus_internal";

export type BTreeEvent =
  // read events
  | { t: "visit_read"; node: AnimationID }
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
  // Emitted immediately before a `descend` — pure UI beat that lets the
  // target child light up for one step while the probe is still parked
  // above the parent. Makes the separator → child relationship explicit:
  // you see the compared key, then the chosen child, then the walk down.
  | {
      t: "select_descent_child";
      from: AnimationID;
      to: AnimationID;
      slot: number;
    }
  | { t: "ascend"; from: AnimationID; to: AnimationID }
  // Insert events
  | { t: "visit_insert"; node_id: AnimationID; value_id: AnimationID }
  | {
      t: "insert_widen";
      node: AnimationID;
      key: AnimationID;
      index: number;
    }
  | {
      t: "insert_merge";
      node: AnimationID;
      key: AnimationID;
      index: number;
    }
  | {
      t: "insert_median_found";
      node: AnimationID;
      key: AnimationID;
      index: number;
    }
  // Emitted the instant a leaf exceeds fanout — just before the split
  // runs. Pure UI signal (no mutation on its own); the choreographer
  // uses it to flash the overfull node red and shake it.
  | {
      t: "insert_node_overfill";
      node: AnimationID;
    }
  // Split is emitted as four sequential events — all share the same
  // (fully-connected) snapshot but drive distinct keyframes in the UI:
  //   split_slide_apart    — the overflowing node visibly splits into two
  //                          halves that slide apart (parent unchanged,
  //                          median not yet distinct)
  //   split_pull_median    — the median emerges and floats between the
  //                          two halves (parent still unchanged)
  //   split_parent_grows   — parent widens to K+1 and absorbs the median;
  //                          right becomes a real child (edges still hidden)
  //   split_connect_to_children — children settle back and edges appear
  | {
      t: "split_pull_median";
      node: AnimationID;
      right: AnimationID;
      median: AnimationID;
      copy?: AnimationID;
      kind: SplitKind;
    }
  | {
      t: "split_parent_grows";
      node: AnimationID;
      right: AnimationID;
      median: AnimationID;
      copy?: AnimationID;
      kind: SplitKind;
    }
  | {
      t: "split_slide_apart";
      node: AnimationID;
      right: AnimationID;
      median: AnimationID;
      copy?: AnimationID;
      kind: SplitKind;
    }
  | {
      t: "split_connect_to_children";
      node: AnimationID;
      right: AnimationID;
      median: AnimationID;
      copy?: AnimationID;
      kind: SplitKind;
    }
  // Emitted after a split that propagates to the root: a new root is
  // created above the former root and the split's right sibling. For a
  // first-ever insert into an empty tree, old_root is null and the new
  // root is simply the single-key leaf.
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
   * simply never call it. Set `needs_snapshot: false` to also skip the
   * per-event closure allocation.
   */
  needs_snapshot?: boolean;
  record(event: BTreeEvent, snapshot: () => Snapshot): void;
  clear(): void;
  rollup_operation(kind: BTreeOperationKind, final: Snapshot): BTreeOperation;
}
