import { mkdirSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build_matrix, DEFAULT_AXES } from "./matrix";
import { run_matrix } from "./run";
import { sequential } from "./workloads";

const FANOUT_MIN = 3;
const FANOUT_MAX = 16;
const SIZE_MIN = 1;
const SIZE_MAX = 500;
const SIZE_STEP = 5;

const fanout: number[] = [];
for (let f = FANOUT_MIN; f <= FANOUT_MAX; f++) fanout.push(f);

const configs = build_matrix({ ...DEFAULT_AXES, fanout });

const here = dirname(fileURLToPath(import.meta.url));
const out_dir = join(here, "..", "output");
mkdirSync(out_dir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const out_path = join(out_dir, `standard-${stamp}.json`);

const total_steps = Math.floor((SIZE_MAX - SIZE_MIN) / SIZE_STEP) + 1;
console.error(
  `running ${configs.length} configs × 1 workload (sequential) × ${total_steps} sizes (${SIZE_MIN}..${SIZE_MAX} step ${SIZE_STEP})…`,
);

const by_size: { size: number; rows: ReturnType<typeof run_matrix> }[] = [];
const started = Date.now();
for (let size = SIZE_MIN; size <= SIZE_MAX; size += SIZE_STEP) {
  const workloads = [sequential(size)];
  const rows = run_matrix(configs, workloads);
  by_size.push({ size, rows });
  if ((size - SIZE_MIN) % 25 === 0 || size === SIZE_MAX) {
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    console.error(`  size=${size} done (${elapsed}s elapsed)`);
  }
}

const result = {
  generated_at: new Date().toISOString(),
  axes: {
    fanout,
    insert_mode: DEFAULT_AXES.insert_mode,
    search_mode: DEFAULT_AXES.search_mode,
    inner_nodes_have_data: DEFAULT_AXES.inner_nodes_have_data,
    size: { min: SIZE_MIN, max: SIZE_MAX, step: SIZE_STEP },
    workloads: ["sequential"],
  },
  config_count: configs.length,
  by_size,
};

writeFileSync(out_path, JSON.stringify(result));

const out_name = `standard-${stamp}.json`;
for (const entry of readdirSync(out_dir)) {
  if (entry !== out_name) unlinkSync(join(out_dir, entry));
}

console.error(`wrote ${out_path}`);
