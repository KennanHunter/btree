import { useTree } from "../tree-context";
import { useLocalStorage } from "../local-storage-context";
import { Button } from "../ui/Button";
import section from "../ui/Section.module.css";

export function InsertTab() {
  const {
    initValues,
    fillStart,
    insertValues,
    quickFillSequential,
    quickFillRandom,
    clearData,
  } = useTree();
  const { insertText, setInsertText } = useLocalStorage();

  const addData = () => {
    const values = insertText()
      .split(",")
      .map((s) => parseFloat(s.trim()))
      .filter((n) => !Number.isNaN(n));
    insertValues(values);
    setInsertText("");
  };

  return (
    <section class={section.section}>
      <textarea
        rows="4"
        placeholder="e.g. 5, 2, 8.1, 1"
        value={insertText()}
        onInput={(e) => setInsertText(e.currentTarget.value)}
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
