import { useTree } from "../tree-context";
import { usePlayback } from "../playback-context";
import { shellLayout } from "../layout/AppShell";
import { Button } from "../ui/Button";
import { capture_png, capture_svg } from "./capture";
import styles from "./DevPanel.module.css";

export function DevPanel() {
  const { initValues, committed, tree, tick, operations } = useTree();
  const playback = usePlayback();

  // Build a filename from the active operation + step index so successive
  // captures land in separate files.
  const capture_name = () => {
    const ops = operations();
    const idx = playback.index();
    const op_kind = ops.at(-1)?.kind ?? "idle";
    return `btree-${op_kind}-step${idx}`;
  };

  return (
    <div class={`${styles.panel} ${shellLayout.devPane}`}>
      {(() => {
        tick();
        const ops = operations();
        return (
          <>
            <section>
              <h3>capture</h3>
              <div class={styles.captureRow}>
                <Button
                  variant="secondary"
                  small
                  onClick={() => capture_svg(capture_name())}
                >
                  SVG
                </Button>
                <Button
                  variant="secondary"
                  small
                  onClick={() => void capture_png(capture_name())}
                >
                  PNG
                </Button>
              </div>
            </section>
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
