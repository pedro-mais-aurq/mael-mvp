import { describe, expect, it, vi } from "vitest";

import { googleOAuthRedirectUrl, hasOAuthCallbackError, startGoogleOAuth } from "./google-oauth";

describe("P4 — Google OAuth direto pelo Supabase", () => {
  it("usa provider google e redirect interno estável", async () => {
    const signInWithOAuth = vi.fn(async () => ({
      data: { provider: "google", url: "https://accounts.google.test/oauth" },
      error: null,
    }));

    await startGoogleOAuth({ signInWithOAuth } as never, "https://mael.example.com/");

    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: "https://mael.example.com/auth" },
    });
  });

  it("preserva o erro retornado pelo SDK para tratamento amigável na UI", async () => {
    const oauthError = { code: "oauth_provider_disabled", message: "detalhe interno" };
    const signInWithOAuth = vi.fn(async () => ({
      data: { provider: "google", url: null },
      error: oauthError,
    }));

    const response = await startGoogleOAuth({ signInWithOAuth } as never, "http://localhost:3000");

    expect(response.error).toBe(oauthError);
    expect(googleOAuthRedirectUrl("http://localhost:3000")).toBe("http://localhost:3000/auth");
  });

  it("reconhece cancelamento/erro no callback sem expor a descrição", () => {
    expect(hasOAuthCallbackError("?error=access_denied&error_description=segredo")).toBe(true);
    expect(hasOAuthCallbackError("", "#error=access_denied&error_description=segredo")).toBe(true);
    expect(hasOAuthCallbackError("?code=oauth-code-valido")).toBe(false);
  });
});
