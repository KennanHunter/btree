import type { BTreeOperation, SearchResult, Step } from "core";
import type { OpRequest } from "./dispatch";
import type { RangeSearchResult } from "./range";

export type InsertResult = {
  type: "Insert";
  value: number;
};

export type BulkInsertResult = {
  type: "BulkInsert";
  values: number[];
};

export type DeleteResult = {
  type: "Delete";
  value: number;
};

export type OperationResult =
  | SearchResult
  | InsertResult
  | BulkInsertResult
  | DeleteResult
  | RangeSearchResult;

// An Operation is a core `BTreeOperation` (kind + steps + final) decorated
// with the request that produced it and the typed result. The `kind` field
// is inherited from `BTreeOperation` — no need to re-declare it here.
export type Operation = BTreeOperation & {
  request: OpRequest;
  result: OperationResult;
};

export function step_count(op: Operation): number {
  return op.steps.length;
}

export function step_at(op: Operation, i: number): Step | undefined {
  return op.steps[i];
}
