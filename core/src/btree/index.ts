import { Tree } from "./btree";

import {
  check_config_for_errors,
  type TreeConfig,
  type TreeConfigurationError,
} from "./config";
import type { BTreeEventRecorder } from "./events";

export type TreeCreationResult =
  | {
      error: false;
      tree: Tree;
    }
  | ({
      error: true;
    } & TreeConfigurationError);

export function create_b_tree(
  config: TreeConfig,
  event_recorder: BTreeEventRecorder,
): TreeCreationResult {
  const possible_config_error = check_config_for_errors(config);

  if (possible_config_error !== true) {
    return {
      error: true,
      ...possible_config_error,
    };
  }

  return {
    error: false,
    tree: new Tree(config, event_recorder),
  };
}
