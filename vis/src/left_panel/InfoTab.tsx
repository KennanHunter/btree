import { useTree } from "../tree-context";
import { useLocalStorage } from "../local-storage-context";
import { useLeftPanel } from "./left-panel-context";
import { AiOutlineAim } from "solid-icons/ai";

export function InfoTab() {
  const { setField, updateConfig, insertValues, clearData } = useTree();
  const { hasCreatedTree, markTreeCreated } = useLocalStorage();
  const { setTab } = useLeftPanel();

  const createDemo = () => {
    clearData();
    setField("fanout", 3);
    setField("insert_mode", "bottom_up");
    setField("search_mode", "binary");
    setField("inner_nodes_have_data", true);
    updateConfig();
    insertValues([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    markTreeCreated();
    setTab("events");
  };

  return (
    <section class="section info">
      <p>
        B-trees run in almost every database. I built this as a visualizer to
        verify the animations I have in my{" "}
        <a href="https://kennan.dev">deep dive article</a>
      </p>
      <button
        class="btn"
        classList={{ shake: !hasCreatedTree() }}
        onClick={createDemo}
      >
        Create 2-3 B tree
      </button>
      <p>
        If you want to look at a big tree, use the <AiOutlineAim  />{" "}
        icon to follow the animation.
      </p>
      <p class="info-mobile">
        Open the side panel for insert, search, and config.
      </p>
      <p class="info-desktop">
        Use the side panel for insert, search, and config.
      </p>
      <p>
        Source on{" "}
        <a
          href="https://github.com/kennanhunter/btree"
          target="_blank"
          rel="noopener noreferrer"
        >
          GitHub
        </a>
        .
      </p>

      <aside class="info-ad">
        <p>
          <b>Hiring?</b> I’m a Rust engineer who’s built real-time pipelines at
          30k+ events/sec over billions of rows. US-based, open to remote or
          relocation, full-time or contract.
        </p>
        <p>
          <a href="mailto:contact@kennan.dev">
            <code
              style={{
                "padding-bottom": "5px",
              }}
            >
              contact@kennan.dev
            </code>
          </a>
        </p>
      </aside>
    </section>
  );
}
