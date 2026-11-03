import { Tree, type TreeConfig } from "core";
import {
  empty_counts,
  FlybyRecorder,
  type EventCounts,
  type OperationCounts,
} from "./flyby_recorder";
import { compute_stats, type TreeStats } from "./tree_stats";
import type { Workload } from "./workloads";

export type KindAggregate = {
  count: number;
  totals: EventCounts;
  avg: EventCounts;
};

export type BenchmarkRow = {
  config: TreeConfig;
  workload: string;
  size: number;
  final_stats: TreeStats;
  totals: EventCounts;
  per_kind: {
    insert: KindAggregate;
    search: KindAggregate;
  };
};

export function run_one(config: TreeConfig, workload: Workload): BenchmarkRow {
  const recorder = new FlybyRecorder();
  const tree = new Tree(config, recorder);

  for (const value of workload.keys) {
    tree.insert({ id: tree.ids.allocate_id(), value });
    recorder.rollup_operation("insert");
  }

  const final_snapshot = tree.snapshot();

  // Searches over inserted values for comparison/descent stats.
  if (final_snapshot.root != null) {
    for (const value of workload.keys) {
      tree.search(value);
      recorder.rollup_operation("search");
    }
  }

  const per_kind = {
    insert: aggregate(recorder.per_operation, "insert"),
    search: aggregate(recorder.per_operation, "search"),
  };

  return {
    config,
    workload: workload.name,
    size: workload.keys.length,
    final_stats: compute_stats(final_snapshot, config),
    totals: recorder.total,
    per_kind,
  };
}

function aggregate(
  ops: OperationCounts[],
  kind: "insert" | "search",
): KindAggregate {
  const totals = empty_counts();
  let count = 0;
  for (const op of ops) {
    if (op.kind !== kind) continue;
    count++;
    for (const k of Object.keys(op.counts) as (keyof EventCounts)[]) {
      totals[k] += op.counts[k];
    }
  }
  const avg = empty_counts();
  if (count > 0) {
    for (const k of Object.keys(totals) as (keyof EventCounts)[]) {
      avg[k] = totals[k] / count;
    }
  }
  return { count, totals, avg };
}

export function run_matrix(
  configs: TreeConfig[],
  workloads: Workload[],
): BenchmarkRow[] {
  const rows: BenchmarkRow[] = [];
  for (const config of configs) {
    for (const workload of workloads) {
      rows.push(run_one(config, workload));
    }
  }
  return rows;
}
