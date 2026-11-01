import { useTree } from "../tree-context";
import section from "../ui/Section.module.css";
import styles from "./StatsTab.module.css";

export function StatsTab() {
  const { tree, tick, initValues, committed, operations } = useTree();

  const computeDepth = () => {
    tick();
    const t = tree();

    if (!t) return 0;

    const root = t?.root_node();
    if (!root) return 0;
    let depth = 1;
    let node = root;
    while (node.children.length > 0) {
      depth++;
      node = t.node(node.children[0]);
    }
    return depth;
  };

  const countNodes = () => {
    tick();
    const t = tree();
    if (!t) return 0;
    return Object.keys(t.data.nodes).length;
  };

  return (
    <section class={`${section.section} ${styles.stats}`}>
      <div class={styles.stat}>
        <span>Keys</span>
        <strong>{initValues().length}</strong>
      </div>
      <div class={styles.stat}>
        <span>Nodes</span>
        <strong>{countNodes()}</strong>
      </div>
      <div class={styles.stat}>
        <span>Depth</span>
        <strong>{computeDepth()}</strong>
      </div>
      <div class={styles.stat}>
        <span>Fanout</span>
        <strong>{committed().fanout ?? "—"}</strong>
      </div>
      <div class={styles.stat}>
        <span>Operations</span>
        <strong>{operations().length}</strong>
      </div>
    </section>
  );
}
