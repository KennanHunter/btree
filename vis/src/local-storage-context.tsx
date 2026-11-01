import {
  createContext,
  createSignal,
  useContext,
  type Accessor,
  type JSX,
} from "solid-js";

type LocalStorageContextValue = {
  hasCreatedTree: Accessor<boolean>;
  markTreeCreated: () => void;
  hasOpenedSidePanel: Accessor<boolean>;
  markSidePanelOpened: () => void;
};

const KEYS = {
  tree: "btree:hasCreatedTree",
  panel: "btree:hasOpenedSidePanel",
} as const;

const read = (k: string) => {
  try {
    return localStorage.getItem(k) === "1";
  } catch {
    return false;
  }
};

const write = (k: string) => {
  try {
    localStorage.setItem(k, "1");
  } catch {
    // ignore
  }
};

const LocalStorageContext = createContext<LocalStorageContextValue>();

export function LocalStorageProvider(props: { children: JSX.Element }) {
  const [hasCreatedTree, setHasCreatedTree] = createSignal(read(KEYS.tree));
  const [hasOpenedSidePanel, setHasOpenedSidePanel] = createSignal(
    read(KEYS.panel),
  );

  const value: LocalStorageContextValue = {
    hasCreatedTree,
    markTreeCreated: () => {
      write(KEYS.tree);
      setHasCreatedTree(true);
    },
    hasOpenedSidePanel,
    markSidePanelOpened: () => {
      write(KEYS.panel);
      setHasOpenedSidePanel(true);
    },
  };

  return (
    <LocalStorageContext.Provider value={value}>
      {props.children}
    </LocalStorageContext.Provider>
  );
}

export function useLocalStorage() {
  const ctx = useContext(LocalStorageContext);
  if (!ctx)
    throw new Error("useLocalStorage must be used within LocalStorageProvider");
  return ctx;
}
