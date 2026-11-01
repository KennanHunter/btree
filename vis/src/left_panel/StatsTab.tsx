import { useTree } from "../tree-context";

export function StatsTab() {
  const { tree, tick, initValues, committed, recorderState } = useTree();

  const computeDepth = () => {
    tick();
    const t = tree();
    if (!t?.root_node) return 0;
    let depth = 1;
    let node = t.root_node;
    while (node.children.length > 0) {
      depth++;
      node = node.children[0];
    }
    return depth;
  };

  const countNodes = () => {
    tick();
    const t = tree();
    if (!t?.root_node) return 0;
    let n = 0;
    const walk = (node: typeof t.root_node) => {
      if (!node) return;
      n++;
      for (const c of node.children) walk(c);
    };
    walk(t.root_node);
    return n;
  };

  return (
    <section class="section stats">
      <div class="stat">
        <span>Keys</span>
        <strong>{initValues().length}</strong>
      </div>
      <div class="stat">
        <span>Nodes</span>
        <strong>{countNodes()}</strong>
      </div>
      <div class="stat">
        <span>Depth</span>
        <strong>{computeDepth()}</strong>
      </div>
      <div class="stat">
        <span>Fanout</span>
        <strong>{committed().fanout ?? "—"}</strong>
      </div>
      <div class="stat">
        <span>Operations</span>
        <strong>{recorderState().history.length}</strong>
      </div>
    </section>
  );
}
