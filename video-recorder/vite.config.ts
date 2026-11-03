import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [solid()],
  root: fileURLToPath(new URL("./src/host", import.meta.url)),
  server: {
    port: 5273,
    strictPort: true,
  },
});
