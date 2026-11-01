import { createContext, useContext, type Accessor, type JSX } from "solid-js";
import { useLocalStorage, type LeftTab } from "../local-storage-context";

export type { LeftTab } from "../local-storage-context";

type LeftPanelContextValue = {
  tab: Accessor<LeftTab>;
  setTab: (t: LeftTab) => void;
};

const LeftPanelContext = createContext<LeftPanelContextValue>();

export function LeftPanelProvider(props: { children: JSX.Element }) {
  const { leftTab, setLeftTab } = useLocalStorage();
  return (
    <LeftPanelContext.Provider value={{ tab: leftTab, setTab: setLeftTab }}>
      {props.children}
    </LeftPanelContext.Provider>
  );
}

export function useLeftPanel() {
  const ctx = useContext(LeftPanelContext);
  if (!ctx) throw new Error("useLeftPanel must be used within LeftPanelProvider");
  return ctx;
}
