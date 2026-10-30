import { describe, it, expect } from "vitest";
import { range, shuffle } from "./fill.js";

describe("range", () => {
  it("produces an inclusive ascending range", () => {
    expect(range(1, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it("produces a single-element range when start === end", () => {
    expect(range(7, 7)).toEqual([7]);
  });

  it("produces an empty array when start > end", () => {
    expect(range(5, 1)).toEqual([]);
  });
});

describe("shuffle", () => {
  it("preserves the multiset of values", () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const shuffled = shuffle([...values]);
    expect([...shuffled].sort((a, b) => a - b)).toEqual(values);
  });

  it("returns the same array reference it was passed", () => {
    const values = [1, 2, 3];
    expect(shuffle(values)).toBe(values);
  });

  it("handles empty and single-element inputs", () => {
    expect(shuffle([])).toEqual([]);
    expect(shuffle([42])).toEqual([42]);
  });
});
