import { useTree } from "../tree-context";
import { shellLayout } from "../layout/AppShell";
import styles from "./DevPanel.module.css";

export function DevPanel() {
  const { initValues, committed, tree, tick, operations } = useTree();
  return (
    <div class={`${styles.panel} ${shellLayout.devPane}`}>
      {(() => {
        tick();
        const ops = operations();
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
                  (k, v) =>
                    k === "tree" ||
                    k === "config" ||
                    k === "event_recorder" ||
                    k === "ids"
                      ? undefined
                      : v,
                  2,
                )}
              </pre>
            </section>
            <section>
              <h3>operations ({ops.length})</h3>
              <pre>
                {JSON.stringify(
                  ops.map((op) => ({
                    kind: op.kind,
                    request: op.request,
                    result: op.result,
                    stepCount: op.steps.length,
                  })),
                  null,
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
