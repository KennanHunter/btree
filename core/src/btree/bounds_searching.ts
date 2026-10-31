// We find the first index where keys[index] > value.
// Any key equal to `value` sits just before it, at keys[index - 1].
//
// B-Tree (any node) or B+ leaf: a match at index - 1 means the key exists.
// B+ internal: a match at index - 1 is only a separator copy. We ignore it
// and descend into children[index], the right subtree, where the real key is.

import type { Key } from "./btree";

// Otherwise: the value isn't in this node, so descend into children[index].
export function lower_bound_binary_search(keys: Key[], value: number): number {
  let lo = 0;
  let hi = keys.length;

  while (lo < hi) {
    const mid = lo + Math.floor((hi - lo) / 2);

    if (keys[mid].value < value) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }

  return lo;
}
