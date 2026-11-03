import { describe, expect, it } from "vitest";
import { Tree, type TreeConfig } from "core";
import { FlybyRecorder } from "./flyby_recorder";

const base_config: TreeConfig = {
  fanout: 4,
  insert_mode: "bottom_up",
  search_mode: "linear",
  inner_nodes_have_data: true,
};

describe("FlybyRecorder", () => {
  it("counts events through tree.insert", () => {
    const recorder = new FlybyRecorder();
    const tree = new Tree(base_config, recorder);
    for (const value of [10, 20, 5, 30, 1]) {
      tree.insert({ id: tree.ids.allocate_id(), value });
    }
    // At minimum one grow_root for the first-insert fast path.
    expect(recorder.total.grow_root).toBeGreaterThanOrEqual(1);
    // Every subsequent insert produces a visit_insert.
    expect(recorder.total.visit_insert).toBeGreaterThanOrEqual(4);
    // Fanout=4 and 5 keys forces at least one split.
    expect(recorder.total.split_slide_apart).toBeGreaterThanOrEqual(1);
  });

  it("rolls up per-operation counts and clears the running counter", () => {
    const recorder = new FlybyRecorder();
    const tree = new Tree(base_config, recorder);

    tree.insert({ id: tree.ids.allocate_id(), value: 1 });
    recorder.rollup_operation("insert", tree.snapshot());

    tree.insert({ id: tree.ids.allocate_id(), value: 2 });
    recorder.rollup_operation("insert", tree.snapshot());

    expect(recorder.per_operation).toHaveLength(2);
    expect(recorder.per_operation[0].kind).toBe("insert");
    // First insert into empty tree: single grow_root, no visit_insert.
    expect(recorder.per_operation[0].counts.grow_root).toBe(1);
    expect(recorder.per_operation[0].counts.visit_insert).toBe(0);
    // Second insert exercises the real insert path.
    expect(recorder.per_operation[1].counts.visit_insert).toBeGreaterThanOrEqual(
      1,
    );
    expect(recorder.per_operation[1].counts.grow_root).toBe(0);
  });

  it("clear() resets all state", () => {
    const recorder = new FlybyRecorder();
    const tree = new Tree(base_config, recorder);
    tree.insert({ id: tree.ids.allocate_id(), value: 1 });
    recorder.rollup_operation("insert", tree.snapshot());
    recorder.clear();
    expect(recorder.per_operation).toHaveLength(0);
    expect(recorder.total.grow_root).toBe(0);
  });
});
