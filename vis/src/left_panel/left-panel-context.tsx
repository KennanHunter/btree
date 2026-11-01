import {
  createContext,
  createSignal,
  useContext,
  type Accessor,
  type JSX,
} from "solid-js";

export type LeftTab = "info" | "events" | "stats";

type LeftPanelContextValue = {
  tab: Accessor<LeftTab>;
  setTab: (t: LeftTab) => void;
};

const LeftPanelContext = createContext<LeftPanelContextValue>();

export function LeftPanelProvider(props: { children: JSX.Element }) {
  const [tab, setTab] = createSignal<LeftTab>("info");
  return (
    <LeftPanelContext.Provider value={{ tab, setTab }}>
      {props.children}
    </LeftPanelContext.Provider>
  );
}

export function useLeftPanel() {
  const ctx = useContext(LeftPanelContext);
  if (!ctx) throw new Error("useLeftPanel must be used within LeftPanelProvider");
  return ctx;
}
