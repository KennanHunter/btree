/* @refresh reload */
import { render } from "solid-js/web";
import { createSignal, Show } from "solid-js";
import { TreeProvider } from "./tree-context";
import { PlaybackProvider, usePlayback } from "./playback-context";
import {
  LocalStorageProvider,
  useLocalStorage,
} from "./local-storage-context";
import {
  LeftPanelProvider,
  useLeftPanel,
} from "./left_panel/left-panel-context";
import { TreeCanvas } from "./viz/TreeCanvas";
import { LeftPanel } from "./left_panel/LeftPanel";
import { RightPanel } from "./right_panel/RightPanel";
import { DevPanel } from "./dev_panel/DevPanel";
import "./styles.css";

import {
  AiFillStepBackward,
  AiFillStepForward,
  AiOutlineCode,
  AiOutlineMenu,
  AiOutlinePause,
} from "solid-icons/ai";
import { FaSolidPlay } from "solid-icons/fa";
import { FiGithub } from "solid-icons/fi";
import { ViewControls } from "./ViewControls";

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
  const [autoFit, setAutoFit] = createSignal(false);
  const { tab: leftTab } = useLeftPanel();
  const { hasOpenedSidePanel, markSidePanelOpened, hasCreatedTree } =
    useLocalStorage();

  const toggleAside = () => {
    const next = !asideOpen();
    setAsideOpen(next);
    if (next) markSidePanelOpened();
  };

  return (
    <div
      class="app"
      classList={{ "aside-open": asideOpen(), "dev-mode": devMode() }}
    >
      <Show when={asideOpen()}>
        <div class="aside-backdrop" onClick={() => setAsideOpen(false)} />
      </Show>
      <aside class="aside-left" classList={{ "left-tall": leftTab() === "info" }}>
        <LeftPanel />
      </aside>
      <main class="main" classList={{ "main-split": devMode() }}>
        <TreeCanvas
          fitRequest={fitTick}
          autoFit={autoFit}
          onUserInteract={() => autoFit() && setAutoFit(false)}
        />
        <Show when={devMode()}>
          <DevPanel />
        </Show>
      </main>
      <PlaybackControls />
      <aside class="aside">
        <RightPanel />
      </aside>
      <div class="icon-row">
        <div class="icon-row-left">
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
            class="dev-toggle"
            classList={{ active: devMode() }}
            onClick={() => setDevMode(!devMode())}
            title="Toggle developer view"
            aria-label="Toggle developer view"
          >
            <AiOutlineCode />
          </button>
        </div>
        <div class="icon-row-right">
          <ViewControls
            autoFit={autoFit}
            toggleAutoFit={() => {
              const next = !autoFit();
              setAutoFit(next);
              if (next) setFitTick((n) => n + 1);
            }}
          />
        </div>
        <button
          class="dev-toggle aside-toggle"
          classList={{ shake: !hasOpenedSidePanel() && hasCreatedTree() }}
          onClick={toggleAside}
          aria-label="Toggle controls"
        >
          <AiOutlineMenu />
        </button>
      </div>
    </div>
  );
}

render(
  () => (
    <LocalStorageProvider>
      <TreeProvider>
        <PlaybackProvider>
          <LeftPanelProvider>
            <App />
          </LeftPanelProvider>
        </PlaybackProvider>
      </TreeProvider>
    </LocalStorageProvider>
  ),
  document.getElementById("root")!,
);
