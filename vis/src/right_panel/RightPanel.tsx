import { createSignal, Show } from "solid-js";
import { ConfigTab } from "./ConfigTab";
import { InsertTab } from "./InsertTab";
import { SearchTab } from "./SearchTab";
import { DeleteTab } from "./DeleteTab";

type Tab = "config" | "insert" | "search" | "delete";

export function RightPanel() {
  const [tab, setTab] = createSignal<Tab>("insert");
  return (
    <div class="side-panel">
      <div class="tabs">
        <button
          class="tab"
          classList={{ active: tab() === "config" }}
          onClick={() => setTab("config")}
        >
          Config
        </button>
        <button
          class="tab"
          classList={{ active: tab() === "insert" }}
          onClick={() => setTab("insert")}
        >
          Insert
        </button>
        <button
          class="tab"
          classList={{ active: tab() === "search" }}
          onClick={() => setTab("search")}
        >
          Search
        </button>
        <button
          class="tab"
          classList={{ active: tab() === "delete" }}
          onClick={() => setTab("delete")}
        >
          Delete
        </button>
      </div>
      <div class="tab-body">
        <Show when={tab() === "config"}>
          <ConfigTab />
        </Show>
        <Show when={tab() === "insert"}>
          <InsertTab />
        </Show>
        <Show when={tab() === "search"}>
          <SearchTab />
        </Show>
        <Show when={tab() === "delete"}>
          <DeleteTab />
        </Show>
      </div>
    </div>
  );
}
