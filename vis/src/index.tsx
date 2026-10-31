/* @refresh reload */
import { render } from "solid-js/web";
import { createSignal, Show } from "solid-js";
import { TreeProvider } from "./tree-context";
import { TreeCanvas } from "./viz/TreeCanvas";
import { ConfigPanel } from "./panels/ConfigPanel";
import { DataPanel } from "./panels/DataPanel";
import { DevPane } from "./panels/DevPane";
import "./styles.css";

import CodeXML from "./icons/code_xml.svg";
import FitScreen from "./icons/fit_screen.svg";
import GitHub from "./icons/github-svgrepo-com.svg";
import Hamburger from "./icons/hamburger.svg";

function App() {
  const [devMode, setDevMode] = createSignal(false);
  const [asideOpen, setAsideOpen] = createSignal(false);
  const [fitTick, setFitTick] = createSignal(0);

  return (
    <div class="app" classList={{ "aside-open": asideOpen() }}>
      <Show when={asideOpen()}>
        <div class="aside-backdrop" onClick={() => setAsideOpen(false)} />
      </Show>
      <main class="main" classList={{ "main-split": devMode() }}>
        <TreeCanvas fitRequest={fitTick} />
        <Show when={devMode()}>
          <DevPane />
        </Show>
      </main>
      <aside class="aside">
        <ConfigPanel />
        <DataPanel />
      </aside>
      <button
        class="dev-toggle aside-toggle"
        onClick={() => setAsideOpen(!asideOpen())}
        aria-label="Toggle controls"
      >
        <img src={Hamburger} alt="" />
      </button>
      <a
        class="dev-toggle github-btn"
        href="https://github.com/kennanhunter/btree"
        target="_blank"
        rel="noopener noreferrer"
        title="GitHub"
      >
        <img src={GitHub} alt="" />
      </a>
      <button
        class="dev-toggle center-btn"
        onClick={() => setFitTick((n) => n + 1)}
        title="Center and fit"
      >
        <img src={FitScreen} alt="" />
      </button>
      <button
        class="dev-toggle"
        classList={{ active: devMode() }}
        onClick={() => setDevMode(!devMode())}
        title="Toggle developer view"
      >
        <img src={CodeXML} alt="" />
      </button>
    </div>
  );
}

render(
  () => (
    <TreeProvider>
      <App />
    </TreeProvider>
  ),
  document.getElementById("root")!,
);
