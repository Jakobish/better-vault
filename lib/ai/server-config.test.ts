import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchProviderEndpoint, setDesktopRuntime } from "./server-config";

describe("fetchProviderEndpoint", () => {
  afterEach(() => {
    setDesktopRuntime(false);
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("blocks private addresses on a server", async () => {
    vi.stubEnv("BETTER_VAULT_ALLOW_PRIVATE_URLS", "false");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    await expect(fetchProviderEndpoint("http://127.0.0.1:3000")).rejects.toThrow("private network");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("allows local desktop endpoints but refuses their redirects", async () => {
    setDesktopRuntime(true);
    const fetch = vi.fn(
      async () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1/" } }),
    );
    vi.stubGlobal("fetch", fetch);

    await expect(fetchProviderEndpoint("http://127.0.0.1:3000")).rejects.toThrow(
      "must not redirect",
    );
    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:3000",
      expect.objectContaining({ redirect: "manual" }),
    );
  });
});
