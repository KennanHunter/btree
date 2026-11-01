import { createSignal } from "solid-js";
import { ConfigTab } from "./ConfigTab";
import { InsertTab } from "./InsertTab";
import { SearchTab } from "./SearchTab";
import { DeleteTab } from "./DeleteTab";
import { TabbedPanel } from "../ui/TabbedPanel";

type Tab = "config" | "insert" | "search" | "delete";

export function RightPanel() {
  const [tab, setTab] = createSignal<Tab>("insert");
  return (
    <TabbedPanel
      active={tab()}
      setActive={setTab}
      tabs={[
        { id: "config", label: "Config", render: () => <ConfigTab /> },
        { id: "insert", label: "Insert", render: () => <InsertTab /> },
        { id: "search", label: "Search", render: () => <SearchTab /> },
        { id: "delete", label: "Delete", render: () => <DeleteTab /> },
      ]}
    />
  );
}
