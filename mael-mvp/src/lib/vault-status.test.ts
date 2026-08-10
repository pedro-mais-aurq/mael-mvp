import { describe, expect, it } from "vitest";
import { deriveVaultStatus } from "./vault-status";

describe("deriveVaultStatus", () => {
  it("is 'loading' while the profile query is in flight", () => {
    expect(
      deriveVaultStatus({
        vaultKey: null,
        profileLoading: true,
        profileError: false,
        profile: undefined,
      }),
    ).toBe("loading");
  });

  it("is 'error' — never 'setup' — when getProfile() fails", () => {
    const status = deriveVaultStatus({
      vaultKey: null,
      profileLoading: false,
      profileError: true,
      profile: undefined,
    });
    expect(status).toBe("error");
    expect(status).not.toBe("setup");
  });

  it("stays 'error' even if a stale/undefined profile object is present alongside the error", () => {
    // Regressão: a causa raiz do bug era usar apenas `profileLoading` (sem
    // checar erro) para decidir entre "setup" e "locked". Um profile
    // indefinido durante um estado de erro não pode ser lido como "sem
    // master_verifier ainda configurado" (= setup).
    const status = deriveVaultStatus({
      vaultKey: null,
      profileLoading: false,
      profileError: true,
      profile: null,
    });
    expect(status).toBe("error");
  });

  it("is 'setup' only when the query succeeded and there is genuinely no master_verifier", () => {
    expect(
      deriveVaultStatus({
        vaultKey: null,
        profileLoading: false,
        profileError: false,
        profile: { master_verifier: null },
      }),
    ).toBe("setup");
  });

  it("is 'locked' when the query succeeded and a master_verifier already exists", () => {
    expect(
      deriveVaultStatus({
        vaultKey: null,
        profileLoading: false,
        profileError: false,
        profile: { master_verifier: "abc123" },
      }),
    ).toBe("locked");
  });

  it("is 'unlocked' whenever a vaultKey is present, regardless of profile state", () => {
    expect(
      deriveVaultStatus({
        vaultKey: {},
        profileLoading: false,
        profileError: true,
        profile: undefined,
      }),
    ).toBe("unlocked");
  });
});
