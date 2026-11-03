import { writeFileSync } from "node:fs";
import { build_matrix } from "./matrix";
import { run_matrix } from "./run";
import {
  all_workloads,
  duplicates,
  random,
  reverse,
  sequential,
  type Workload,
} from "./workloads";

type Args = { out: string | null; size: number; workload: string | null };

function parse(argv: string[]): Args {
  const args: Args = { out: null, size: 1000, workload: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") continue;
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--size") args.size = Number(argv[++i]);
    else if (a === "--workload") args.workload = argv[++i];
    else if (a === "--help" || a === "-h") {
      print_usage();
      process.exit(0);
    } else {
      console.error(`unknown arg: ${a}`);
      print_usage();
      process.exit(1);
    }
  }
  return args;
}

function print_usage() {
  console.error(
    "Usage: bench --out <path> [--size <n>] [--workload sequential|reverse|random|duplicates]",
  );
}

function pick_workloads(name: string | null, size: number): Workload[] {
  if (name == null) return all_workloads(size);
  switch (name) {
    case "sequential":
      return [sequential(size)];
    case "reverse":
      return [reverse(size)];
    case "random":
      return [random(size)];
    case "duplicates":
      return [duplicates(size)];
    default:
      console.error(`unknown workload: ${name}`);
      process.exit(1);
  }
}

const args = parse(process.argv.slice(2));
if (args.out == null) {
  print_usage();
  process.exit(1);
}

const configs = build_matrix();
const workloads = pick_workloads(args.workload, args.size);

console.error(
  `running ${configs.length} configs × ${workloads.length} workloads at size ${args.size}…`,
);

const rows = run_matrix(configs, workloads);

const result = {
  generated_at: new Date().toISOString(),
  size: args.size,
  rows,
};

writeFileSync(args.out, JSON.stringify(result, null, 2));
console.error(`wrote ${rows.length} rows to ${args.out}`);
