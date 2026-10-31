export type TreeConfig = {
  // must be at least 1 (really >= 2 to be useful). fanout = max children.
  fanout: number;

  insert_mode: "top_down" | "bottom_up";
  search_mode: "linear" | "binary";
  inner_nodes_have_data: boolean;
};

export type TreeConfigurationError =
  | {
      type: "TopDownOddFanout";
      message: string;
    }
  | {
      type: "FanoutTooLow";
      message: string;
    };

export function check_config_for_errors(
  config: TreeConfig,
): true | TreeConfigurationError {
  if (config.fanout < 3) {
    return {
      type: "FanoutTooLow",
      message: "B Tree requires a fanout of at least 3",
    };
  }

  if (config.fanout % 2 === 1 && config.insert_mode == "top_down") {
    return {
      type: "TopDownOddFanout",
      message:
        "B Tree's using the top down method must have an even fanout >= 4",
    };
  }

  return true;
}
