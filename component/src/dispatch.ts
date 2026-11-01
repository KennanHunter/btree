import type { Tree } from "core";
import type { Operation, OperationResult } from "./operation";

export type SearchRequest = { kind: "search"; value: number };
export type InsertRequest = { kind: "insert"; value: number };
export type BulkInsertRequest = { kind: "bulk_insert"; values: number[] };
export type DeleteRequest = { kind: "delete"; value: number };
export type RangeSearchRequest = {
  kind: "range_search";
  lo: number;
  hi: number;
};

export type OpRequest =
  | SearchRequest
  | InsertRequest
  | BulkInsertRequest
  | DeleteRequest
  | RangeSearchRequest;

export class NotImplementedError extends Error {
  constructor(what: string) {
    super(`${what} is not implemented yet`);
    this.name = "NotImplementedError";
  }
}

export function dispatch(tree: Tree, req: OpRequest): Operation {
  switch (req.kind) {
    case "search":
      return run(tree, req, (t) => t.search(req.value));
    case "insert":
      return run(tree, req, (t) => {
        t.insert(req.value);
        return { type: "Insert", value: req.value };
      });
    case "bulk_insert":
      return run(tree, req, (t) => {
        for (const v of req.values) t.insert(v);
        return { type: "BulkInsert", values: req.values };
      });
    case "delete":
      throw new NotImplementedError("delete");
    case "range_search":
      throw new NotImplementedError("range_search");
  }
}

function run(
  tree: Tree,
  req: OpRequest,
  mutate: (t: Tree) => OperationResult,
): Operation {
  tree.event_recorder.clear();
  const result = mutate(tree);
  const op = tree.event_recorder.rollup_operation(req.kind, tree.snapshot());
  return { ...op, request: req, result };
}
