import { Hono } from "hono";
import { setDesktopRuntime, withLocalChatGPT } from "@/lib/ai/server-config";
import { isLoopbackHost } from "./loopback";
import { POST as calendarFetch } from "./routes/calendar-fetch";
import { POST as chat } from "./routes/chat";
import { POST as chatgpt } from "./routes/chatgpt";
import { POST as markdownEdit } from "./routes/markdown-edit";
import { POST as models } from "./routes/models";
import { POST as opencode } from "./routes/opencode";
import { POST as sourcesParse } from "./routes/sources-parse";
import { POST as studio } from "./routes/studio";
import { POST as studioSuggest } from "./routes/studio-suggest";
import { POST as storageOAuth } from "./routes/storage-oauth";
import { POST as storageS3 } from "./routes/storage-s3";
import { POST as voices } from "./routes/voices";

/**
 * The app's API: stateless routes that take the user's keys in each request
 * and talk to the providers. The web server (`server/node.ts`), the Vite dev
 * server (`vite.config.ts`) and the desktop app's main process all serve it;
 * the web servers may opt into ChatGPT sign-in when listening on loopback.
 */
export function createApi({
  desktop = false,
  localChatGPT = false,
}: { desktop?: boolean; localChatGPT?: boolean } = {}) {
  setDesktopRuntime(desktop);
  const api = new Hono().basePath("/api");
  if (localChatGPT) {
    api.use("*", (c, next) => {
      const url = new URL(c.req.url);
      // The server stores one session. Only pages from this local app can use it.
      if (
        isLoopbackHost(url.hostname) &&
        c.req.header("host") === url.host &&
        c.req.header("origin") === url.origin
      ) {
        return withLocalChatGPT(next);
      }
      return next();
    });
  }
  api.post("/calendar/fetch", (c) => calendarFetch(c.req.raw));
  api.post("/chat", (c) => chat(c.req.raw));
  api.post("/chatgpt", (c) => chatgpt(c.req.raw));
  api.post("/markdown/edit", (c) => markdownEdit(c.req.raw));
  api.post("/models", (c) => models(c.req.raw));
  api.post("/opencode/detect", () => opencode());
  api.post("/sources/parse", (c) => sourcesParse(c.req.raw));
  api.post("/studio", (c) => studio(c.req.raw));
  api.post("/studio/suggest", (c) => studioSuggest(c.req.raw));
  api.post("/voices", (c) => voices(c.req.raw));
  api.post("/storage/s3", (c) => storageS3(c.req.raw));
  api.post("/storage/oauth", (c) => storageOAuth(c.req.raw));
  api.notFound((c) => c.json({ error: "Not found." }, 404));
  return api;
}
