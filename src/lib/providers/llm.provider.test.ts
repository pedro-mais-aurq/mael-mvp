import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenRouterProvider } from "./llm.provider";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("OpenRouterProvider", () => {
  it("calls the correct OpenRouter chat completions endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "oi" } }] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const provider = new OpenRouterProvider("fake-key");
    await provider.complete({ messages: [{ role: "user", content: "oi" }] });

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    // Regressão: a URL antiga omitia "/api" e retornava 404 em toda chamada.
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
  });

  it("returns null (not a thrown error) when no API key is configured", async () => {
    const provider = new OpenRouterProvider(undefined);
    const result = await provider.complete({ messages: [{ role: "user", content: "oi" }] });
    expect(result).toBeNull();
  });

  it("surfaces provider-level error payloads instead of silently returning empty text", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ error: { message: "invalid api key" } }),
    }) as unknown as typeof fetch;

    const provider = new OpenRouterProvider("fake-key");
    await expect(
      provider.complete({ messages: [{ role: "user", content: "oi" }] }),
    ).rejects.toThrow("invalid api key");
  });

  it("throws with status/body when the HTTP response itself is not ok", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => "Not Found",
    }) as unknown as typeof fetch;

    const provider = new OpenRouterProvider("fake-key");
    await expect(
      provider.complete({ messages: [{ role: "user", content: "oi" }] }),
    ).rejects.toThrow("404");
  });
});
