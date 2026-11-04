import { build } from "esbuild";

const common = {
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  external: ["solid-js", "solid-js/*"],
  jsx: "preserve",
  loader: { ".ts": "ts", ".tsx": "tsx" },
};

await Promise.all([
  build({
    ...common,
    entryPoints: ["component/src/index.ts"],
    outfile: "dist/component.jsx",
  }),
  build({
    ...common,
    entryPoints: ["core/src/index.ts"],
    outfile: "dist/core.js",
  }),
]);
