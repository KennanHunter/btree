import { Show } from "solid-js";
import { EventsTab } from "./EventsTab";
import { StatsTab } from "./StatsTab";
import { InfoTab } from "./InfoTab";
import { useLeftPanel } from "./left-panel-context";

export function LeftPanel() {
  const { tab, setTab } = useLeftPanel();
  return (
    <div class="side-panel">
      <div class="tabs">
        <button
          class="tab"
          classList={{ active: tab() === "info" }}
          onClick={() => setTab("info")}
        >
          Info
        </button>
        <button
          class="tab"
          classList={{ active: tab() === "events" }}
          onClick={() => setTab("events")}
        >
          Events
        </button>
        <button
          class="tab"
          classList={{ active: tab() === "stats" }}
          onClick={() => setTab("stats")}
        >
          Stats
        </button>
      </div>
      <div class="tab-body">
        <Show when={tab() === "info"}>
          <InfoTab />
        </Show>
        <Show when={tab() === "events"}>
          <EventsTab />
        </Show>
        <Show when={tab() === "stats"}>
          <StatsTab />
        </Show>
      </div>
    </div>
  );
}
