import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import {
  AUTHENTICATED_USER_CACHE_KEY,
  cachedAuthenticatedUserId,
  isolateAuthenticatedQueryCache,
  signOutWithClearedCache,
} from "./session-cache";

describe("P4 — isolamento do React Query entre usuários", () => {
  it("mantém cache ao receber novamente o mesmo usuário", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(AUTHENTICATED_USER_CACHE_KEY, "user-a");
    queryClient.setQueryData(["tasks"], ["task-a"]);

    const outcome = await isolateAuthenticatedQueryCache(queryClient, "user-a");

    expect(outcome.cleared).toBe(false);
    expect(queryClient.getQueryData(["tasks"])).toEqual(["task-a"]);
  });

  it("limpa dados de A antes de registrar B", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(AUTHENTICATED_USER_CACHE_KEY, "user-a");
    queryClient.setQueryData(["tasks"], ["task-a"]);
    queryClient.setQueryData(["vault"], ["vault-a"]);

    const outcome = await isolateAuthenticatedQueryCache(queryClient, "user-b");

    expect(outcome).toEqual({ previousUserId: "user-a", cleared: true });
    expect(queryClient.getQueryData(["tasks"])).toBeUndefined();
    expect(queryClient.getQueryData(["vault"])).toBeUndefined();
    expect(cachedAuthenticatedUserId(queryClient)).toBe("user-b");
  });

  it("cancela e limpa cache antes de chamar signOut", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(AUTHENTICATED_USER_CACHE_KEY, "user-a");
    queryClient.setQueryData(["profile"], { name: "Pessoa A" });
    const cancelSpy = vi.spyOn(queryClient, "cancelQueries");
    const signOut = vi.fn(async () => {
      expect(queryClient.getQueryData(["profile"])).toBeUndefined();
      return { error: null };
    });

    await signOutWithClearedCache(queryClient, signOut);

    expect(cancelSpy).toHaveBeenCalledOnce();
    expect(signOut).toHaveBeenCalledOnce();
    expect(cachedAuthenticatedUserId(queryClient)).toBeNull();
  });
});
