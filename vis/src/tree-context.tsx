import {
  createContext,
  createSignal,
  useContext,
  type Accessor,
  type JSX,
} from "solid-js";
import {
  check_config_for_errors,
  create_b_tree,
  fill_random,
  fill_sequential,
  type Tree,
  type TreeConfigurationError,
} from "core";

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

function build(
  config_draft: ConfigDraft,
  init: number[],
): { tree: Tree | undefined; error: TreeConfigurationError | undefined } {
  if (config_draft.fanout === null) {
    return { tree: undefined, error: undefined };
  }

  const result = create_b_tree({
    ...config_draft,
    fanout: config_draft.fanout,
  });

  if (result.error) {
    return { tree: undefined, error: result };
  }

  for (const v of init) result.tree.insert(v);

  return { tree: result.tree, error: undefined };
}

type TreeContextValue = {
  tree: Accessor<Tree | undefined>;
  error: Accessor<TreeConfigurationError | undefined>;
  tick: Accessor<number>;
  committed: Accessor<ConfigDraft>;
  draft: Accessor<ConfigDraft>;
  initValues: Accessor<number[]>;
  fillStart: Accessor<number>;
  setField: <K extends keyof ConfigDraft>(k: K, v: ConfigDraft[K]) => void;
  changed: (k: keyof ConfigDraft) => boolean;
  anyChanged: () => boolean;
  draftError: Accessor<TreeConfigurationError | undefined>;
  updateConfig: () => void;
  insertValues: (values: number[]) => void;
  quickFillSequential: () => void;
  quickFillRandom: () => void;
  clearData: () => void;
};

const TreeContext = createContext<TreeContextValue>();

export function TreeProvider(props: { children: JSX.Element }) {
  const [draft, setDraft] = createSignal<ConfigDraft>(DEFAULT_CONFIG);
  const [committed, setCommitted] = createSignal<ConfigDraft>(DEFAULT_CONFIG);
  const [initValues, setInitValues] = createSignal<number[]>([]);
  const [tick, setTick] = createSignal(0);
  const [fillStart, setFillStart] = createSignal(1);

  const initial = build(committed(), initValues());
  const [tree, setTree] = createSignal<Tree | undefined>(initial.tree);
  const [error, setError] = createSignal<TreeConfigurationError | undefined>(
    initial.error,
  );

  const setField = <K extends keyof ConfigDraft>(k: K, v: ConfigDraft[K]) =>
    setDraft({ ...draft(), [k]: v });

  const changed = (k: keyof ConfigDraft) => draft()[k] !== committed()[k];
  const anyChanged = () =>
    (Object.keys(draft()) as (keyof ConfigDraft)[]).some((k) => changed(k));

  const draftError = () => {
    const d = draft();
    if (d.fanout === null) return undefined;
    const r = check_config_for_errors({ ...d, fanout: d.fanout });
    return r === true ? undefined : r;
  };

  const updateConfig = () => {
    const d = draft();
    const { tree: t, error: e } = build(d, initValues());
    setTree(t);
    setError(e);
    setCommitted(d);
    setTick((n) => n + 1);
  };

  const insertValues = (values: number[]) => {
    if (values.length === 0) return;
    setInitValues([...initValues(), ...values]);
    const t = tree();
    if (t) {
      for (const v of values) t.insert(v);
      setTick((n) => n + 1);
    }
  };

  const runFill = (fn: (t: Tree, s: number, e: number) => number[]) => {
    const t = tree();
    if (!t) return;
    const start = fillStart();
    const end = start + 99;
    const added = fn(t, start, end);
    setInitValues([...initValues(), ...added]);
    setFillStart(end + 1);
    setTick((n) => n + 1);
  };

  const value: TreeContextValue = {
    tree,
    error,
    tick,
    committed,
    draft,
    initValues,
    fillStart,
    setField,
    changed,
    anyChanged,
    draftError,
    updateConfig,
    insertValues,
    quickFillSequential: () => runFill(fill_sequential),
    quickFillRandom: () => runFill(fill_random),
    clearData: () => {
      setInitValues([]);
      setFillStart(1);
      const { tree: t, error: e } = build(committed(), []);
      setTree(t);
      setError(e);
      setTick((n) => n + 1);
    },
  };

  return (
    <TreeContext.Provider value={value}>{props.children}</TreeContext.Provider>
  );
}

export function useTree() {
  const ctx = useContext(TreeContext);
  if (!ctx) throw new Error("useTree must be used within TreeProvider");
  return ctx;
}
