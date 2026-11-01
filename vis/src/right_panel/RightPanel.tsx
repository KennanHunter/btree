import { ConfigTab } from "./ConfigTab";
import { InsertTab } from "./InsertTab";
import { SearchTab } from "./SearchTab";
import { DeleteTab } from "./DeleteTab";
import { TabbedPanel } from "../ui/TabbedPanel";
import { useLocalStorage } from "../local-storage-context";

export function RightPanel() {
  const { rightTab, setRightTab } = useLocalStorage();
  return (
    <TabbedPanel
      active={rightTab()}
      setActive={setRightTab}
      tabs={[
        { id: "config", label: "Config", render: () => <ConfigTab /> },
        { id: "insert", label: "Insert", render: () => <InsertTab /> },
        { id: "search", label: "Search", render: () => <SearchTab /> },
        { id: "delete", label: "Delete", render: () => <DeleteTab /> },
      ]}
    />
  );
}
