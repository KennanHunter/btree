import { For, onMount } from "solid-js";
import type { BTreeEvent } from "core";
import {
  MAX_SPEED,
  MIN_SPEED,
  usePlayback,
} from "../playback-context";

const describe = (e: BTreeEvent) => {
  switch (e.t) {
    case "visit":
      return `visit node ${e.node}`;
    case "compare":
      return `compare key ${e.key_id} (lo ${e.lo}, hi ${e.hi})`;
    case "descend":
      return `descend ${e.from} → ${e.to} (slot ${e.slot})`;
    case "ascend":
      return `ascend ${e.from} → ${e.to}`;
    case "found":
      return `found key ${e.key} in node ${e.node}`;
    case "not_found":
      return `not found in node ${e.node}`;
    default:
      return (e as BTreeEvent).t;
  }
};

const FAKE_EVENTS: BTreeEvent[] = [
  { t: "visit", node: 1 },
  { t: "compare", node: 1, key_id: 4, lo: 0, hi: 2 },
  { t: "compare", node: 1, key_id: 5, lo: 1, hi: 2 },
  { t: "descend", from: 1, to: 2, slot: 1 },
  { t: "visit", node: 2 },
  { t: "compare", node: 2, key_id: 7, lo: 0, hi: 3 },
  { t: "compare", node: 2, key_id: 8, lo: 1, hi: 3 },
  { t: "descend", from: 2, to: 6, slot: 2 },
  { t: "visit", node: 6 },
  { t: "compare", node: 6, key_id: 11, lo: 0, hi: 2 },
  { t: "found", node: 6, key: 11 },
];

export function EventsPanel() {
  const { speed, setSpeed, setTotal, index } = usePlayback();
  onMount(() => setTotal(FAKE_EVENTS.length));

  return (
    <div class="events-panel">
      <div class="events-header">
        <h2>Events</h2>
        <label class="speed-slider">
          <span class="speed-label">
            Speed <span class="speed-value">{speed()} ev/s</span>
          </span>
          <input
            type="range"
            min={MIN_SPEED}
            max={MAX_SPEED}
            step={1}
            value={speed()}
            onInput={(e) => setSpeed(Number(e.currentTarget.value))}
          />
        </label>
      </div>
      <ol class="events-list">
        <For each={FAKE_EVENTS}>
          {(e, i) => (
            <li data-t={e.t} classList={{ active: i() === index() }}>
              <span class="events-idx">{i() + 1}</span>
              <span class="events-tag">{e.t}</span>
              <span class="events-desc">{describe(e)}</span>
            </li>
          )}
        </For>
      </ol>
    </div>
  );
}
