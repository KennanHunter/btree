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
import { AppShell, shellLayout } from "./layout/AppShell";
import { IconButton, IconLink } from "./ui/IconButton";
import { PlaybackBridge } from "./PlaybackBridge";
import { Keybinds } from "./Keybinds";
import "./styles/tokens.css";
import "./styles/reset.css";
import "./styles/forms.css";
import "./viz/legacy.css";

import {
  AiFillFastBackward,
  AiFillFastForward,
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
  const { isPlaying, togglePlay, stepBack, stepForward, index, total, setIndex, pause } =
    usePlayback();
  const skipToStart = () => {
    pause();
    setIndex(0);
  };
  const skipToEnd = () => setIndex(Math.max(0, total() - 1));
  return (
    <>
      <div class={shellLayout.playbackCounter}>
        {total() > 0 ? `${index() + 1}/${total()}` : "—/—"}
      </div>
      <div class={shellLayout.playbackRow}>
        <IconButton
          onClick={skipToStart}
          title="Skip to start"
          aria-label="Skip to start"
        >
          <AiFillFastBackward />
        </IconButton>
        <IconButton onClick={stepBack} title="Step back" aria-label="Step back">
          <AiFillStepBackward />
        </IconButton>
        <IconButton
          onClick={togglePlay}
          title={isPlaying() ? "Pause" : "Play"}
          aria-label={isPlaying() ? "Pause" : "Play"}
        >
          {isPlaying() ? <AiOutlinePause /> : <FaSolidPlay />}
        </IconButton>
        <IconButton
          onClick={stepForward}
          title="Step forward"
          aria-label="Step forward"
        >
          <AiFillStepForward />
        </IconButton>
        <IconButton
          onClick={skipToEnd}
          title="Skip to end"
          aria-label="Skip to end"
        >
          <AiFillFastForward />
        </IconButton>
      </div>
    </>
  );
}

function App() {
  const [devMode, setDevMode] = createSignal(false);
  const [asideOpen, setAsideOpen] = createSignal(false);
  const [fitTick, setFitTick] = createSignal(0);
  const [autoFit, setAutoFit] = createSignal(true);
  const [follow, setFollow] = createSignal(false);

  // Mutually exclusive camera modes. Turning one on turns the other off;
  // manual pan/zoom clears both (see `onUserInteract` below).
  const enableAutoFit = () => {
    setFollow(false);
    setAutoFit(true);
    setFitTick((n) => n + 1);
  };
  const enableFollow = () => {
    setAutoFit(false);
    setFollow(true);
  };
  const { tab: leftTab } = useLeftPanel();
  const { hasOpenedSidePanel, markSidePanelOpened, hasCreatedTree } =
    useLocalStorage();

  const toggleAside = () => {
    const next = !asideOpen();
    setAsideOpen(next);
    if (next) markSidePanelOpened();
  };

  return (
    <>
      <PlaybackBridge />
      <Keybinds />
      <AppShell
        devMode={devMode()}
        asideOpen={asideOpen()}
        leftTall={leftTab() === "info"}
        mainSplit={devMode()}
        onBackdropClick={() => setAsideOpen(false)}
        left={<LeftPanel />}
        main={
          <>
            <TreeCanvas
              fitRequest={fitTick}
              autoFit={autoFit}
              follow={follow}
              onUserInteract={(kind) => {
                if (autoFit()) setAutoFit(false);
                if (kind === "pan" && follow()) setFollow(false);
              }}
            />
            <Show when={devMode()}>
              <DevPanel />
            </Show>
          </>
        }
        right={<RightPanel />}
        iconsLeft={
          <>
            <IconLink
              href="https://github.com/kennanhunter/btree"
              target="_blank"
              rel="noopener noreferrer"
              title="GitHub"
              aria-label="GitHub"
            >
              <FiGithub />
            </IconLink>
            <IconButton
              active={devMode()}
              onClick={() => setDevMode(!devMode())}
              title="Toggle developer view"
              aria-label="Toggle developer view"
            >
              <AiOutlineCode />
            </IconButton>
          </>
        }
        iconsRight={
          <ViewControls
            autoFit={autoFit}
            follow={follow}
            toggleAutoFit={() => (autoFit() ? setAutoFit(false) : enableAutoFit())}
            toggleFollow={() => (follow() ? setFollow(false) : enableFollow())}
          />
        }
        asideToggle={
          <IconButton
            shake={!hasOpenedSidePanel() && hasCreatedTree()}
            onClick={toggleAside}
            aria-label="Toggle controls"
          >
            <AiOutlineMenu />
          </IconButton>
        }
        playback={<PlaybackControls />}
      />
    </>
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
