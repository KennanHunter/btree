import { Show } from "solid-js";
import { useTree, type ConfigDraft } from "../tree-context";

export function ConfigPanel() {
  const { draft, changed, anyChanged, setField, draftError, updateConfig } =
    useTree();

  const mark = (k: keyof ConfigDraft) =>
    changed(k) ? <span class="asterisk"> *</span> : null;

  return (
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
      <label>
        <span>Search mode{mark("search_mode")}</span>
        <select
          value={draft().search_mode}
          onChange={(e) =>
            setField(
              "search_mode",
              e.currentTarget.value as "linear" | "binary",
            )
          }
        >
          <option value="binary">binary</option>
          <option value="linear">linear</option>
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
        If inner nodes hold data, it's a B-Tree. If they only hold separator
        keys and data lives in the leaves, it's a B+-Tree.
      </p>
      <Show when={draftError()}>
        {(err) => (
          <div class="error error-inline">
            <strong>{err().type}</strong>
            <div>{err().message}</div>
          </div>
        )}
      </Show>
      <button
        class="btn"
        onClick={updateConfig}
        disabled={draft().fanout === null || draftError() !== undefined}
      >
        Update configuration
      </button>
    </section>
  );
}
