import { describe, expect, it } from "vitest";

import { createGitHubPkce, createGitHubState, hashGitHubState } from "./state.server";

describe("P5 — state e PKCE", () => {
  it("gera state aleatório, persiste somente SHA-256 e não repete", () => {
    const first = createGitHubState();
    const second = createGitHubState();

    expect(first.raw).not.toBe(second.raw);
    expect(first.raw.length).toBeGreaterThanOrEqual(40);
    expect(first.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(first.hash).toBe(hashGitHubState(first.raw));
    expect(first.hash).not.toContain(first.raw);
  });

  it("gera PKCE S256 sem expor o verifier no challenge", () => {
    const pkce = createGitHubPkce();
    expect(pkce.verifier.length).toBeGreaterThanOrEqual(40);
    expect(pkce.challenge).not.toBe(pkce.verifier);
    expect(pkce.challenge).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
