import { useTree } from "../tree-context";
import { useLocalStorage } from "../local-storage-context";
import { useLeftPanel } from "./left-panel-context";
import { AiOutlineAim } from "solid-icons/ai";
import { Button } from "../ui/Button";
import section from "../ui/Section.module.css";
import styles from "./InfoTab.module.css";

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
    <section class={`${section.section} ${styles.info}`}>
      <p>
        B-trees power almost every database. This is the interactive companion
        and development environment for my{" "}
        <a href="https://kennan.dev">deep dive article</a>.
      </p>
      <Button shake={!hasCreatedTree()} onClick={createDemo}>
        Create 2-3 B tree
      </Button>
      <p>
        <span class={styles.desktopOnly}>Open</span>
        <span class={styles.mobileOnly}>Use</span> the side panel to insert,
        search, and change the config. For big trees, click <AiOutlineAim /> to
        keep the camera on the animation.
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

      <aside class={styles.ad}>
        <p>
          <b>Hiring?</b> I’m a Rust engineer who’s owned startup backends end to
          end, including high-throughput real-time pipelines over billions of
          rows. US-based, open to remote or relocation, full-time or contract.
        </p>
        <p>
          <a href="mailto:contact@kennan.dev">
            <code>contact@kennan.dev</code>
          </a>
        </p>
      </aside>
    </section>
  );
}
