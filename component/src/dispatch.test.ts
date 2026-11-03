import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  build_tree,
  dispatch,
  NotImplementedError,
  step_at,
  step_count,
  type TreeConfig,
} from ".";

const base: TreeConfig = {
  fanout: 4,
  insert_mode: "top_down",
  inner_nodes_have_data: true,
  search_mode: "binary",
};

function fresh(values: number[] = []) {
  const r = build_tree(base, values);
  if (!r.ok) throw new Error("unexpected build error");
  return r.tree;
}

describe("build_tree", () => {
  it("returns ok with an empty tree when no init values given", () => {
    const r = build_tree(base);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.tree.root_node()).toBeUndefined();
  });

  it("surfaces config errors as { ok: false }", () => {
    const r = build_tree({ ...base, fanout: 1, insert_mode: "bottom_up" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.type).toBe("FanoutTooLow");
  });
});

describe("dispatch(insert)", () => {
  it("returns an Operation whose steps describe the insert", () => {
    const tree = fresh();
    const op = dispatch(tree, { kind: "insert", value: 5 });
    expect(op.kind).toBe("insert");
    expect(op.result).toMatchObject({ type: "Insert", value: 5 });
    expect(step_count(op)).toBeGreaterThan(0);
    expect(step_at(op, 0)).toBeDefined();
  });

  it("each step snapshot has the expected shape", () => {
    const tree = fresh();
    const op = dispatch(tree, { kind: "insert", value: 1 });
    for (const s of op.steps) {
      expect(s.snapshot).toHaveProperty("nodes");
      expect(s.event).toHaveProperty("t");
    }
  });

  it("final snapshot matches tree.snapshot()", () => {
    const tree = fresh();
    const op = dispatch(tree, { kind: "insert", value: 7 });
    expect(op.final).toEqual(tree.snapshot());
  });
});

describe("dispatch(search)", () => {
  it("finds an inserted value", () => {
    const tree = fresh();
    dispatch(tree, { kind: "insert", value: 10 });
    dispatch(tree, { kind: "insert", value: 20 });
    const op = dispatch(tree, { kind: "search", value: 20 });
    expect(op.kind).toBe("search");
    expect(op.result.type).toBe("Success");
    expect(step_count(op)).toBeGreaterThan(0);
  });

  it("misses when value isn't present", () => {
    const tree = fresh();
    dispatch(tree, { kind: "insert", value: 1 });
    const op = dispatch(tree, { kind: "search", value: 999 });
    expect(op.result.type).toBe("Missing");
  });
});

describe("snapshot caching", () => {
  let clone_count = 0;
  const originalClone = globalThis.structuredClone;
  beforeEach(() => {
    clone_count = 0;
    globalThis.structuredClone = ((v: unknown) => {
      clone_count++;
      return originalClone(v);
    }) as typeof structuredClone;
  });
  afterEach(() => {
    globalThis.structuredClone = originalClone;
  });

  it("build_tree with init values performs zero clones", () => {
    const r = build_tree(base, [5, 2, 8, 1, 3, 7, 10, 4, 6, 9]);
    expect(r.ok).toBe(true);
    expect(clone_count).toBe(0);
  });

  it("one search clones exactly once", () => {
    const tree = fresh([5, 2, 8, 1, 3, 7, 10, 4, 6, 9]);
    clone_count = 0;
    const op = dispatch(tree, { kind: "search", value: 7 });
    expect(op.result.type).toBe("Success");
    expect(clone_count).toBe(1);
  });

  // Spy guard: without the version counter cache, this would be N+1 clones.
  it("every step in a search points at the same cached snapshot", () => {
    const tree = fresh([5, 2, 8, 1, 3, 7, 10, 4, 6, 9]);
    const op = dispatch(tree, { kind: "search", value: 7 });
    expect(op.steps.length).toBeGreaterThan(1);
    const first = op.steps[0].snapshot;
    for (const s of op.steps) {
      expect(s.snapshot).toBe(first);
    }
  });
});

describe("dispatch(delete | range_search)", () => {
  it("delete throws NotImplementedError", () => {
    const tree = fresh();
    expect(() => dispatch(tree, { kind: "delete", value: 1 })).toThrow(
      NotImplementedError,
    );
  });

  it("range_search throws NotImplementedError", () => {
    const tree = fresh();
    expect(() =>
      dispatch(tree, { kind: "range_search", lo: 1, hi: 10 }),
    ).toThrow(NotImplementedError);
  });
});
