import { check_config_for_errors, type TreeConfig } from "core";

export type MatrixAxes = {
  fanout: number[];
  insert_mode: TreeConfig["insert_mode"][];
  search_mode: TreeConfig["search_mode"][];
  inner_nodes_have_data: boolean[];
};

export const DEFAULT_AXES: MatrixAxes = {
  fanout: [3, 4, 6, 8, 16, 32],
  insert_mode: ["top_down", "bottom_up"],
  search_mode: ["linear", "binary"],
  inner_nodes_have_data: [true, false],
};

export function build_matrix(axes: MatrixAxes = DEFAULT_AXES): TreeConfig[] {
  const out: TreeConfig[] = [];
  for (const fanout of axes.fanout) {
    for (const insert_mode of axes.insert_mode) {
      for (const search_mode of axes.search_mode) {
        for (const inner_nodes_have_data of axes.inner_nodes_have_data) {
          const config: TreeConfig = {
            fanout,
            insert_mode,
            search_mode,
            inner_nodes_have_data,
          };
          if (check_config_for_errors(config) === true) out.push(config);
        }
      }
    }
  }
  return out;
}
