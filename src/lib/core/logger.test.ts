import { describe, expect, it, vi, afterEach } from "vitest";

import { logger } from "./logger";

describe("logger.error", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("never logs '[object Object]' for a PostgrestError-shaped plain object", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const postgrestError = {
      message: 'relation "public.rate_limit_events" does not exist',
      code: "42P01",
      details: null,
      hint: null,
    };

    logger.error("Falha ao consultar Supabase", postgrestError, { route: "test" });

    expect(spy).toHaveBeenCalledTimes(1);
    const line = spy.mock.calls[0]?.[0] as string;
    expect(line).not.toContain("[object Object]");

    const parsed = JSON.parse(line);
    expect(parsed.error.message).toBe(postgrestError.message);
    expect(parsed.error.code).toBe("42P01");
  });

  it("redacts sensitive keys (tokens, passwords, ciphertext) at any depth", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    logger.error("Falha no Cofre", new Error("boom"), {
      route: "test",
      accessToken: "super-secret-token",
      nested: { password_ciphertext: "abc123", ok: "fine" },
    });

    const line = spy.mock.calls[0]?.[0] as string;
    expect(line).not.toContain("super-secret-token");
    expect(line).not.toContain("abc123");
    expect(line).toContain("fine");
  });

  it("still preserves message and stack for real Error instances", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    logger.error("Falha inesperada", new Error("deu ruim"), { route: "test" });

    const parsed = JSON.parse(spy.mock.calls[0]?.[0] as string);
    expect(parsed.error.message).toBe("deu ruim");
    expect(typeof parsed.error.stack).toBe("string");
  });
});
