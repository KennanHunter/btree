import { For } from "solid-js";
import type { Shape } from "./layout";

type Props = {
  shapes: Shape[];
  width: number;
  height: number;
  transform?: string;
  smooth?: boolean;
};

export function TreeSvg(props: Props) {
  return (
    <svg
      class="tree-svg"
      classList={{ smooth: props.smooth }}
      xmlns="http://www.w3.org/2000/svg"
      width={props.width + 16}
      height={props.height + 16}
      style={{ transform: props.transform }}
    >
      <For each={props.shapes}>
        {(s) => {
          if (s.kind === "rect") {
            return (
              <rect
                x={s.x}
                y={s.y}
                width={s.w}
                height={s.h}
                fill="#2c2c2c"
                stroke="#4a4a4a"
                stroke-width="1"
              />
            );
          }
          if (s.kind === "text") {
            return (
              <text
                x={s.x}
                y={s.y}
                fill="#e8e8e8"
                font-size="14"
                font-family="Helvetica, Helvetica Neue, Arial, sans-serif"
                text-anchor="middle"
                dominant-baseline="central"
              >
                {s.value}
              </text>
            );
          }
          return (
            <line
              x1={s.x1}
              y1={s.y1}
              x2={s.x2}
              y2={s.y2}
              stroke="#888"
              stroke-width="1.5"
            />
          );
        }}
      </For>
    </svg>
  );
}
