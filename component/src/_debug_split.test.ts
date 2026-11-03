// Debugging REPL for split_slide_apart. Prints detailed per-pose state
// for the step range around a middle-child split so you can eyeball
// bounds, hidden flags, parent frame visibility, and key positions.
//
// Run: `pnpm --filter component exec vitest _debug_split` (watch mode).
// Edit choreograph.ts / pose_edit.ts and the test reprints each save.

import { describe, it } from "vitest";
import {
  build_tree,
  dispatch,
  step_at,
  step_count,
  choreograph,
  type Ctx,
  type TreeConfig,
} from ".";

const config: TreeConfig = {
  fanout: 4,
  insert_mode: "top_down",
  inner_nodes_have_data: true,
  search_mode: "binary",
};

function fmt(n: number): string {
  return n.toFixed(1).padStart(7);
}

describe("cascading-root-split trace", () => {
  it("fanout 3 bottom_up: height-increasing root split pins children x only", () => {
    const config_cs: TreeConfig = {
      fanout: 3,
      insert_mode: "bottom_up",
      inner_nodes_have_data: true,
      search_mode: "binary",
    };
    const build = build_tree(config_cs, []);
    if (!build.ok) throw new Error("build failed");
    const tree = build.tree;
    for (const v of [66, 27, 42, 4, 15, 40]) {
      dispatch(tree, { kind: "insert", value: v });
    }
    // Insert 33 → the leaf Node(27,40) widens to [27,33,40] and
    // overflows. That cascades: median 33 goes up to Node(15,42), which
    // becomes [15,33,42] (overflow). Then the root splits
    // [15,33,42] → L=Node(15), R=Node(42), median=33 → new root.
    const op = dispatch(tree, { kind: "insert", value: 33 });

    // Find the ROOT split (second slide_apart in this op).
    let root_split_i: number | undefined;
    let L_id: number | undefined;
    let R_id: number | undefined;
    let median_id: number | undefined;
    let seen_split = 0;
    for (let i = 0; i < step_count(op); i++) {
      const s = step_at(op, i)!;
      if (s.event.t === "split_slide_apart") {
        seen_split++;
        if (seen_split === 2) {
          root_split_i = i;
          L_id = s.event.node;
          R_id = s.event.right;
          median_id = s.event.copy ?? s.event.median;
          break;
        }
      }
    }
    if (
      root_split_i === undefined ||
      L_id === undefined ||
      R_id === undefined ||
      median_id === undefined
    ) {
      console.log("expected cascading root split not found");
      return;
    }

    console.log("");
    console.log(
      `[cascade root split @${root_split_i}] L=${L_id} R=${R_id} median=${median_id}`,
    );
    // Capture L.children and R.children in the post-split snapshot.
    const L_children = [
      ...(step_at(op, root_split_i)!.snapshot.nodes[L_id]?.children ?? []),
    ];
    const R_children = [
      ...(step_at(op, root_split_i)!.snapshot.nodes[R_id]?.children ?? []),
    ];
    console.log(
      `L.children = [${L_children.join(", ")}]  R.children = [${R_children.join(", ")}]`,
    );
    console.log(
      [
        "step".padEnd(4),
        "event".padEnd(28),
        "L.node".padStart(18),
        "R.node".padStart(18),
        "L.child[0] y".padStart(16),
        "R.child[0] y".padStart(16),
      ].join(" "),
    );
    for (let i = root_split_i - 1; i < step_count(op); i++) {
      const s = step_at(op, i);
      if (!s) continue;
      const ctx: Ctx = {
        op,
        index: i,
        probe_id: undefined,
        probe_value: undefined,
      };
      const kfs = choreograph(ctx);
      for (let k = 0; k < kfs.length; k++) {
        const pose = kfs[k].pose;
        const l = pose.nodes.get(L_id);
        const r = pose.nodes.get(R_id);
        const lc0 = L_children[0] !== undefined ? pose.nodes.get(L_children[0]) : undefined;
        const rc0 = R_children[0] !== undefined ? pose.nodes.get(R_children[0]) : undefined;
        const tag = kfs.length > 1 ? `${s.event.t}[${k}]` : s.event.t;
        console.log(
          [
            String(i).padEnd(4),
            tag.padEnd(28),
            (l ? `${fmt(l.x)},y${l.y.toFixed(0)}` : "--").padStart(18),
            (r ? `${fmt(r.x)},y${r.y.toFixed(0)}` : "--").padStart(18),
            (lc0 ? `(${fmt(lc0.x)},y${lc0.y.toFixed(0)})` : "--").padStart(16),
            (rc0 ? `(${fmt(rc0.x)},y${rc0.y.toFixed(0)})` : "--").padStart(16),
          ].join(" "),
        );
      }
    }
    console.log("");
  });
});

describe("internal-node slide_apart trace", () => {
  it("fanout 3 bottom_up: tall tree, internal overflow with wide children", () => {
    const config_tall: TreeConfig = {
      fanout: 3,
      insert_mode: "bottom_up",
      inner_nodes_have_data: true,
      search_mode: "binary",
    };
    const build = build_tree(config_tall, []);
    if (!build.ok) throw new Error("build failed");
    const tree = build.tree;
    // Insert enough values to grow the tree to height ≥ 3, so an
    // overflow at depth 1 splits an INTERNAL node (not a leaf). With
    // fanout 3 and max 2 keys per leaf, inserting ~20 values triggers
    // several splits that bubble up through internal nodes.
    const seq: number[] = [];
    for (let v = 1; v <= 40; v++) seq.push(v * 7);
    for (const v of seq) dispatch(tree, { kind: "insert", value: v });

    // Find a split whose ev.node has children (internal split).
    let found_op:
      | ReturnType<typeof dispatch>
      | undefined;
    let L_id: number | undefined;
    let R_id: number | undefined;
    let median_id: number | undefined;
    for (let trial = 1000; trial < 1200; trial++) {
      const op = dispatch(tree, { kind: "insert", value: trial });
      for (let i = 0; i < step_count(op); i++) {
        const s = step_at(op, i)!;
        if (s.event.t !== "split_slide_apart") continue;
        const node_data = s.snapshot.nodes[s.event.node];
        if (node_data && node_data.children.length > 0) {
          found_op = op;
          L_id = s.event.node;
          R_id = s.event.right;
          median_id = s.event.copy ?? s.event.median;
          break;
        }
      }
      if (found_op) break;
    }
    if (!found_op || L_id === undefined || R_id === undefined) {
      console.log("no internal-node split found");
      return;
    }
    const op = found_op;

    // L.children in post-split snapshot — these are the "big" subtree
    // children we want to make sure stay with L through the slide.
    let L_children: number[] = [];
    for (let i = 0; i < step_count(op); i++) {
      const s = step_at(op, i)!;
      if (s.event.t === "split_slide_apart") {
        L_children = [...s.snapshot.nodes[L_id].children];
        break;
      }
    }

    console.log("");
    console.log(`[internal] L=${L_id} R=${R_id} median=${median_id}`);
    console.log(`L children: [${L_children.join(", ")}]`);
    console.log(
      [
        "step".padEnd(4),
        "event".padEnd(28),
        "L.node".padStart(18),
        "L.sub bbox".padStart(22),
        "R.node".padStart(18),
        "R.sub bbox".padStart(22),
        "median".padStart(14),
      ].join(" "),
    );
    for (let i = 0; i < step_count(op); i++) {
      const s = step_at(op, i)!;
      const label = s.event.t;
      if (
        label !== "insert_node_overfill" &&
        !label.startsWith("split_")
      ) {
        continue;
      }
      const ctx: Ctx = {
        op,
        index: i,
        probe_id: undefined,
        probe_value: undefined,
      };
      const kfs = choreograph(ctx);
      for (let k = 0; k < kfs.length; k++) {
        const pose = kfs[k].pose;
        const l = pose.nodes.get(L_id);
        const r = pose.nodes.get(R_id);
        const m = median_id !== undefined ? pose.keys.get(median_id) : undefined;
        // Compute L subtree extent + R subtree extent from the pose.
        const sub_extent = (root: number, source: number[]): string => {
          const nb = pose.nodes.get(root);
          if (!nb) return "--";
          let min = nb.x;
          let max = nb.x + nb.w;
          for (const cid of source) {
            const cb = pose.nodes.get(cid);
            if (!cb) continue;
            if (cb.x < min) min = cb.x;
            if (cb.x + cb.w > max) max = cb.x + cb.w;
          }
          return `${fmt(min)}..${fmt(max)}`;
        };
        const l_sub = sub_extent(L_id, L_children);
        const r_sub =
          r !== undefined
            ? sub_extent(R_id, [...(s.snapshot.nodes[R_id]?.children ?? [])])
            : "--";
        const tag = kfs.length > 1 ? `${label}[${k}]` : label;
        console.log(
          [
            String(i).padEnd(4),
            tag.padEnd(28),
            (l ? `${fmt(l.x)}+${l.w.toFixed(0)}` : "--").padStart(18),
            l_sub.padStart(22),
            (r ? `${fmt(r.x)}+${r.w.toFixed(0)}` : "--").padStart(18),
            r_sub.padStart(22),
            (m ? `(${fmt(m.x)},y${m.y.toFixed(0)})` : "--").padStart(14),
          ].join(" "),
        );
      }
    }
    console.log("");
  });
});

describe("grow_root slide_apart trace", () => {
  it("fanout 3 bottom_up: median starts inline with L and R", () => {
    const config_gr: TreeConfig = {
      fanout: 3,
      insert_mode: "bottom_up",
      inner_nodes_have_data: true,
      search_mode: "binary",
    };
    const build = build_tree(config_gr, []);
    if (!build.ok) throw new Error("build failed");
    const tree = build.tree;
    // Fill the root to K keys, then insert K+1-th → overflow → grow_root.
    for (const v of [10, 20]) dispatch(tree, { kind: "insert", value: v });
    const op = dispatch(tree, { kind: "insert", value: 30 });

    let L_id: number | undefined;
    let R_id: number | undefined;
    let median_id: number | undefined;
    for (let i = 0; i < step_count(op); i++) {
      const s = step_at(op, i)!;
      if (s.event.t === "split_slide_apart") {
        L_id = s.event.node;
        R_id = s.event.right;
        median_id = s.event.copy ?? s.event.median;
        break;
      }
    }
    if (L_id === undefined || R_id === undefined || median_id === undefined) {
      console.log("no split happened — unexpected");
      return;
    }

    console.log("");
    console.log(`[grow_root] L=${L_id} R=${R_id} median=${median_id}`);
    console.log(
      [
        "step".padEnd(4),
        "event".padEnd(28),
        "L".padStart(16),
        "R".padStart(16),
        "median".padStart(18),
      ].join(" "),
    );
    for (let i = 0; i < step_count(op); i++) {
      const ctx: Ctx = {
        op,
        index: i,
        probe_id: undefined,
        probe_value: undefined,
      };
      const kfs = choreograph(ctx);
      if (kfs.length === 0) continue;
      const label = step_at(op, i)!.event.t;
      for (let k = 0; k < kfs.length; k++) {
        const pose = kfs[k].pose;
        const l = pose.nodes.get(L_id);
        const r = pose.nodes.get(R_id);
        const m = pose.keys.get(median_id);
        const tag = kfs.length > 1 ? `${label}[${k}]` : label;
        console.log(
          [
            String(i).padEnd(4),
            tag.padEnd(28),
            (l ? `(${fmt(l.x)},y${l.y.toFixed(0)})` : "--").padStart(16),
            (r ? `(${fmt(r.x)},y${r.y.toFixed(0)})` : "--").padStart(16),
            (m ? `(${fmt(m.x)},y${m.y.toFixed(0)})` : "--").padStart(18),
          ].join(" "),
        );
      }
    }
    console.log("");
  });
});

describe("split_slide_apart REPL trace", () => {
  it("logs full per-pose state for a middle-child split", () => {
    // Build a tree where a middle leaf splits — the parent (a) is in
    // the snapshot and (b) has at least one sibling right of L.
    const seed = Array.from({ length: 25 }, (_, i) => (i + 1) * 10);
    const build = build_tree(config, seed);
    if (!build.ok) throw new Error("build failed");
    const tree = build.tree;

    let op = dispatch(tree, { kind: "insert", value: 5 });
    const extra: number[] = [];
    for (let trial = 0; trial < 200; trial++) {
      const v = trial % 2 === 0 ? -trial - 1 : 1000 + trial * 7;
      op = dispatch(tree, { kind: "insert", value: v });
      extra.push(v);
      let found = false;
      for (let i = 0; i < step_count(op); i++) {
        const s = step_at(op, i)!;
        if (s.event.t !== "insert_node_overfill") continue;
        for (const pn of Object.values(s.snapshot.nodes)) {
          const idx = pn.children.indexOf(s.event.node);
          if (idx >= 0 && idx < pn.children.length - 1) {
            found = true;
            break;
          }
        }
        if (found) break;
      }
      if (found) {
        console.log(
          `found middle-child split after inserts: 5, ${extra.slice(-5).join(", ")} ... (trial ${trial})`,
        );
        break;
      }
    }

    // Pull interesting ids from the first split_slide_apart.
    let L_id: number | undefined;
    let R_id: number | undefined;
    let parent_id: number | undefined;
    let median_id: number | undefined;
    let overfill_index: number | undefined;
    let connect_index: number | undefined;
    for (let i = 0; i < step_count(op); i++) {
      const s = step_at(op, i)!;
      if (s.event.t === "insert_node_overfill" && overfill_index === undefined) {
        overfill_index = i;
      }
      if (
        s.event.t === "split_slide_apart" &&
        L_id === undefined
      ) {
        L_id = s.event.node;
        R_id = s.event.right;
        median_id = s.event.copy ?? s.event.median;
        for (const [pid, pn] of Object.entries(s.snapshot.nodes)) {
          if (pn.children.includes(L_id!)) {
            parent_id = Number(pid);
            break;
          }
        }
      }
      if (s.event.t === "split_connect_to_children" && connect_index === undefined) {
        connect_index = i;
      }
    }

    if (parent_id === undefined || L_id === undefined || R_id === undefined) {
      console.log("no middle-child split happened — adjust the seed values");
      return;
    }

    const final_snap = op.final;
    const parent_children = final_snap.nodes[parent_id].children;
    const parent_data_keys = final_snap.nodes[parent_id].data_keys.map((k) => k.id);

    console.log("");
    console.log(`L=${L_id} R=${R_id} parent=${parent_id} median=${median_id}`);
    console.log(`parent children: [${parent_children.join(", ")}]`);
    console.log(`parent data_keys: [${parent_data_keys.join(", ")}]`);
    console.log(`split window: overfill@${overfill_index} … connect@${connect_index}`);
    console.log("");

    // Narrow trace to the split block + one step on each side.
    const start = Math.max(0, (overfill_index ?? 0) - 1);
    const end = Math.min(step_count(op) - 1, (connect_index ?? step_count(op) - 1) + 1);

    const edge_left = `${parent_id}->${L_id}`;
    const edge_right = `${parent_id}->${R_id}`;

    console.log(
      [
        "step".padEnd(4),
        "event".padEnd(28),
        "bounds".padStart(20),
        "parent".padStart(22),
        "L".padStart(16),
        "R".padStart(16),
        "median".padStart(18),
        "edges",
      ].join(" "),
    );

    for (let i = start; i <= end; i++) {
      const ctx: Ctx = {
        op,
        index: i,
        probe_id: undefined,
        probe_value: undefined,
      };
      const kfs = choreograph(ctx);
      if (kfs.length === 0) continue;
      const label = step_at(op, i)!.event.t;
      for (let k = 0; k < kfs.length; k++) {
        const pose = kfs[k].pose;
        const p = pose.nodes.get(parent_id);
        const l = pose.nodes.get(L_id);
        const r = pose.nodes.get(R_id);
        const m = median_id !== undefined ? pose.keys.get(median_id) : undefined;

        const bounds = `min_x=${fmt(pose.min_x)} w=${fmt(pose.width)}`;
        const parent_desc = p
          ? `${fmt(p.x)}+${p.w.toFixed(0)}${p.no_frame ? " [no_frame]" : ""}`
          : "--";
        const l_desc = l ? `${fmt(l.x)}+${l.w.toFixed(0)}` : "--";
        const r_desc = r ? `${fmt(r.x)}+${r.w.toFixed(0)}` : "--";
        const m_desc = m
          ? `${fmt(m.x)},y${m.y.toFixed(0)}+${m.w.toFixed(0)}`
          : "--";
        const edge_l_hidden = pose.hidden.has(edge_left) ? "L✗" : "L✓";
        const edge_r_hidden = pose.hidden.has(edge_right) ? "R✗" : "R✓";
        const med_hidden =
          median_id !== undefined && pose.hidden.has(String(median_id))
            ? " med✗"
            : "";
        const tag = kfs.length > 1 ? `${label}[${k}]` : label;
        console.log(
          [
            String(i).padEnd(4),
            tag.padEnd(28),
            bounds.padStart(20),
            parent_desc.padStart(22),
            l_desc.padStart(16),
            r_desc.padStart(16),
            m_desc.padStart(18),
            `${edge_l_hidden} ${edge_r_hidden}${med_hidden}`,
          ].join(" "),
        );
      }
    }
    console.log("");

    // Also dump parent-key visibility — median hiding, non-median
    // positions. For slide_apart we expect: median visible but at the
    // leaf row, non-median parent data_keys hidden.
    console.log("parent data_keys per step (position + hidden flag):");
    for (let i = start; i <= end; i++) {
      const ctx: Ctx = {
        op,
        index: i,
        probe_id: undefined,
        probe_value: undefined,
      };
      const kfs = choreograph(ctx);
      if (kfs.length === 0) continue;
      const label = step_at(op, i)!.event.t;
      for (let k = 0; k < kfs.length; k++) {
        const pose = kfs[k].pose;
        const tag = kfs.length > 1 ? `${label}[${k}]` : label;
        const parts = parent_data_keys.map((kid) => {
          const kb = pose.keys.get(kid);
          const hid = pose.hidden.has(String(kid));
          if (!kb) return `${kid}:--`;
          return `${kid}:(${fmt(kb.x)},y${kb.y.toFixed(0)})${hid ? "✗" : ""}`;
        });
        console.log(`  ${String(i).padEnd(4)} ${tag.padEnd(28)} ${parts.join("  ")}`);
      }
    }
    console.log("");

    // Slot visibility for parent — in slide_apart all slots should be
    // hidden; in parent_grows the new (last) slot is hidden.
    console.log("parent slots per step (position + hidden flag):");
    for (let i = start; i <= end; i++) {
      const ctx: Ctx = {
        op,
        index: i,
        probe_id: undefined,
        probe_value: undefined,
      };
      const kfs = choreograph(ctx);
      if (kfs.length === 0) continue;
      const label = step_at(op, i)!.event.t;
      for (let k = 0; k < kfs.length; k++) {
        const pose = kfs[k].pose;
        const tag = kfs.length > 1 ? `${label}[${k}]` : label;
        const parts = parent_children.map((_, si) => {
          const slot_id = `${parent_id}:${si}`;
          const sb = pose.slots.get(slot_id);
          const hid = pose.hidden.has(slot_id);
          if (!sb) return `${si}:--`;
          return `${si}:(${fmt(sb.x)},h${sb.h.toFixed(0)})${hid ? "✗" : ""}`;
        });
        console.log(`  ${String(i).padEnd(4)} ${tag.padEnd(28)} ${parts.join("  ")}`);
      }
    }
    console.log("");
  });
});
