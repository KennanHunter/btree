/* @refresh reload */
import { render } from "solid-js/web";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import {
  create_b_tree,
  fill_random,
  fill_sequential,
  type Tree,
  type TreeConfigurationError,
} from "core";
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

type ConfigDraft = {
  fanout: number | null;
  insert_mode: "top_down" | "bottom_up";
  inner_nodes_have_data: boolean;
};

function build(
  config: ConfigDraft,
  init: number[],
): { tree: Tree | undefined; error: TreeConfigurationError | undefined } {
  if (config.fanout === null) {
    return { tree: undefined, error: undefined };
  }
  const result = create_b_tree({ ...config, fanout: config.fanout });
  if (result.error) {
    return { tree: undefined, error: result };
  }
  for (const v of init) result.tree.insert(v);
  return { tree: result.tree, error: undefined };
}

const DEFAULT_CONFIG: ConfigDraft = {
  fanout: 4,
  insert_mode: "top_down",
  inner_nodes_have_data: true,
};

function App() {
  const [draft, setDraft] = createSignal<ConfigDraft>(DEFAULT_CONFIG);
  const [committed, setCommitted] = createSignal<ConfigDraft>(DEFAULT_CONFIG);
  const [initValues, setInitValues] = createSignal<number[]>([]);
  const [data, setData] = createSignal("");
  const [tick, setTick] = createSignal(0);
  const [devMode, setDevMode] = createSignal(false);
  const [zoom, setZoom] = createSignal(1);
  const [pan, setPan] = createSignal({ x: 0, y: 0 });
  let canvasRef: HTMLDivElement | undefined;

  const initial = build(committed(), initValues());
  const [tree, setTree] = createSignal<Tree | undefined>(initial.tree);
  const [error, setError] = createSignal<TreeConfigurationError | undefined>(
    initial.error,
  );

  const setField = <K extends keyof ConfigDraft>(k: K, v: ConfigDraft[K]) =>
    setDraft({ ...draft(), [k]: v });

  const changed = (k: keyof ConfigDraft) => draft()[k] !== committed()[k];
  const mark = (k: keyof ConfigDraft) =>
    changed(k) ? <span class="asterisk"> *</span> : null;
  const anyChanged = () =>
    (Object.keys(draft()) as (keyof ConfigDraft)[]).some((k) => changed(k));

  const updateConfig = () => {
    const d = draft();
    const { tree: t, error: e } = build(d, initValues());
    setTree(t);
    setError(e);
    setCommitted(d);
    setTick((n) => n + 1);
  };

  const insertValues = (values: number[]) => {
    if (values.length === 0) return;
    setInitValues([...initValues(), ...values]);
    const t = tree();
    if (t) {
      for (const v of values) t.insert(v);
      setTick((n) => n + 1);
    }
  };

  const addData = () => {
    const values = data()
      .split(",")
      .map((s) => parseFloat(s.trim()))
      .filter((n) => !Number.isNaN(n));
    insertValues(values);
    setData("");
  };

  const [fillStart, setFillStart] = createSignal(1);

  const runFill = (fn: (t: Tree, s: number, e: number) => void) => {
    const t = tree();
    if (!t) return;
    const start = fillStart();
    const end = start + 99;
    fn(t, start, end);
    const added: number[] = [];
    for (let v = start; v <= end; v++) added.push(v);
    setInitValues([...initValues(), ...added]);
    setFillStart(end + 1);
    setTick((n) => n + 1);
  };

  const quickFillSequential = () => runFill(fill_sequential);
  const quickFillRandom = () => runFill(fill_random);

  const clearData = () => {
    setInitValues([]);
    setFillStart(1);
    const { tree: t, error: e } = build(committed(), []);
    setTree(t);
    setError(e);
    setTick((n) => n + 1);
  };

  const centerFit = () => {
    const el = canvasRef;
    const s = shapes();
    if (!el || s.width === 0 || s.height === 0) return;
    const padding = 32;
    const sx = (el.clientWidth - padding) / (s.width + 16);
    const sy = (el.clientHeight - padding) / (s.height + 16);
    const z = Math.min(sx, sy, 1);
    const w = (s.width + 16) * z;
    const h = (s.height + 16) * z;
    setZoom(z);
    setPan({
      x: (el.clientWidth - w) / 2,
      y: (el.clientHeight - h) / 2,
    });
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const el = canvasRef;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor = Math.exp(-e.deltaY * 0.001);
    const z0 = zoom();
    const z1 = Math.max(0.05, Math.min(10, z0 * factor));
    const p = pan();
    setPan({
      x: mx - ((mx - p.x) * z1) / z0,
      y: my - ((my - p.y) * z1) / z0,
    });
    setZoom(z1);
  };

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const start = pan();
    const sx = e.clientX;
    const sy = e.clientY;
    const move = (me: PointerEvent) => {
      setPan({ x: start.x + (me.clientX - sx), y: start.y + (me.clientY - sy) });
    };
    const up = (ue: PointerEvent) => {
      target.releasePointerCapture(ue.pointerId);
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
  };

  const shapes = createMemo(() => {
    tick();
    const t = tree();
    if (!t || !t.root_node)
      return { shapes: [] as Shape[], width: 0, height: 0 };
    const laid = layout(t.root_node);
    const out: Shape[] = [];
    draw(laid, 8, 8, out);
    return { shapes: out, width: laid.width, height: laid.height };
  });

  let didInitialFit = false;
  createEffect(() => {
    const s = shapes();
    if (!didInitialFit && s.width > 0 && canvasRef) {
      didInitialFit = true;
      queueMicrotask(centerFit);
    }
  });

  return (
    <div class="app">
      <main class="main">
        <Show when={error()}>
          {(err) => (
            <div class="error">
              <strong>{err().type}</strong>
              <div>{err().message}</div>
            </div>
          )}
        </Show>
        <Show when={devMode()}>
          {(() => {
            tick();
            return (
              <div class="dev">
                <section>
                  <h3>init values ({initValues().length})</h3>
                  <pre>{JSON.stringify(initValues())}</pre>
                </section>
                <section>
                  <h3>tree</h3>
                  <pre>
                    {JSON.stringify(
                      tree(),
                      (k, v) => (k === "tree" ? undefined : v),
                      2,
                    )}
                  </pre>
                </section>
              </div>
            );
          })()}
        </Show>
        <Show
          when={!devMode() && !error() && shapes().shapes.length > 0}
          fallback={
            <Show when={!devMode() && !error()}>
              <div class="empty">Add data to see the tree.</div>
            </Show>
          }
        >
          <div
            class="canvas"
            ref={canvasRef}
            onWheel={onWheel}
            onPointerDown={onPointerDown}
          >
          <svg
            class="tree-svg"
            xmlns="http://www.w3.org/2000/svg"
            width={shapes().width + 16}
            height={shapes().height + 16}
            style={{
              transform: `translate(${pan().x}px, ${pan().y}px) scale(${zoom()})`,
            }}
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
          </div>
        </Show>
      </main>
      <aside class="aside">
        <section class="section">
          <h2>
            Tree config
            <Show when={anyChanged()}>
              <span class="unapplied">unapplied changes</span>
            </Show>
          </h2>
          <label>
            <span>Fanout{mark("fanout")}</span>
            <input
              type="number"
              min="3"
              value={draft().fanout ?? ""}
              onInput={(e) => {
                const raw = e.currentTarget.value;
                if (raw === "") return setField("fanout", null);
                const n = parseInt(raw);
                setField("fanout", Number.isNaN(n) ? null : n);
              }}
            />
          </label>
          <label>
            <span>Insert mode{mark("insert_mode")}</span>
            <select
              value={draft().insert_mode}
              onChange={(e) =>
                setField(
                  "insert_mode",
                  e.currentTarget.value as "top_down" | "bottom_up",
                )
              }
            >
              <option value="top_down">top_down</option>
              <option value="bottom_up">bottom_up</option>
            </select>
          </label>
          <label class="checkbox">
            <input
              type="checkbox"
              checked={draft().inner_nodes_have_data}
              onChange={(e) =>
                setField("inner_nodes_have_data", e.currentTarget.checked)
              }
            />
            <span>inner_nodes_have_data{mark("inner_nodes_have_data")}</span>
          </label>
          <p class="hint">
            If inner nodes hold data, it's a B-Tree. If they only hold
            separator keys and data lives in the leaves, it's a B+-Tree.
          </p>
          <button
            class="btn"
            onClick={updateConfig}
            disabled={draft().fanout === null}
          >
            Update configuration
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
          <button class="btn btn-secondary" onClick={quickFillSequential}>
            Quick fill {fillStart()}–{fillStart() + 99} sequential
          </button>
          <button class="btn btn-secondary" onClick={quickFillRandom}>
            Quick fill {fillStart()}–{fillStart() + 99} random
          </button>
          <button
            class="btn btn-secondary"
            onClick={clearData}
            disabled={initValues().length === 0}
          >
            Clear data
          </button>
        </section>
      </aside>
      <button
        class="dev-toggle center-btn"
        onClick={centerFit}
        title="Center and fit"
      >
        ⊡
      </button>
      <button
        class="dev-toggle"
        classList={{ active: devMode() }}
        onClick={() => setDevMode(!devMode())}
        title="Toggle developer view"
      >
        {"</>"}
      </button>
    </div>
  );
}

render(() => <App />, document.getElementById("root")!);
