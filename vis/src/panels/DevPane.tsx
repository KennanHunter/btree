import { useTree } from "../tree-context";

export function DevPane() {
  const { initValues, committed, tree, tick } = useTree();
  return (
    <div class="dev">
      {(() => {
        tick();
        return (
          <>
            <section>
              <h3>init values ({initValues().length})</h3>
              <pre>{JSON.stringify(initValues())}</pre>
            </section>
            <section>
              <h3>config</h3>
              <pre>{JSON.stringify(committed(), null, 2)}</pre>
            </section>
            <section>
              <h3>tree</h3>
              <pre>
                {JSON.stringify(
                  tree(),
                  (k, v) => (k === "tree" || k === "config" ? undefined : v),
                  2,
                )}
              </pre>
            </section>
          </>
        );
      })()}
    </div>
  );
}
