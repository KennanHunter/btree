import { onCleanup, onMount } from "solid-js";
import { usePlayback } from "./playback-context";

// Global keyboard shortcuts for playback.
//   Space          — play / pause
//   Arrow Left     — step back
//   Arrow Right    — step forward
// Ignored when focus is in a text input, textarea, or contenteditable.
export function Keybinds() {
  const { togglePlay, stepBack, stepForward } = usePlayback();

  const is_typing = (el: EventTarget | null): boolean => {
    if (!(el instanceof HTMLElement)) return false;
    if (el.isContentEditable) return true;
    const tag = el.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (is_typing(e.target)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    switch (e.key) {
      case " ":
      case "Spacebar":
        e.preventDefault();
        togglePlay();
        return;
      case "ArrowLeft":
        e.preventDefault();
        stepBack();
        return;
      case "ArrowRight":
        e.preventDefault();
        stepForward();
        return;
    }
  };

  onMount(() => {
    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => window.removeEventListener("keydown", onKeyDown));
  });

  return null;
}
