import { createSignal } from "solid-js";
import { useTree } from "../tree-context";
import { Button } from "../ui/Button";

export function InsertTab() {
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
      <textarea
        rows="4"
        placeholder="e.g. 5, 2, 8.1, 1"
        value={data()}
        onInput={(e) => setData(e.currentTarget.value)}
      />
      <Button onClick={addData}>Insert</Button>
      <Button variant="secondary" onClick={quickFillSequential}>
        Quick fill {fillStart()}–{fillStart() + 99} sequential
      </Button>
      <Button variant="secondary" onClick={quickFillRandom}>
        Quick fill {fillStart()}–{fillStart() + 99} random
      </Button>
      <Button
        variant="secondary"
        onClick={clearData}
        disabled={initValues().length === 0}
      >
        Clear data
      </Button>
    </section>
  );
}
