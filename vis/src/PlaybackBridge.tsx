import { createEffect } from "solid-js";
import { useTree } from "./tree-context";
import { usePlayback } from "./playback-context";

// Keeps the playback cursor in sync with the latest dispatched operation.
// Mounted once at the app shell so the binding survives tab switches — if
// this lived in EventsTab, unmounting that tab would stop timeline updates.
export function PlaybackBridge() {
  const { activeOperation } = useTree();
  const { setTotal, setIndex } = usePlayback();

  createEffect(() => {
    const op = activeOperation();
    setIndex(0);
    setTotal(op ? op.steps.length : 0);
  });

  return null;
}
