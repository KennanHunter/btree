import type { BTreeOperation, Key, SearchResult, Step } from "#core";
import type { OpRequest } from "./dispatch";
import type { RangeSearchResult } from "./range";

export type InsertResult = {
  type: "Insert";
  value: number;
  // The Key record actually constructed for this insert — carries the
  // allocated id even when the value turns out to be a duplicate and the
  // key never makes it into the tree. UI uses it to resolve the probe's
  // display value by id.
  key: Key;
};

export type BulkInsertResult = {
  type: "BulkInsert";
  values: number[];
  keys: Key[];
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

export function describe_operation(op: Operation): string {
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

export function step_count(op: Operation): number {
  return op.steps.length;
}

export function step_at(op: Operation, i: number): Step | undefined {
  return op.steps[i];
}
