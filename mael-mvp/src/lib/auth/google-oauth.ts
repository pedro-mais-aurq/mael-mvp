import type { SupabaseClient } from "@supabase/supabase-js";

type OAuthAuthClient = Pick<SupabaseClient["auth"], "signInWithOAuth">;

export function googleOAuthRedirectUrl(origin: string): string {
  return new URL("/auth", origin).toString();
}

export function startGoogleOAuth(auth: OAuthAuthClient, origin: string) {
  return auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: googleOAuthRedirectUrl(origin),
    },
  });
}

function containsOAuthError(value: string): boolean {
  const params = new URLSearchParams(value.startsWith("#") ? value.slice(1) : value);
  return params.has("error") || params.has("error_code") || params.has("error_description");
}

export function hasOAuthCallbackError(search: string, hash = ""): boolean {
  return containsOAuthError(search) || containsOAuthError(hash);
}
