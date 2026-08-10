import type { QueryClient } from "@tanstack/react-query";

export const AUTHENTICATED_USER_CACHE_KEY = ["auth", "session-user"] as const;

export function cachedAuthenticatedUserId(queryClient: QueryClient): string | null {
  return queryClient.getQueryData<string>(AUTHENTICATED_USER_CACHE_KEY) ?? null;
}

export function shouldClearAuthenticatedCache(
  previousUserId: string | null,
  nextUserId: string | null,
): boolean {
  return nextUserId === null || (previousUserId !== null && previousUserId !== nextUserId);
}

/** Cancela leituras em voo antes de remover qualquer dado autenticado da SPA. */
export async function isolateAuthenticatedQueryCache(
  queryClient: QueryClient,
  nextUserId: string | null,
): Promise<{ previousUserId: string | null; cleared: boolean }> {
  const previousUserId = cachedAuthenticatedUserId(queryClient);
  const cleared = shouldClearAuthenticatedCache(previousUserId, nextUserId);
  if (cleared) {
    await queryClient.cancelQueries();
    queryClient.clear();
  }
  if (nextUserId) queryClient.setQueryData(AUTHENTICATED_USER_CACHE_KEY, nextUserId);
  return { previousUserId, cleared };
}

export async function signOutWithClearedCache<TResult>(
  queryClient: QueryClient,
  signOut: () => Promise<TResult>,
): Promise<TResult> {
  await isolateAuthenticatedQueryCache(queryClient, null);
  return signOut();
}
