import {
  createContext,
  createSignal,
  useContext,
  type Accessor,
  type JSX,
} from "solid-js";

export type LeftTab = "info" | "events" | "stats";
export type RightTab = "config" | "insert" | "search" | "delete";

export type ConfigDraft = {
  fanout: number | null;
  insert_mode: "top_down" | "bottom_up";
  search_mode: "linear" | "binary";
  inner_nodes_have_data: boolean;
};

export const DEFAULT_CONFIG: ConfigDraft = {
  fanout: 4,
  insert_mode: "top_down",
  search_mode: "binary",
  inner_nodes_have_data: true,
};

type LocalStorageContextValue = {
  hasCreatedTree: Accessor<boolean>;
  markTreeCreated: () => void;
  hasOpenedSidePanel: Accessor<boolean>;
  markSidePanelOpened: () => void;
  leftTab: Accessor<LeftTab>;
  setLeftTab: (t: LeftTab) => void;
  rightTab: Accessor<RightTab>;
  setRightTab: (t: RightTab) => void;
  initValues: Accessor<number[]>;
  setInitValues: (v: number[]) => void;
  treeConfig: Accessor<ConfigDraft>;
  setTreeConfig: (c: ConfigDraft) => void;
  insertText: Accessor<string>;
  setInsertText: (v: string) => void;
  searchText: Accessor<string>;
  setSearchText: (v: string) => void;
  deleteText: Accessor<string>;
  setDeleteText: (v: string) => void;
};

const KEYS = {
  tree: "btree:hasCreatedTree",
  panel: "btree:hasOpenedSidePanel",
  leftTab: "btree:leftTab",
  rightTab: "btree:rightTab",
  initValues: "btree:initValues",
  config: "btree:config",
  insertText: "btree:insertText",
  searchText: "btree:searchText",
  deleteText: "btree:deleteText",
} as const;

const readFlag = (k: string): boolean => {
  try {
    return localStorage.getItem(k) === "1";
  } catch {
    return false;
  }
};

const writeFlag = (k: string) => {
  try {
    localStorage.setItem(k, "1");
  } catch {
    // ignore
  }
};

function readJson<T>(
  key: string,
  fallback: T,
  validate: (v: unknown) => v is T,
): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    const parsed: unknown = JSON.parse(raw);
    return validate(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

const isLeftTab = (v: unknown): v is LeftTab =>
  v === "info" || v === "events" || v === "stats";

const isRightTab = (v: unknown): v is RightTab =>
  v === "config" || v === "insert" || v === "search" || v === "delete";

const isNumberArray = (v: unknown): v is number[] =>
  Array.isArray(v) && v.every((n) => typeof n === "number");

const isString = (v: unknown): v is string => typeof v === "string";

const isConfigDraft = (v: unknown): v is ConfigDraft => {
  if (!v || typeof v !== "object") return false;
  const c = v as Record<string, unknown>;
  return (
    (c.fanout === null || typeof c.fanout === "number") &&
    (c.insert_mode === "top_down" || c.insert_mode === "bottom_up") &&
    (c.search_mode === "linear" || c.search_mode === "binary") &&
    typeof c.inner_nodes_have_data === "boolean"
  );
};

const LocalStorageContext = createContext<LocalStorageContextValue>();

export function LocalStorageProvider(props: { children: JSX.Element }) {
  const [hasCreatedTree, setHasCreatedTree] = createSignal(readFlag(KEYS.tree));
  const [hasOpenedSidePanel, setHasOpenedSidePanel] = createSignal(
    readFlag(KEYS.panel),
  );
  const [leftTab, setLeftTabSignal] = createSignal<LeftTab>(
    readJson<LeftTab>(KEYS.leftTab, "info", isLeftTab),
  );
  const [rightTab, setRightTabSignal] = createSignal<RightTab>(
    readJson<RightTab>(KEYS.rightTab, "insert", isRightTab),
  );
  const [initValues, setInitValuesSignal] = createSignal<number[]>(
    readJson<number[]>(KEYS.initValues, [], isNumberArray),
  );
  const [treeConfig, setTreeConfigSignal] = createSignal<ConfigDraft>(
    readJson<ConfigDraft>(KEYS.config, DEFAULT_CONFIG, isConfigDraft),
  );
  const [insertText, setInsertTextSignal] = createSignal<string>(
    readJson<string>(KEYS.insertText, "", isString),
  );
  const [searchText, setSearchTextSignal] = createSignal<string>(
    readJson<string>(KEYS.searchText, "", isString),
  );
  const [deleteText, setDeleteTextSignal] = createSignal<string>(
    readJson<string>(KEYS.deleteText, "", isString),
  );

  const value: LocalStorageContextValue = {
    hasCreatedTree,
    markTreeCreated: () => {
      writeFlag(KEYS.tree);
      setHasCreatedTree(true);
    },
    hasOpenedSidePanel,
    markSidePanelOpened: () => {
      writeFlag(KEYS.panel);
      setHasOpenedSidePanel(true);
    },
    leftTab,
    setLeftTab: (t) => {
      writeJson(KEYS.leftTab, t);
      setLeftTabSignal(t);
    },
    rightTab,
    setRightTab: (t) => {
      writeJson(KEYS.rightTab, t);
      setRightTabSignal(t);
    },
    initValues,
    setInitValues: (v) => {
      writeJson(KEYS.initValues, v);
      setInitValuesSignal(v);
    },
    treeConfig,
    setTreeConfig: (c) => {
      writeJson(KEYS.config, c);
      setTreeConfigSignal(c);
    },
    insertText,
    setInsertText: (v) => {
      writeJson(KEYS.insertText, v);
      setInsertTextSignal(v);
    },
    searchText,
    setSearchText: (v) => {
      writeJson(KEYS.searchText, v);
      setSearchTextSignal(v);
    },
    deleteText,
    setDeleteText: (v) => {
      writeJson(KEYS.deleteText, v);
      setDeleteTextSignal(v);
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
