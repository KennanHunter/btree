export type Workload = { name: string; keys: number[] };

export function sequential(n: number): Workload {
  const keys = new Array(n);
  for (let i = 0; i < n; i++) keys[i] = i + 1;
  return { name: "sequential", keys };
}

export function reverse(n: number): Workload {
  const keys = new Array(n);
  for (let i = 0; i < n; i++) keys[i] = n - i;
  return { name: "reverse", keys };
}

// Seeded LCG — Numerical Recipes constants. Deterministic for a given seed.
function lcg(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
}

export function random(n: number, seed = 0xc0ffee): Workload {
  const rng = lcg(seed);
  // Fisher–Yates shuffle of [1..n]
  const keys = new Array(n);
  for (let i = 0; i < n; i++) keys[i] = i + 1;
  for (let i = n - 1; i > 0; i--) {
    const j = rng() % (i + 1);
    const tmp = keys[i];
    keys[i] = keys[j];
    keys[j] = tmp;
  }
  return { name: "random", keys };
}

export function duplicates(n: number, unique = 32, seed = 0xdecaf): Workload {
  const rng = lcg(seed);
  const keys = new Array(n);
  for (let i = 0; i < n; i++) keys[i] = (rng() % unique) + 1;
  return { name: "duplicates", keys };
}

export function all_workloads(size: number): Workload[] {
  return [sequential(size), reverse(size), random(size), duplicates(size)];
}
