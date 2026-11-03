import { createEffect, createSignal, For, Show } from "solid-js";
import type { BTreeEvent, Snapshot } from "component";
import { useTree } from "../tree-context";
import { MAX_SPEED, MIN_SPEED, usePlayback } from "../playback-context";
import styles from "./EventsTab.module.css";

// Format a node id as "Node (v1, v2, ...)" using its current key values from
// the step's snapshot. Falls back to "Node (?)" if the id isn't present —
// happens for events emitted the instant before the snapshot includes the
// node (e.g. the right sibling in split_slide_apart).
const MAX_SHOWN_KEYS = 5;
const n = (snap: Snapshot, id: number): string => {
  const node = snap.nodes[id];
  if (!node) return `Node (?)`;
  const values = node.data_keys.map((k) => k.value);
  const shown = values.slice(0, MAX_SHOWN_KEYS).join(", ");
  const suffix = values.length > MAX_SHOWN_KEYS ? ", …" : "";
  return `Node (${shown}${suffix})`;
};

// Resolve a key animation id → its numeric value by scanning the snapshot.
const k = (snap: Snapshot, id: number): string => {
  for (const node of Object.values(snap.nodes)) {
    for (const key of node.data_keys) {
      if (key.id === id) return `key ${key.value}`;
    }
  }
  return `key (?)`;
};

const describe = (e: BTreeEvent, snap: Snapshot): string => {
  switch (e.t) {
    case "visit_read":
      return `visit ${n(snap, e.node)}`;
    case "compare":
      return `compare ${k(snap, e.key_id)} in ${n(snap, e.node)} (lo ${e.lo}, hi ${e.hi})`;
    case "select_descent_child":
      return `select child ${n(snap, e.to)} (slot ${e.slot})`;
    case "descend":
      return `descend ${n(snap, e.from)} → ${n(snap, e.to)} (slot ${e.slot})`;
    case "ascend":
      return `ascend ${n(snap, e.from)} → ${n(snap, e.to)}`;
    case "found":
      return `found ${k(snap, e.key)} in ${n(snap, e.node)}`;
    case "not_found":
      return `not found in ${n(snap, e.node)}`;
    case "visit_insert":
      return `visit ${n(snap, e.node_id)}`;
    case "insert_widen":
      return `insert ${k(snap, e.key)} into ${n(snap, e.node)} at ${e.index}`;
    case "insert_merge":
      return `merge ${k(snap, e.key)} into ${n(snap, e.node)} at ${e.index}`;
    case "insert_median_found":
      return `median ${k(snap, e.key)} in ${n(snap, e.node)} at ${e.index}`;
    case "insert_node_overfill":
      return `overfull ${n(snap, e.node)}`;
    case "split_slide_apart":
      return `split slide: ${n(snap, e.node)} → right ${n(snap, e.right)} (median ${k(snap, e.median)}, ${e.kind})`;
    case "split_pull_median":
      return `split pull median ${k(snap, e.median)}: ${n(snap, e.node)} / ${n(snap, e.right)} (${e.kind})`;
    case "split_parent_grows":
      return `split parent grows: ${n(snap, e.node)} / ${n(snap, e.right)} (median ${k(snap, e.median)}, ${e.kind})`;
    case "split_connect_to_children":
      return `split connect: ${n(snap, e.node)} / ${n(snap, e.right)} (median ${k(snap, e.median)}, ${e.kind})`;
    case "grow_root":
      return `grow root: ${e.old_root === null ? "∅" : n(snap, e.old_root)} → ${n(snap, e.new_root)}`;
    case "delete_key":
      return `delete ${k(snap, e.key)} from ${n(snap, e.node)} at ${e.index}`;
    case "emit":
      return `emit ${k(snap, e.key)} from ${n(snap, e.node)}`;
  }
};

export function EventsTab() {
  const { activeOperation } = useTree();
  const { index, setIndex, speed, setSpeed, pause } = usePlayback();

  // The list row the user is "looking at". Normally this just mirrors the
  // playback cursor, but during a click-to-jump the row we highlight stays
  // put at the target while the player is still showing the frame before
  // it — gives the illusion of the clicked event animating in.
  const [sticky, setSticky] = createSignal<number | undefined>();
  const highlighted = () => sticky() ?? index();

  let pending: number | undefined;
  const jumpTo = (target: number) => {
    pause();
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
                  <span class={styles.desc}>{describe(step.event, step.snapshot)}</span>
                </li>
              )}
            </For>
          </ol>
        )}
      </Show>
    </div>
  );
}
