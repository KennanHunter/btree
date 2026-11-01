export type TreeConfig = {
  // must be at least 2. fanout = max children.
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
      type: "TopDownFanoutTwo";
      message: string;
    }
  | {
      type: "FanoutTooLow";
      message: string;
    };

// Open-shape warning so new advisories can be added without widening a
// tagged union each time. Keep `type` short and PascalCase for the UI chip.
export type TreeConfigurationWarning = {
  type: string;
  message: string;
};

export function check_config_for_errors(
  config: TreeConfig,
): true | TreeConfigurationError {
  if (config.fanout < 2) {
    return {
      type: "FanoutTooLow",
      message: "B Tree requires a fanout of at least 2",
    };
  }

  if (config.insert_mode == "top_down" && config.fanout === 2) {
    return {
      type: "TopDownFanoutTwo",
      message:
        "Top Down with fanout=2 creates tons of empty nodes and crashes your browser",
    };
  }

  if (config.insert_mode == "top_down" && config.fanout % 2 === 1) {
    return {
      type: "TopDownOddFanout",
      message:
        "B Tree's using the top down method must have an even fanout >= 4",
    };
  }

  return true;
}

// Non-blocking advisories. Returns an empty list when the config is fine.
// Add new warnings here as the design surfaces more edge cases.
export function check_config_for_warnings(
  config: TreeConfig,
): TreeConfigurationWarning[] {
  const warnings: TreeConfigurationWarning[] = [];

  if (config.insert_mode === "bottom_up" && config.fanout === 2) {
    warnings.push({
      type: "FanoutTwoBottomUp",
      message:
        "Fanout 2 is allowed here as an experiment, but it isn't really a valid B-tree. " +
        "A non-root node needs at least ceil(fanout / 2) − 1 keys, which is 0 at fanout 2, " +
        "so splits leave empty nodes behind.",
    });
  }

  return warnings;
}
