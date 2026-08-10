import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const source = (path: string) => readFileSync(resolve(ROOT, path), "utf8");

describe("P5 — arquitetura e migration GitHub", () => {
  const migration = source("supabase/migrations/20260810010000_alpha_0_1_github_app.sql");

  it("cria conexões 0..N por usuário com SELECT próprio e escrita server-only", () => {
    expect(migration).toContain("UNIQUE (user_id, installation_id)");
    expect(migration).not.toMatch(/UNIQUE\s*\(installation_id\)/);
    expect(migration).toContain("GRANT SELECT ON public.github_connections TO authenticated");
    expect(migration).toContain(
      "REVOKE INSERT, UPDATE, DELETE ON public.github_connections FROM authenticated",
    );
    expect(migration).toContain("USING (auth.uid() = user_id)");
  });

  it("mantém flow table invisível ao browser e sem policy authenticated", () => {
    expect(migration).toContain(
      "REVOKE ALL ON public.github_connection_states FROM authenticated, anon",
    );
    expect(migration).toContain(
      "ALTER TABLE public.github_connection_states ENABLE ROW LEVEL SECURITY",
    );
    expect(migration).not.toMatch(/POLICY[^;]+github_connection_states[^;]+authenticated/i);
  });

  it("não cria colunas para tokens, JWT, secrets, OAuth code ou state cru", () => {
    const tableDefinitions = migration
      .replace(/--.*$/gm, "")
      .match(/CREATE TABLE public\.github_(?:connections|connection_states) \([\s\S]*?\n\);/g)
      ?.join("\n");
    expect(tableDefinitions).toBeTruthy();
    expect(tableDefinitions).not.toMatch(
      /access_token|refresh_token|installation_token|\bjwt\b|private_key|client_secret|oauth_code|raw_state/i,
    );
  });

  it("server functions usam requireSupabaseAuth e não aceitam user_id/tokens do frontend", () => {
    const functions = source("src/lib/github.functions.ts");
    expect(functions.match(/\.middleware\(\[requireSupabaseAuth\]\)/g)?.length).toBe(6);
    expect(functions).not.toMatch(/user_id\s*:/);
    expect(functions).not.toMatch(/access_token\s*:|private_key\s*:|client_secret\s*:/);
    expect(functions).toContain("context.userId");
  });

  it("GitHub não vira login e não adiciona write Tools ou leitura arbitrária", () => {
    const auth = source("src/routes/auth.tsx");
    const policy = source("src/lib/chat/turn-policy.ts");
    expect(auth).not.toMatch(/provider:\s*["']github["']/);
    expect(policy).not.toMatch(
      /github_(?:create|comment|merge|close|push|delete|trigger|release|update|get_file)/,
    );
    expect(source("src/lib/chat/tool-registry.ts")).not.toContain("fetch(");
  });

  it("secrets GitHub existem somente como env server-side", () => {
    const env = source(".env.example");
    expect(env).toContain("GITHUB_APP_PRIVATE_KEY=");
    expect(env).toContain("GITHUB_APP_CLIENT_SECRET=");
    expect(env).not.toMatch(/VITE_GITHUB/);
    expect(source("src/routes/integracoes.tsx")).not.toMatch(
      /GITHUB_APP_PRIVATE_KEY|GITHUB_APP_CLIENT_SECRET/,
    );
  });

  it("mantém UX de reconexão e URL de gestão em domínio GitHub fixo", () => {
    const route = source("src/routes/integracoes.tsx");
    const functions = source("src/lib/github.functions.ts");
    expect(route).toContain('connection.status === "disconnected" ? "Reconectar" : "Revalidar"');
    expect(route).toContain("Desconectar somente do Mael?");
    expect(route).toContain("não desinstala o GitHub App");
    expect(functions).toContain("https://github.com/settings/installations/");
  });
});
