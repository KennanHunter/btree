// we call them BtreeEvents to avoid conflicts with DOM Event interface

import type { AnimationID } from "../animation/id_generator";

export type BTreeEvent = { t: "visit"; node: AnimationID };
// | {
//     t: "compare";
//     node: AnimationID;
//     key: AnimationID;
//     lo: number;
//     hi: number;
//   }
// | { t: "descend"; from: AnimationID; to: AnimationID; slot: number }
// | { t: "ascend"; from: AnimationID; to: AnimationID } // B-tree range scans returning to a parent
// | { t: "found"; node: AnimationID; key: AnimationID }
// | { t: "not_found"; node: AnimationID }
// | { t: "emit"; node: AnimationID; key: AnimationID } // range scan output
// | { t: "insert_key"; node: AnimationID; key: AnimationID; index: number }
// | {
//     t: "split";
//     node: AnimationID;
//     right: AnimationID;
//     median: AnimationID;
//     copy?: AnimationID; // B+ leaf: the new separator that goes up
//     kind: "btree" | "bplus_leaf" | "bplus_internal";
//   }
// | { t: "grow_root"; old_root: AnimationID; new_root: AnimationID };

export type BTreeEventRecorder = {
  record: (event: BTreeEvent) => {};
};
