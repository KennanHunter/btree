export type Event =
  | {
      t: "visit";
      node: number;
    }
  | {
      t: "follow";
      from_node: number;
      to_node: number;
    }
  | {
      t: "assign";
      parent: number;
      child_index: number;
      value: number;
    }
  | {
      t: "assign_root";
      // undefined means root node
      value: number;
    };

export type TreeConfig = {
  // must be at least 1 (really >= 2 to be useful). fanout = max children.
  fanout: number;

  insert_mode: "top_down" | "bottom_up";
};

export type Split = {
  median: number;
  right: TreeNode;
};

export class TreeNode {
  tree: Tree;
  data_keys: number[] = [];
  children: TreeNode[] = [];

  constructor(tree: Tree, ...values: number[]) {
    this.tree = tree;

    for (const value of values) {
      this.data_keys.push(value);
    }
  }

  is_full(): boolean {
    return this.data_keys.length + 1 === this.tree.config.fanout;
  }

  insert_top_down(value: number) {
    let index = this.data_keys.findIndex((k) => value <= k);
    if (index === -1) index = this.data_keys.length;

    // unique keys
    if (this.data_keys[index] === value) return;

    if (this.children.length === 0) {
      // inserts at index
      this.data_keys.splice(index, 0, value);
      return;
    }

    if (this.children[index].is_full()) {
      const { median, right } = this.children[index].split();

      this.data_keys.splice(index, 0, median);
      this.children.splice(index + 1, 0, right);

      if (value === median) return;

      if (value > median) {
        this.children[index + 1].insert_top_down(value);

        return;
      }
    }

    this.children[index].insert_top_down(value);
  }

  insert_bottom_up(value: number): Split | null {
    let index = this.data_keys.findIndex((k) => value <= k);
    if (index === -1) index = this.data_keys.length;

    // unique keys
    if (this.data_keys[index] === value) return null;

    if (this.children.length === 0) {
      // inserts at index
      this.data_keys.splice(index, 0, value);
    }

    const maybe_split = this.children[index].insert_bottom_up(value);

    if (maybe_split) {
      this.data_keys.splice(index, 0, maybe_split.median);
      this.children.splice(index + 1, 0, maybe_split.right);
    }

    return this.is_full() ? this.split() : null;
  }

  split(): Split {
    let median_index = Math.floor(this.data_keys.length / 2);

    // build the right node

    let right: TreeNode = new TreeNode(
      this.tree,
      ...this.data_keys.slice(median_index + 1),
    );

    right.children = this.children.slice(median_index + 1);

    // get the median

    const median = this.data_keys[median_index];

    // turn this into the left
    this.data_keys = this.data_keys.slice(0, median_index);
    this.children = this.children.slice(0, median_index + 1);

    return {
      median,
      right,
    };
  }
}

export class Tree {
  constructor(config: TreeConfig) {
    this.config = config;
  }

  root_node: TreeNode | undefined = undefined;
  config: TreeConfig;

  populate(starting_values: number[]): Event[] {
    this.root_node = undefined;

    const events: Event[] = [];

    for (const value of starting_values) {
      if (this.root_node === undefined) {
        this.root_node = new TreeNode(this, value);

        events.push({
          t: "assign_root",
          value,
        });
      }
    }

    return events;
  }

  insert(value: number) {
    if (!this.root_node) {
      this.root_node = new TreeNode(this, value);
      return;
    }

    if (this.root_node.is_full()) {
      const old_root = this.root_node;
      const { median, right } = old_root.split();
      const new_root = new TreeNode(this, median);
      new_root.children = [old_root, right];
      this.root_node = new_root;
    }

    if (this.config.insert_mode === "bottom_up") {
      this.root_node.insert_bottom_up(value);
    } else if (this.config.insert_mode === "top_down") {
      this.root_node.insert_top_down(value);
    }
  }

  search(): Event[] {
    return [{ t: "visit", node: 3 }];
  }
}

export function create_b_tree(config: TreeConfig): TreeCreationResult {
  if (config.fanout < 3) {
    return {
      error: true,
      type: "FanoutTooLow",
      message: "B Tree require a fanout of at least 3",
    };
  }

  if (config.fanout === 3 && config.insert_mode == "bottom_up") {
    return {
      error: true,
      type: "BottomUpOddFanout",
      message:
        "B Tree's using the bottom up method must have an even fanout >= 4",
    };
  }

  return {
    error: false,
    tree: new Tree(config),
  };
}

export type TreeCreationResult =
  | {
      error: false;
      tree: Tree;
    }
  | (TreeConfigurationError & {
      error: true;
    });

export type TreeConfigurationError =
  | {
      type: "BottomUpOddFanout";
      message: string;
    }
  | {
      type: "FanoutTooLow";
      message: string;
    };
