import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../../../supabase/migrations/20260809010000_alpha_0_1_unify_tasks_reminders.sql",
    import.meta.url,
  ),
  "utf8",
).replace(/\s+/g, " ");

const finalizationMigration = readFileSync(
  new URL(
    "../../../supabase/migrations/20260809020000_alpha_0_1_finalize_task_reminder_unification.sql",
    import.meta.url,
  ),
  "utf8",
).replace(/\s+/g, " ");

describe("migration P2 — tasks/reminders", () => {
  it("adiciona rastreabilidade, estado ativo e unicidade parcial", () => {
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS legacy_reminder_id UUID");
    expect(migration).toContain(
      "ADD COLUMN IF NOT EXISTS reminder_enabled BOOLEAN NOT NULL DEFAULT true",
    );
    expect(migration).toContain("CREATE UNIQUE INDEX IF NOT EXISTS");
    expect(migration).toContain("WHERE legacy_reminder_id IS NOT NULL");
  });

  it("mapeia integralmente um reminder legado para exatamente uma task", () => {
    expect(migration).toMatch(/reminder\.user_id, reminder\.title, reminder\.notes/);
    expect(migration).toMatch(
      /reminder\.remind_at, reminder\.notified_at, reminder\.active, reminder\.id/,
    );
    expect(migration).toMatch(/reminder\.created_at, reminder\.updated_at/);
    expect(migration).toContain("task.legacy_reminder_id = reminder.id");
  });

  it("é idempotente por identidade, não por contagem ou ordem", () => {
    expect(migration).toContain("WHERE NOT EXISTS");
    expect(migration).toContain(
      "ON CONFLICT (legacy_reminder_id) WHERE legacy_reminder_id IS NOT NULL DO NOTHING",
    );
  });

  it("preserva active, notified_at e notes também na trigger de transição", () => {
    expect(migration).toMatch(/NEW\.notes, 'geral', 'media'/);
    expect(migration).toMatch(/NEW\.remind_at, NEW\.notified_at, NEW\.active, NEW\.id/);
    expect(migration).toContain("reminder_enabled = EXCLUDED.reminder_enabled");
    expect(migration).toContain("notified_at = EXCLUDED.notified_at");
    expect(migration).toContain("AFTER INSERT OR UPDATE OR DELETE ON public.reminders");
  });

  it("não converte due_date/due_time e não remove o legado físico", () => {
    expect(migration).not.toMatch(/DROP\s+(TABLE|COLUMN)/i);
    expect(migration).not.toMatch(/America\/Sao_Paulo|AT TIME ZONE|'UTC'/i);
  });

  it("encerra apenas a ponte temporária na migration de finalização", () => {
    expect(finalizationMigration).toContain(
      "DROP TRIGGER IF EXISTS sync_legacy_reminder_to_task_trigger ON public.reminders",
    );
    expect(finalizationMigration).toContain(
      "DROP FUNCTION IF EXISTS public.sync_legacy_reminder_to_task()",
    );
    expect(finalizationMigration).not.toMatch(/DROP\s+(TABLE|COLUMN)/i);
    expect(finalizationMigration).not.toContain("SECURITY DEFINER");
  });
});
