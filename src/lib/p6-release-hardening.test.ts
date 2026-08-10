import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const source = (path: string) => readFileSync(resolve(ROOT, path), "utf8");

describe("P6 — release hardening architecture", () => {
  it("mantém .env.example mínimo e protege envs reais", () => {
    expect(source(".env.example").trim().split(/\r?\n/)).toEqual([
      "SUPABASE_URL=",
      "SUPABASE_PUBLISHABLE_KEY=",
      "SUPABASE_SERVICE_ROLE_KEY=",
      "",
      "VITE_SUPABASE_URL=",
      "VITE_SUPABASE_PUBLISHABLE_KEY=",
      "",
      "OPENROUTER_API_KEY=",
      "",
      "GITHUB_APP_ID=",
      "GITHUB_APP_SLUG=",
      "GITHUB_APP_CLIENT_ID=",
      "GITHUB_APP_CLIENT_SECRET=",
      "GITHUB_APP_PRIVATE_KEY=",
    ]);
    const gitignore = source(".gitignore");
    expect(gitignore).toContain(".env\n");
    expect(gitignore).toContain(".env.*");
    expect(gitignore).toContain("!.env.example");
    expect(source(".env.example")).not.toMatch(/VITE_(?:SUPABASE_SERVICE|GITHUB|OPENROUTER)/);
  });

  it("remove mensagem operacional obsoleta sem remover integração de build", () => {
    const middleware = source("src/integrations/supabase/auth-middleware.ts");
    const server = source("src/integrations/supabase/client.server.ts");
    expect(`${middleware}\n${server}`).not.toContain("Connect Supabase in Lovable Cloud");
    expect(`${middleware}\n${server}`).toContain(
      "Configure the required Supabase environment variables",
    );
    expect(source("vite.config.ts")).toContain("@lovable.dev/vite-tanstack-config");
  });

  it("preserva schema e rota legados sem experiência paralela", () => {
    const migrations = readdirSync(resolve(ROOT, "supabase/migrations"))
      .filter((name) => name.endsWith(".sql"))
      .map((name) => source(`supabase/migrations/${name}`))
      .join("\n");
    expect(migrations).not.toMatch(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?reminders/i);
    expect(migrations).not.toMatch(/DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?(?:due_date|due_time)/i);
    expect(source("src/routes/lembretes.tsx")).toContain('redirect({ to: "/tarefas" })');
    expect(source("src/lib/reminders.functions.ts")).toContain("ReminderService");
  });

  it("inclui documentação real do candidato sem inventar versão", () => {
    expect(source("CHANGELOG.md")).toContain("## Alpha 0.1");
    expect(source("P6_RELEASE_CHECKLIST.md")).toContain("## Smoke test pós-deploy");
    const packageJson = JSON.parse(source("package.json")) as Record<string, unknown>;
    expect(packageJson["version"]).toBeUndefined();
  });
});
