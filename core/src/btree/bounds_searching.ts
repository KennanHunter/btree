import type { Key } from "./btree";

export function lower_bound_binary_search(
  keys: Key[],
  value: number,
  on_probe?: (mid: number, lo: number, hi: number) => void,
): number {
  let lo = 0;
  let hi = keys.length;

  while (lo < hi) {
    const mid = lo + Math.floor((hi - lo) / 2);

    on_probe?.(mid, lo, hi);

    if (keys[mid].value < value) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }

  return lo;
}
