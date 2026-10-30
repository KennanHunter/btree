import { describe, it, expect } from "vitest";
import { create_tree } from "./index.ts";

describe("create_tree", () => {
  it("returns a tree", () => {
    const tree = create_tree({ fanout: 3 });
    expect(tree).toBeDefined();
  });
});
