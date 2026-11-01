import type { JSX } from "solid-js";
import { For, Show } from "solid-js";
import panelStyles from "./TabbedPanel.module.css";
import tabStyles from "./Tab.module.css";

export type TabDef<Id extends string> = {
  id: Id;
  label: string;
  render: () => JSX.Element;
};

export function TabbedPanel<Id extends string>(props: {
  tabs: TabDef<Id>[];
  active: Id;
  setActive: (id: Id) => void;
}) {
  return (
    <div class={panelStyles.panel}>
      <div class={panelStyles.tabs}>
        <For each={props.tabs}>
          {(t) => (
            <button
              class={tabStyles.tab}
              classList={{ [tabStyles.active]: props.active === t.id }}
              onClick={() => props.setActive(t.id)}
            >
              {t.label}
            </button>
          )}
        </For>
      </div>
      <div class={panelStyles.body}>
        <For each={props.tabs}>
          {(t) => <Show when={props.active === t.id}>{t.render()}</Show>}
        </For>
      </div>
    </div>
  );
}
