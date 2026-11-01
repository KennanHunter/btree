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

// Builds an empty tree. Initial values are applied through `dispatch` so the
// first entry in the operations list is always the seeding `bulk_insert` —
// OperationPlayer has no fallback renderer, it only draws Operations.
function build(
  config_draft: ConfigDraft,
): { tree: Tree | undefined; error: TreeConfigurationError | undefined } {
  if (config_draft.fanout === null) {
    return { tree: undefined, error: undefined };
  }
  const r = build_tree({ ...config_draft, fanout: config_draft.fanout });
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

  const pushOperation = (op: Operation) => {
    // eslint-disable-next-line no-console
    console.log("dispatch →", op);
    setOperations((prev) => [...prev, op]);
  };

  const seed_initial_values = (t: Tree) => {
    const values = initValues();
    if (values.length === 0) return;
    pushOperation(dispatch(t, { kind: "bulk_insert", values }));
  };

  const initial = build(committed());
  const [tree, setTree] = createSignal<Tree | undefined>(initial.tree);
  const [error, setError] = createSignal<TreeConfigurationError | undefined>(
    initial.error,
  );
  if (initial.tree) seed_initial_values(initial.tree);

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
    const { tree: t, error: e } = build(d);
    setTree(t);
    setError(e);
    setOperations([]);
    if (t) seed_initial_values(t);
    setTreeConfig(d);
    setTick((n) => n + 1);
  };

  const insertValues = (values: number[]) => {
    if (values.length === 0) return;
    setInitValues([...initValues(), ...values]);
    const t = tree();
    if (!t) return;
    // Collapse the whole batch into one dispatched Operation (one entry in
    // the events panel, one event stream covering every insert) — otherwise
    // "Create 2-3 B tree" produces 10 separate ops, which is annoying.
    const req =
      values.length === 1
        ? { kind: "insert" as const, value: values[0] }
        : { kind: "bulk_insert" as const, values };
    pushOperation(dispatch(t, req));
    setTick((n) => n + 1);
  };

  // Quick-fill routes through insertValues → dispatch(bulk_insert) so the
  // batch shows up as one Operation in the events panel.
  const quick_fill_range = (shuffle: boolean) => {
    const start = fillStart();
    const end = start + 99;
    const values: number[] = [];
    for (let v = start; v <= end; v++) values.push(v);
    if (shuffle) {
      for (let i = values.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [values[i], values[j]] = [values[j], values[i]];
      }
    }
    setFillStart(end + 1);
    insertValues(values);
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
    quickFillSequential: () => quick_fill_range(false),
    quickFillRandom: () => quick_fill_range(true),
    clearData: () => {
      setInitValues([]);
      setFillStart(1);
      const { tree: t, error: e } = build(committed());
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
