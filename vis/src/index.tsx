/* @refresh reload */
import { render } from "solid-js/web";
import { createMemo, createSignal, For, Show } from "solid-js";
import { create_tree, TreeNode, type Tree } from "core";
import "./styles.css";

const CELL_W = 48;
const CELL_H = 32;
const H_GAP = 24;
const V_GAP = 36;

type Laid = {
  node: TreeNode;
  width: number;
  height: number;
  nodeW: number;
  nodeH: number;
  hasChildren: boolean;
  children: Laid[];
};

function layout(node: TreeNode): Laid {
  const hasChildren = node.children.length > 0;
  const cols = Math.max(
    node.data_keys.length,
    hasChildren ? node.children.length : 0,
    1,
  );
  const nodeW = cols * CELL_W;
  const nodeH = hasChildren ? 2 * CELL_H : CELL_H;

  const children = node.children.map(layout);
  const childrenW =
    children.reduce((a, c) => a + c.width, 0) +
    Math.max(0, children.length - 1) * H_GAP;
  const childrenH = children.length
    ? V_GAP + Math.max(...children.map((c) => c.height))
    : 0;

  return {
    node,
    width: Math.max(nodeW, childrenW),
    height: nodeH + childrenH,
    nodeW,
    nodeH,
    hasChildren,
    children,
  };
}

type Shape =
  | { kind: "rect"; x: number; y: number; w: number; h: number }
  | { kind: "text"; x: number; y: number; value: string }
  | { kind: "line"; x1: number; y1: number; x2: number; y2: number };

function draw(laid: Laid, x: number, y: number, out: Shape[]) {
  const nodeX = x + (laid.width - laid.nodeW) / 2;
  const keys = laid.node.data_keys;
  const topCols = Math.max(keys.length, 1);
  const topCellW = laid.nodeW / topCols;

  for (let i = 0; i < topCols; i++) {
    out.push({
      kind: "rect",
      x: nodeX + i * topCellW,
      y,
      w: topCellW,
      h: CELL_H,
    });
    if (keys[i] !== undefined) {
      out.push({
        kind: "text",
        x: nodeX + (i + 0.5) * topCellW,
        y: y + CELL_H / 2,
        value: String(keys[i]),
      });
    }
  }

  if (laid.hasChildren) {
    for (let i = 0; i < laid.node.children.length; i++) {
      out.push({
        kind: "rect",
        x: nodeX + i * CELL_W,
        y: y + CELL_H,
        w: CELL_W,
        h: CELL_H,
      });
    }

    const childrenW =
      laid.children.reduce((a, c) => a + c.width, 0) +
      Math.max(0, laid.children.length - 1) * H_GAP;
    let cx = x + (laid.width - childrenW) / 2;
    const childY = y + laid.nodeH + V_GAP;

    laid.children.forEach((cl, i) => {
      const slotX = nodeX + (i + 0.5) * CELL_W;
      const slotY = y + CELL_H + CELL_H;
      const childTopX = cx + cl.width / 2;
      out.push({
        kind: "line",
        x1: slotX,
        y1: slotY,
        x2: childTopX,
        y2: childY,
      });
      draw(cl, cx, childY, out);
      cx += cl.width + H_GAP;
    });
  }
}

function App() {
  const [tree, setTree] = createSignal<Tree>(create_tree({ fanout: 2 }));
  const [fanout, setFanout] = createSignal(3);
  const [data, setData] = createSignal("");
  const [tick, setTick] = createSignal(0);

  const createTree = () => {
    setTree(create_tree({ fanout: fanout() }));
    setTick((t) => t + 1);
  };

  const addData = () => {
    const values = data()
      .split(",")
      .map((s) => parseFloat(s.trim()))
      .filter((n) => !Number.isNaN(n));

    const t = tree();
    for (const v of values) {
      if (t.root_node === undefined) {
        t.root_node = new TreeNode(t, v);
      } else {
        t.insert(v);
      }
    }
    setTick((n) => n + 1);
    setData("");
  };

  const shapes = createMemo(() => {
    tick();
    const t = tree();
    if (!t.root_node) return { shapes: [] as Shape[], width: 0, height: 0 };
    const laid = layout(t.root_node);
    const out: Shape[] = [];
    draw(laid, 8, 8, out);
    return { shapes: out, width: laid.width, height: laid.height };
  });

  return (
    <div class="app">
      <main class="main">
        <Show
          when={shapes().shapes.length > 0}
          fallback={<div class="empty">Add data to see the tree.</div>}
        >
          <svg
            class="tree-svg"
            xmlns="http://www.w3.org/2000/svg"
            width={shapes().width + 16}
            height={shapes().height + 16}
          >
            <For each={shapes().shapes}>
              {(s) => {
                if (s.kind === "rect") {
                  return (
                    <rect
                      x={s.x}
                      y={s.y}
                      width={s.w}
                      height={s.h}
                      fill="#2c2c2c"
                      stroke="#4a4a4a"
                      stroke-width="1"
                    />
                  );
                }
                if (s.kind === "text") {
                  return (
                    <text
                      x={s.x}
                      y={s.y}
                      fill="#e8e8e8"
                      font-size="14"
                      font-family="system-ui, sans-serif"
                      text-anchor="middle"
                      dominant-baseline="central"
                    >
                      {s.value}
                    </text>
                  );
                }
                return (
                  <line
                    x1={s.x1}
                    y1={s.y1}
                    x2={s.x2}
                    y2={s.y2}
                    stroke="#888"
                    stroke-width="1.5"
                  />
                );
              }}
            </For>
          </svg>
        </Show>
      </main>
      <aside class="aside">
        <section class="section">
          <h2>Tree config</h2>
          <label>
            Fanout
            <input
              type="number"
              min="2"
              value={fanout()}
              onInput={(e) => setFanout(parseInt(e.currentTarget.value) || 2)}
            />
          </label>
          <button class="btn" onClick={createTree}>
            Create new tree
          </button>
        </section>
        <section class="section">
          <h2>Add data</h2>
          <textarea
            rows="4"
            placeholder="e.g. 5, 2, 8.1, 1"
            value={data()}
            onInput={(e) => setData(e.currentTarget.value)}
          />
          <button class="btn" onClick={addData}>
            Add data
          </button>
        </section>
      </aside>
    </div>
  );
}

render(() => <App />, document.getElementById("root")!);
