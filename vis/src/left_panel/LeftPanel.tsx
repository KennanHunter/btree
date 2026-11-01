import { EventsTab } from "./EventsTab";
import { StatsTab } from "./StatsTab";
import { InfoTab } from "./InfoTab";
import { useLeftPanel } from "./left-panel-context";
import { TabbedPanel } from "../ui/TabbedPanel";

export function LeftPanel() {
  const { tab, setTab } = useLeftPanel();
  return (
    <TabbedPanel
      active={tab()}
      setActive={setTab}
      tabs={[
        { id: "info", label: "Info", render: () => <InfoTab /> },
        { id: "events", label: "Events", render: () => <EventsTab /> },
        { id: "stats", label: "Stats", render: () => <StatsTab /> },
      ]}
    />
  );
}
