import { afterEach, describe, expect, it, vi } from "vitest";
import { listChatGPTModels } from "@/lib/chatgpt/model";
import { createApi } from "./app";

vi.mock("@/lib/chatgpt/model", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/chatgpt/model")>()),
  listChatGPTModels: vi.fn(async () => ["gpt-test"]),
}));

vi.mock("@/lib/chatgpt/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/chatgpt/session")>()),
  currentAccount: async () => ({ email: "a@example.com", name: "Ada", planUsage: true }),
}));

const origin = "http://localhost:3000";
const statusRequest = { action: "status" };
const modelsRequest = { provider: "openai", credentials: { chatgpt: true } };

function post(
  api: ReturnType<typeof createApi>,
  route: string,
  body: object,
  headers: Record<string, string> = {},
  address = origin,
) {
  return api.request(`${address}/api/${route}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: new URL(address).host,
      origin: address,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe("ChatGPT session access", () => {
  afterEach(() => {
    createApi();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("allows sign-in and model loading from the opted-in local origin", async () => {
    vi.stubEnv("BETTER_VAULT_ALLOW_CHATGPT", "true");
    const api = createApi({ localChatGPT: true });
    const status = await post(api, "chatgpt", statusRequest);
    expect(await status.json()).toMatchObject({
      account: { planUsage: true },
      available: true,
    });

    const [allowed, denied] = await Promise.all([
      post(api, "models", modelsRequest),
      post(api, "models", modelsRequest, { origin: "http://localhost:8000" }),
    ]);
    expect(await allowed.json()).toMatchObject({ models: ["gpt-test"] });
    expect(denied.ok).toBe(false);
    expect(listChatGPTModels).toHaveBeenCalledTimes(1);
  });

  it.each<{ address: string; headers: Record<string, string> }>([
    { address: origin, headers: { origin: "" } },
    { address: origin, headers: { origin: "null" } },
    { address: origin, headers: { host: "example.com" } },
    { address: "http://example.com:3000", headers: {} },
  ])(
    "denies a request outside the local app's origin ($address $headers)",
    async ({ address, headers }) => {
      vi.stubEnv("BETTER_VAULT_ALLOW_CHATGPT", "true");
      const api = createApi({ localChatGPT: true });
      const status = await post(api, "chatgpt", statusRequest, headers, address);
      expect(await status.json()).toEqual({
        account: null,
        available: false,
        reason: "desktopOnly",
      });
      const start = await post(api, "chatgpt", { action: "start" }, headers, address);
      expect(start.status).toBe(403);
    },
  );

  it("requires the local server to opt in and still honors the desktop off switch", async () => {
    vi.stubEnv("BETTER_VAULT_ALLOW_CHATGPT", "true");
    const web = await post(createApi(), "chatgpt", statusRequest);
    expect(await web.json()).toMatchObject({ available: false, reason: "desktopOnly" });

    const desktop = await post(createApi({ desktop: true }), "chatgpt", statusRequest);
    expect(await desktop.json()).toMatchObject({ available: true });

    vi.stubEnv("BETTER_VAULT_ALLOW_CHATGPT", "false");
    const disabled = await post(createApi({ desktop: true }), "chatgpt", statusRequest);
    expect(await disabled.json()).toMatchObject({ available: false, reason: "off" });
  });
});
