/* @refresh reload */
import { render } from "solid-js/web";
import { createSignal, Show } from "solid-js";
import { TreeProvider } from "./tree-context";
import { PlaybackProvider, usePlayback } from "./playback-context";
import { TreeCanvas } from "./viz/TreeCanvas";
import { ConfigPanel } from "./panels/ConfigPanel";
import { DataPanel } from "./panels/DataPanel";
import { DevPane } from "./panels/DevPane";
import { EventsPanel } from "./panels/EventsPanel";
import "./styles.css";

import {
  AiFillStepBackward,
  AiFillStepForward,
  AiOutlineCode,
  AiOutlineMenu,
  AiOutlinePause,
} from "solid-icons/ai";
import { FaSolidPlay } from "solid-icons/fa";
import { FiGithub, FiMaximize } from "solid-icons/fi";

function PlaybackControls() {
  const { isPlaying, togglePlay, stepBack, stepForward } = usePlayback();
  return (
    <div class="playback-controls">
      <button
        class="dev-toggle"
        onClick={stepBack}
        title="Step back"
        aria-label="Step back"
      >
        <AiFillStepBackward />
      </button>
      <button
        class="dev-toggle"
        onClick={togglePlay}
        title={isPlaying() ? "Pause" : "Play"}
        aria-label={isPlaying() ? "Pause" : "Play"}
      >
        {isPlaying() ? <AiOutlinePause /> : <FaSolidPlay />}
      </button>
      <button
        class="dev-toggle"
        onClick={stepForward}
        title="Step forward"
        aria-label="Step forward"
      >
        <AiFillStepForward />
      </button>
    </div>
  );
}

function App() {
  const [devMode, setDevMode] = createSignal(false);
  const [asideOpen, setAsideOpen] = createSignal(false);
  const [fitTick, setFitTick] = createSignal(0);

  return (
    <div
      class="app"
      classList={{ "aside-open": asideOpen(), "dev-mode": devMode() }}
    >
      <Show when={asideOpen()}>
        <div class="aside-backdrop" onClick={() => setAsideOpen(false)} />
      </Show>
      <aside class="aside-left">
        <EventsPanel />
      </aside>
      <main class="main" classList={{ "main-split": devMode() }}>
        <TreeCanvas fitRequest={fitTick} />
        <Show when={devMode()}>
          <DevPane />
        </Show>
      </main>
      <PlaybackControls />
      <aside class="aside">
        <ConfigPanel />
        <DataPanel />
      </aside>
      <button
        class="dev-toggle aside-toggle"
        onClick={() => setAsideOpen(!asideOpen())}
        aria-label="Toggle controls"
      >
        <AiOutlineMenu />
      </button>
      <a
        class="dev-toggle github-btn"
        href="https://github.com/kennanhunter/btree"
        target="_blank"
        rel="noopener noreferrer"
        title="GitHub"
        aria-label="GitHub"
      >
        <FiGithub />
      </a>
      <button
        class="dev-toggle center-btn"
        onClick={() => setFitTick((n) => n + 1)}
        title="Center and fit"
        aria-label="Center and fit"
      >
        <FiMaximize />
      </button>
      <button
        class="dev-toggle"
        classList={{ active: devMode() }}
        onClick={() => setDevMode(!devMode())}
        title="Toggle developer view"
        aria-label="Toggle developer view"
      >
        <AiOutlineCode />
      </button>
    </div>
  );
}

render(
  () => (
    <TreeProvider>
      <PlaybackProvider>
        <App />
      </PlaybackProvider>
    </TreeProvider>
  ),
  document.getElementById("root")!,
);
