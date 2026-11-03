import { createServer, type ViteDevServer } from "vite";
import solid from "vite-plugin-solid";
import { fileURLToPath } from "node:url";

export async function start_server(): Promise<{
  url: string;
  server: ViteDevServer;
}> {
  const server = await createServer({
    configFile: false,
    plugins: [solid()],
    root: fileURLToPath(new URL("./host", import.meta.url)),
    server: {
      port: 5273,
      strictPort: true,
      host: "127.0.0.1",
    },
    logLevel: "warn",
  });
  await server.listen();
  const addr = server.httpServer?.address();
  if (!addr || typeof addr === "string") {
    throw new Error("vite did not bind a tcp port");
  }
  const url = `http://127.0.0.1:${addr.port}/`;
  return { url, server };
}
