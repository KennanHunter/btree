import { createSignal } from "solid-js";
import { useTree } from "../tree-context";

export function DataPanel() {
  const {
    initValues,
    fillStart,
    insertValues,
    quickFillSequential,
    quickFillRandom,
    clearData,
  } = useTree();
  const [data, setData] = createSignal("");

  const addData = () => {
    const values = data()
      .split(",")
      .map((s) => parseFloat(s.trim()))
      .filter((n) => !Number.isNaN(n));
    insertValues(values);
    setData("");
  };

  return (
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
  );
}
