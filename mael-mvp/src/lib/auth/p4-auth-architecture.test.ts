import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const source = (path: string) => readFileSync(resolve(ROOT, path), "utf8");

describe("P4 — arquitetura Google-only", () => {
  it("remove integralmente email/password/signup da página Auth", () => {
    const auth = source("src/routes/auth.tsx");
    expect(auth).not.toContain("signInWithPassword");
    expect(auth).not.toContain("signUp(");
    expect(auth).not.toContain('type="email"');
    expect(auth).not.toContain('type="password"');
    expect(auth).not.toContain("Criar conta");
    expect(auth).not.toContain("Confirme seu email");
    expect(auth).not.toContain("integrations/lovable");
    expect(auth).toContain("Continuar com Google");
  });

  it("restaura sessão, observa Auth e trata callback/erro com mensagem genérica", () => {
    const auth = source("src/routes/auth.tsx");
    expect(auth).toMatch(/supabase\.auth\s*\.getSession\(\)/);
    expect(auth).toContain("supabase.auth.onAuthStateChange");
    expect(auth).toContain('navigate({ to: "/" })');
    expect(auth).toContain("hasOAuthCallbackError");
    expect(auth).toContain("Não foi possível entrar com o Google agora.");
    expect(auth).not.toContain("setError(oauthError");
  });

  it("remove somente Lovable Auth e preserva integração Lovable de build/erros", () => {
    const packageJson = JSON.parse(source("package.json")) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(packageJson.dependencies["@lovable.dev/cloud-auth-js"]).toBeUndefined();
    expect(existsSync(resolve(ROOT, "src/integrations/lovable/index.ts"))).toBe(false);
    expect(packageJson.devDependencies["@lovable.dev/vite-tanstack-config"]).toBeTruthy();
    expect(source("vite.config.ts")).toContain("@lovable.dev/vite-tanstack-config");
    expect(source("src/routes/__root.tsx")).toContain("reportLovableError");
  });

  it("AppShell bloqueia render durante transição e limpa cache no logout/A→B", () => {
    const shell = source("src/components/app-shell.tsx");
    expect(shell).toContain("isolateAuthenticatedQueryCache");
    expect(shell).toContain("signOutWithClearedCache");
    expect(shell).toContain("supabase.auth.signOut()");
    expect(shell).toContain('navigate({ to: "/auth" })');
    expect(shell).toContain("shouldClearAuthenticatedCache");
    expect(shell).toContain("authLoading || !sessionUserId");
    expect(shell).toContain('["profile", sessionUserId]');
  });

  it("não adiciona segredo Google ao frontend e mantém Profile ausente como estado válido", () => {
    const env = source(".env.example");
    expect(env).not.toMatch(/GOOGLE_(?:CLIENT_)?SECRET/);
    expect(env).not.toMatch(/VITE_GOOGLE/);
    expect(source("src/lib/services/profile.service.ts")).toContain("Promise<ProfileRow | null>");
    expect(source("src/components/app-shell.tsx")).toContain("profile?.name");
  });
});
