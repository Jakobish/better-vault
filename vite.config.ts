import { getRequestListener } from "@hono/node-server";
import { defineConfig, loadEnv, mergeConfig, type Plugin } from "vite";
import { isLoopbackHost } from "./server/loopback.ts";
import { appConfig, appRoot } from "./vite.shared.ts";

/**
 * Serves the API (server/app.ts) from the dev server, so `npm run dev` runs
 * the whole app on one port. The module is reloaded when its code changes.
 */
function devApi(allowChatGPT: boolean): Plugin {
  return {
    name: "better-vault:dev-api",
    apply: "serve",
    configureServer(server) {
      const localChatGPT = allowChatGPT && isLoopbackHost(server.config.server.host || "localhost");
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/api/")) return next();
        try {
          const { createApi } = (await server.ssrLoadModule(
            "/server/app.ts",
          )) as typeof import("./server/app");
          await getRequestListener(createApi({ localChatGPT }).fetch)(req, res);
        } catch (error) {
          next(error);
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, appRoot, "BETTER_VAULT_ALLOW_CHATGPT");
  const allowChatGPT = env.BETTER_VAULT_ALLOW_CHATGPT === "true";
  return mergeConfig(appConfig(), {
    plugins: [devApi(allowChatGPT)],
    server: {
      port: 3000,
      strictPort: true,
      headers: allowChatGPT ? { "X-Frame-Options": "DENY" } : undefined,
    },
    preview: { port: 3000 },
    build: { outDir: "dist/client", emptyOutDir: true },
  });
});
