import { useTree } from "../tree-context";

export function DevPanel() {
  const { initValues, committed, tree, tick, recorderState } = useTree();
  return (
    <div class="dev">
      {(() => {
        tick();
        const rs = recorderState();
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
                    k === "animation_id_generator"
                      ? undefined
                      : v,
                  2,
                )}
              </pre>
            </section>
            <section>
              <h3>event recorder — current ({rs.current.length})</h3>
              <pre>{JSON.stringify(rs.current, null, 2)}</pre>
            </section>
            <section>
              <h3>event recorder — history ({rs.history.length})</h3>
              <pre>{JSON.stringify(rs.history, null, 2)}</pre>
            </section>
          </>
        );
      })()}
    </div>
  );
}
