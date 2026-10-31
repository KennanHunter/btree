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
      data_index: number;
      value: number;
    }
  | {
      t: "assign_root";
      // undefined means root node
      value: number;
    };
