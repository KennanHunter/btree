import {
  createContext,
  createSignal,
  useContext,
  type Accessor,
  type JSX,
} from "solid-js";
import {
  build_tree,
  check_config_for_errors,
  check_config_for_warnings,
  dispatch,
  fill_random,
  fill_sequential,
  type Operation,
  type Tree,
  type TreeConfigurationError,
  type TreeConfigurationWarning,
} from "component";
import {
  DEFAULT_CONFIG,
  useLocalStorage,
  type ConfigDraft,
} from "./local-storage-context";

export { DEFAULT_CONFIG, type ConfigDraft } from "./local-storage-context";

function build(
  config_draft: ConfigDraft,
  init: number[],
): { tree: Tree | undefined; error: TreeConfigurationError | undefined } {
  if (config_draft.fanout === null) {
    return { tree: undefined, error: undefined };
  }
  const r = build_tree(
    { ...config_draft, fanout: config_draft.fanout },
    init,
  );
  return r.ok
    ? { tree: r.tree, error: undefined }
    : { tree: undefined, error: r.error };
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
  draftWarnings: Accessor<TreeConfigurationWarning[]>;
  operations: Accessor<Operation[]>;
  activeOperation: Accessor<Operation | undefined>;
  pushOperation: (op: Operation) => void;
  updateConfig: () => void;
  insertValues: (values: number[]) => void;
  quickFillSequential: () => void;
  quickFillRandom: () => void;
  clearData: () => void;
};

const TreeContext = createContext<TreeContextValue>();

export function TreeProvider(props: { children: JSX.Element }) {
  const {
    treeConfig: committed,
    setTreeConfig,
    initValues,
    setInitValues,
  } = useLocalStorage();

  const [draft, setDraft] = createSignal<ConfigDraft>(committed());
  const [tick, setTick] = createSignal(0);
  const [fillStart, setFillStart] = createSignal(1);
  const [operations, setOperations] = createSignal<Operation[]>([]);

  const initial = build(committed(), initValues());
  const [tree, setTree] = createSignal<Tree | undefined>(initial.tree);
  const [error, setError] = createSignal<TreeConfigurationError | undefined>(
    initial.error,
  );

  const pushOperation = (op: Operation) =>
    setOperations((prev) => [...prev, op]);

  const activeOperation = () => operations().at(-1);

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

  const draftWarnings = () => {
    const d = draft();
    if (d.fanout === null) return [];
    return check_config_for_warnings({ ...d, fanout: d.fanout });
  };

  const updateConfig = () => {
    const d = draft();
    const { tree: t, error: e } = build(d, initValues());
    setTree(t);
    setError(e);
    setOperations([]);
    setTreeConfig(d);
    setTick((n) => n + 1);
  };

  const insertValues = (values: number[]) => {
    if (values.length === 0) return;
    setInitValues([...initValues(), ...values]);
    const t = tree();
    if (!t) return;
    for (const v of values) {
      const op = dispatch(t, { kind: "insert", value: v });
      pushOperation(op);
    }
    setTick((n) => n + 1);
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
    draftWarnings,
    operations,
    activeOperation,
    pushOperation,
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
      setOperations([]);
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
