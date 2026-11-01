import { createEffect, createSignal, For, Show } from "solid-js";
import type { BTreeEvent } from "component";
import { useTree } from "../tree-context";
import { MAX_SPEED, MIN_SPEED, usePlayback } from "../playback-context";
import styles from "./EventsTab.module.css";

const describe = (e: BTreeEvent): string => {
  switch (e.t) {
    case "insert_start":
      return `insert ${e.value}`;
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
    case "insert_key":
      return `insert key ${e.key} into node ${e.node} at ${e.index}`;
    case "delete_key":
      return `delete key ${e.key} from node ${e.node} at ${e.index}`;
    case "split":
      return `split node ${e.node} → right ${e.right} (median ${e.median}, ${e.kind})`;
    case "grow_root":
      return `grow root: ${e.old_root ?? "∅"} → ${e.new_root}`;
    case "emit":
      return `emit key ${e.key} from node ${e.node}`;
  }
};

export function EventsTab() {
  const { activeOperation } = useTree();
  const { index, setIndex, speed, setSpeed } = usePlayback();

  // The list row the user is "looking at". Normally this just mirrors the
  // playback cursor, but during a click-to-jump the row we highlight stays
  // put at the target while the player is still showing the frame before
  // it — gives the illusion of the clicked event animating in.
  const [sticky, setSticky] = createSignal<number | undefined>();
  const highlighted = () => sticky() ?? index();

  let pending: number | undefined;
  const jumpTo = (target: number) => {
    if (pending !== undefined) window.clearTimeout(pending);
    // Immediately pin the active row to the clicked step; the player
    // continues to render the previous step for 200ms, then catches up.
    setSticky(target);
    setIndex(Math.max(0, target - 1));
    pending = window.setTimeout(() => {
      setIndex(target);
      setSticky(undefined); // let the highlight follow playback again
      pending = undefined;
    }, 200);
  };

  // Keep the active row centered in the list. Lookup by data-step attribute
  // so we don't have to track per-item refs through <For> rerenders.
  let listRef: HTMLOListElement | undefined;
  createEffect(() => {
    const h = highlighted();
    if (!listRef) return;
    const el = listRef.querySelector<HTMLElement>(`[data-step="${h}"]`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  });

  return (
    <div class={styles.tab}>
      <label class={styles.speedSlider}>
        <span class={styles.speedLabel}>
          Speed <span class={styles.speedValue}>{speed()} ev/s</span>
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
      <Show
        when={activeOperation()}
        fallback={<p class={styles.empty}>No operation yet.</p>}
      >
        {(op) => (
          <ol class={styles.list} ref={listRef}>
            <For each={op().steps}>
              {(step, i) => (
                <li
                  data-t={step.event.t}
                  data-step={i()}
                  classList={{ [styles.active]: i() === highlighted() }}
                  onClick={() => jumpTo(i())}
                >
                  <span class={styles.idx}>{i() + 1}</span>
                  <span class={styles.tag}>{step.event.t}</span>
                  <span class={styles.desc}>{describe(step.event)}</span>
                </li>
              )}
            </For>
          </ol>
        )}
      </Show>
    </div>
  );
}
