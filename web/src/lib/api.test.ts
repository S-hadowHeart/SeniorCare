import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, setAccessToken } from "./api";

function jsonResponse(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(payload),
    json: async () => payload,
  } as unknown as Response;
}

function clearCsrfCookie(): void {
  document.cookie = "sc_csrf=; Max-Age=0; path=/";
}

describe("API client CSRF handling", () => {
  beforeEach(() => {
    setAccessToken(null);
    clearCsrfCookie();
  });

  afterEach(async () => {
    // `refreshAccessToken` clears its single-flight latch on a macrotask.
    await new Promise((resolve) => setTimeout(resolve, 0));
    vi.unstubAllGlobals();
    clearCsrfCookie();
  });

  it("echoes the CSRF cookie on state-changing requests", async () => {
    document.cookie = "sc_csrf=csrf-token; path=/";
    const fetchMock = vi.fn(async () => jsonResponse({ data: { ok: true } }));
    vi.stubGlobal("fetch", fetchMock);

    await api.post("/auth/logout");

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)["X-CSRF-Token"]).toBe("csrf-token");
  });

  it("does not add the CSRF header to safe GET requests", async () => {
    document.cookie = "sc_csrf=csrf-token; path=/";
    const fetchMock = vi.fn(async () => jsonResponse({ data: { ok: true } }));
    vi.stubGlobal("fetch", fetchMock);

    await api.get("/health");

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)["X-CSRF-Token"]).toBeUndefined();
  });

  it("sends the CSRF token with the refresh request", async () => {
    document.cookie = "sc_csrf=refresh-csrf; path=/";
    const fetchMock = vi.fn(async () =>
      jsonResponse({ data: { accessToken: "fresh-access-token" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.refresh()).resolves.toBe("fresh-access-token");

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)["X-CSRF-Token"]).toBe("refresh-csrf");
  });
});
