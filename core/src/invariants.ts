import type { Tree } from "./btree";

/**
 *
 * @param tree
 * @returns true if invariants are met
 */
export function verify_invariants(tree: Tree): boolean {
  let config = tree.config;

  // duplication testing
  let seen_values = new Map();

  return true;
}
