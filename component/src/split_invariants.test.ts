// Invariant tests for split choreography. Each test dispatches an op,
// walks every keyframe pose, and asserts a motion invariant with ±0.5px
// tolerance for rounding.
//
// The invariants describe the user-visible requirement: when a split
// happens inside a parent that has outer siblings A and C, those siblings
// must either stay put or slide outward symmetrically — never asymmetric
// motion where one jumps while the other sits still, and never a snap
// between keyframes. Equivalent: midpoint(A.right, C.left) is constant
// across every keyframe in the step range we care about.
//
// Expected: all three tests FAIL on current code. The pose_edit refactor
// should make them PASS.

import { describe, expect, it } from "vitest";
import type { AnimationID, Tree } from "../../core/src";
import {
  build_tree,
  choreograph,
  dispatch,
  step_at,
  step_count,
  type Ctx,
  type Operation,
  type Pose,
  type TreeConfig,
} from ".";

const FANOUT_3: TreeConfig = {
  fanout: 3,
  insert_mode: "bottom_up",
  inner_nodes_have_data: true,
  search_mode: "binary",
};

const TOL = 0.5;

type LabeledPose = {
  index: number;
  label: string;
  k: number;
  pose: Pose;
};

function all_poses(op: Operation): LabeledPose[] {
  const out: LabeledPose[] = [];
  for (let i = 0; i < step_count(op); i++) {
    const ctx: Ctx = {
      op,
      index: i,
      probe_id: undefined,
      probe_value: undefined,
    };
    const kfs = choreograph(ctx);
    for (let k = 0; k < kfs.length; k++) {
      out.push({
        index: i,
        label: step_at(op, i)!.event.t,
        k,
        pose: kfs[k].pose,
      });
    }
  }
  return out;
}

function midpoint_ac(
  pose: Pose,
  A: AnimationID,
  C: AnimationID,
): number | undefined {
  const a = pose.nodes.get(A);
  const c = pose.nodes.get(C);
  if (!a || !c) return undefined;
  return (a.x + a.w + c.x) / 2;
}

function format_trace(
  poses: LabeledPose[],
  A: AnimationID,
  C: AnimationID,
): string {
  return poses
    .map((p) => {
      const a = p.pose.nodes.get(A);
      const c = p.pose.nodes.get(C);
      const m = midpoint_ac(p.pose, A, C);
      const tag = `${p.label}[${p.k}]`;
      return `${tag.padEnd(32)} A.x=${a?.x.toFixed(1) ?? "--"} C.x=${c?.x.toFixed(1) ?? "--"} mid=${m?.toFixed(1) ?? "--"}`;
    })
    .join("\n");
}

// Build a fanout-3 tree whose root has children [A, M, C] where M is a
// one-key leaf. Sequence: insert 10,20 (fill root), 30 (overflow → grow
// root), 25 (widen right leaf), 40 (overflow right leaf → absorb into
// root, which now has 2 keys and 3 children).
function build_three_child_tree(): {
  tree: Tree;
  parent_id: AnimationID;
  A: AnimationID;
  M: AnimationID;
  C: AnimationID;
} {
  const r = build_tree(FANOUT_3, []);
  if (!r.ok) throw new Error(`build failed: ${r.error.type}`);
  const tree = r.tree;
  for (const v of [10, 20, 30, 25, 40]) {
    dispatch(tree, { kind: "insert", value: v });
  }
  const snap = tree.snapshot();
  if (snap.root == null) throw new Error("tree empty");
  const parent_id = snap.root;
  const parent = snap.nodes[parent_id];
  if (!parent || parent.children.length !== 3) {
    throw new Error(
      `expected 3 children, got ${parent?.children.length} (keys ${parent?.data_keys.map((k) => k.value).join(",")})`,
    );
  }
  const [A, M, C] = parent.children;
  // Sanity: M should be a one-key leaf.
  const m_node = snap.nodes[M];
  if (
    m_node.children.length !== 0 ||
    m_node.data_keys.length !== 1
  ) {
    throw new Error(
      `expected M to be 1-key leaf; got keys=${m_node.data_keys.length} children=${m_node.children.length}`,
    );
  }
  return { tree, parent_id, A, M, C };
}

describe("split invariants (fanout 3)", () => {
  it("A1 — widening middle leaf keeps outer siblings symmetric around the midpoint", () => {
    const { tree, A, C } = build_three_child_tree();
    // Insert into M (value between 20 and 30 that doesn't collide): 27 lands
    // in M=[25], widening to [25, 27] — pure widen, no split.
    const op = dispatch(tree, { kind: "insert", value: 27 });

    const poses = all_poses(op);
    const mids: number[] = [];
    for (const p of poses) {
      const m = midpoint_ac(p.pose, A, C);
      if (m !== undefined) mids.push(m);
    }
    expect(mids.length).toBeGreaterThan(1);

    const first = mids[0];
    const max_dev = Math.max(...mids.map((m) => Math.abs(m - first)));
    if (max_dev > TOL) {
      // Attach a trace so the failure diagnoses what moved.
      throw new Error(
        `midpoint(A, C) drifted by ${max_dev.toFixed(1)}px (first=${first.toFixed(1)}); trace:\n${format_trace(poses, A, C)}`,
      );
    }
  });

  it("A2 — splitting middle leaf keeps outer siblings symmetric around the midpoint", () => {
    const { tree, A, C } = build_three_child_tree();
    // Widen M to [25, 27] first.
    dispatch(tree, { kind: "insert", value: 27 });
    // Now M = [25, 27] is full. Insert 26 → M overflows (3 keys) → split.
    // In fanout 3 this also cascades a root split (parent gets 3rd key).
    // The invariant applies to the leaf-split event block (slide_apart,
    // pull_median, parent_grows, connect_to_children) and to the pre-split
    // frames: in all of those, A and C exist in the pose.
    const op = dispatch(tree, { kind: "insert", value: 26 });

    const poses = all_poses(op);
    // Collect every pose where A and C are both present (they stay in the
    // tree throughout the op, but their containing parent changes after
    // the cascading root split). Also stop at the second `split_slide_apart`
    // event — the root split emits its own sequence and the invariant for
    // *that* split belongs in a different test.
    const relevant: LabeledPose[] = [];
    let seen_split = false;
    for (const p of poses) {
      if (p.label === "split_slide_apart") {
        if (seen_split) break;
        seen_split = true;
      }
      // Skip post-leaf-split events once we exit the leaf split block
      // (the root split sequence begins with another insert_node_overfill).
      if (seen_split && p.label === "insert_node_overfill" && p.index > 0) {
        // There's an insert_node_overfill BEFORE the leaf split too, so
        // only stop on an overfill that follows the leaf split's connect.
        break;
      }
      relevant.push(p);
    }

    const mids: number[] = [];
    for (const p of relevant) {
      const m = midpoint_ac(p.pose, A, C);
      if (m !== undefined) mids.push(m);
    }
    expect(mids.length).toBeGreaterThan(1);

    const first = mids[0];
    const max_dev = Math.max(...mids.map((m) => Math.abs(m - first)));
    if (max_dev > TOL) {
      throw new Error(
        `midpoint(A, C) drifted by ${max_dev.toFixed(1)}px (first=${first.toFixed(1)}); trace:\n${format_trace(relevant, A, C)}`,
      );
    }
  });

  it("A3 — fresh-root split keeps {L, R, median} span centered on M's pre-split center", () => {
    const r = build_tree(FANOUT_3, []);
    if (!r.ok) throw new Error(`build failed: ${r.error.type}`);
    const tree = r.tree;
    dispatch(tree, { kind: "insert", value: 10 });
    dispatch(tree, { kind: "insert", value: 20 });
    // Tree: single leaf root [10, 20]. Record its id so we can measure
    // its pre-split center once the overfill fires.
    const pre_root = tree.snapshot().root!;
    // Insert 30 → root overflows → split, grow_root creates a fresh
    // parent with 2 children [L, R] and median [20] as its only key.
    const op = dispatch(tree, { kind: "insert", value: 30 });

    const poses = all_poses(op);

    // Pre-split center = M's node center in the overfill frame.
    const overfill = poses.find(
      (p) => p.label === "insert_node_overfill",
    );
    if (!overfill) throw new Error("no insert_node_overfill in op");
    const M_box = overfill.pose.nodes.get(pre_root);
    if (!M_box) throw new Error("pre_root not in overfill pose");
    const M_center = M_box.x + M_box.w / 2;

    // Grab L, R, median ids from the split event stream.
    let L: AnimationID | undefined;
    let R: AnimationID | undefined;
    let median_id: AnimationID | undefined;
    for (let i = 0; i < step_count(op); i++) {
      const s = step_at(op, i)!;
      if (s.event.t === "split_slide_apart") {
        L = s.event.node;
        R = s.event.right;
        median_id = s.event.copy ?? s.event.median;
        break;
      }
    }
    if (L === undefined || R === undefined || median_id === undefined) {
      throw new Error("no split events emitted (did the overflow happen?)");
    }

    // Across every split keyframe, assert midpoint(leftmost, rightmost)
    // of {L, R, median} boxes equals M's pre-split center.
    const split_poses = poses.filter(
      (p) =>
        p.label === "split_slide_apart" ||
        p.label === "split_pull_median" ||
        p.label === "split_parent_grows" ||
        p.label === "split_connect_to_children",
    );
    expect(split_poses.length).toBeGreaterThan(0);

    const centers: number[] = [];
    for (const { pose } of split_poses) {
      const xs: number[] = [];
      const l_box = pose.nodes.get(L);
      const r_box = pose.nodes.get(R);
      const m_box = pose.keys.get(median_id);
      if (l_box) {
        xs.push(l_box.x);
        xs.push(l_box.x + l_box.w);
      }
      if (r_box) {
        xs.push(r_box.x);
        xs.push(r_box.x + r_box.w);
      }
      if (m_box) {
        xs.push(m_box.x);
        xs.push(m_box.x + m_box.w);
      }
      if (xs.length === 0) continue;
      const span_center = (Math.min(...xs) + Math.max(...xs)) / 2;
      centers.push(span_center);
    }
    expect(centers.length).toBeGreaterThan(0);

    const worst = Math.max(...centers.map((c) => Math.abs(c - M_center)));
    if (worst > TOL) {
      // Trace for diagnosis.
      const trace = split_poses
        .map((p) => {
          const l = p.pose.nodes.get(L!);
          const r = p.pose.nodes.get(R!);
          const m = p.pose.keys.get(median_id!);
          const parts = [
            l ? `L=${l.x.toFixed(1)}+${l.w.toFixed(0)}` : "L=--",
            r ? `R=${r.x.toFixed(1)}+${r.w.toFixed(0)}` : "R=--",
            m ? `med=${m.x.toFixed(1)}+${m.w.toFixed(0)}` : "med=--",
          ];
          return `${p.label.padEnd(32)}[${p.k}] ${parts.join(" ")}`;
        })
        .join("\n");
      throw new Error(
        `{L, R, median} span-center drifted from M_pre_split=${M_center.toFixed(1)} by ${worst.toFixed(1)}px; trace:\n${trace}`,
      );
    }
  });
});
