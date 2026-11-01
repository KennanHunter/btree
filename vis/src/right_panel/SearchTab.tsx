import { createSignal } from "solid-js";
import { useTree } from "../tree-context";
import { useLocalStorage } from "../local-storage-context";
import { Button } from "../ui/Button";
import section from "../ui/Section.module.css";

export function SearchTab() {
  const { tree } = useTree();
  const { searchText, setSearchText } = useLocalStorage();
  const [result, setResult] = createSignal<string | null>(null);

  const doSearch = () => {
    const n = parseFloat(searchText());
    if (Number.isNaN(n)) return;
    const t = tree();
    if (!t) return setResult("tree not ready");
    try {
      const r = t.search(n);
      setResult(r.result.type === "Success" ? `found ${n}` : `not found: ${n}`);
    } catch (e) {
      setResult(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <section class={section.section}>
      <label>
        <span>Value</span>
        <input
          type="number"
          value={searchText()}
          onInput={(e) => setSearchText(e.currentTarget.value)}
        />
      </label>
      <Button onClick={doSearch} disabled={searchText() === ""}>
        Search
      </Button>
      {result() && <p class={section.hint}>{result()}</p>}
    </section>
  );
}
