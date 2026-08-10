import { describe, expect, it } from "vitest";
import type { ProfileRow, ReminderRow, TaskRow } from "./mael-types";

/**
 * Regressão da correção da P1: os campos novos (`timezone`, `due_at`,
 * `remind_at`, `notified_at`, `legacy_reminder_id`, `reminder_enabled`)
 * precisam ser opcionais nos tipos de domínio
 * manuais, para que objetos moldados como na P0 (antes desses campos
 * existirem) continuem satisfazendo o contrato TypeScript. Se algum desses
 * campos voltar a ser obrigatório, este arquivo deixa de compilar.
 */
describe("mael-types — compatibilidade P0 → P1", () => {
  it("aceita um ProfileRow no formato antigo (sem timezone)", () => {
    const profile: ProfileRow = {
      id: "user-1",
      name: "Fulano",
      master_salt: "salt",
      master_verifier: "verifier",
      created_at: new Date().toISOString(),
    };
    expect(profile.timezone).toBeUndefined();
  });

  it("também aceita um ProfileRow com timezone (formato P1)", () => {
    const profile: ProfileRow = {
      id: "user-1",
      name: "Fulano",
      timezone: "America/Sao_Paulo",
      master_salt: "salt",
      master_verifier: "verifier",
      created_at: new Date().toISOString(),
    };
    expect(profile.timezone).toBe("America/Sao_Paulo");
  });

  it("aceita um TaskRow no formato antigo (sem due_at/remind_at/notified_at)", () => {
    const task: TaskRow = {
      id: "task-1",
      user_id: "user-1",
      title: "Comprar pão",
      description: null,
      category: "geral",
      priority: "media",
      due_date: "2026-08-10",
      due_time: "08:00",
      completed: false,
      created_at: new Date().toISOString(),
    };
    expect(task.due_at).toBeUndefined();
    expect(task.legacy_reminder_id).toBeUndefined();
    expect(task.reminder_enabled).toBeUndefined();
    expect(task.due_date).toBe("2026-08-10");
  });

  it("também aceita um TaskRow com os campos novos (formato P1)", () => {
    const task: TaskRow = {
      id: "task-1",
      user_id: "user-1",
      title: "Comprar pão",
      description: null,
      category: "geral",
      priority: "media",
      due_date: "2026-08-10",
      due_time: "08:00",
      due_at: "2026-08-10T11:00:00Z",
      remind_at: null,
      notified_at: null,
      legacy_reminder_id: "reminder-1",
      reminder_enabled: false,
      completed: false,
      created_at: new Date().toISOString(),
    };
    expect(task.due_at).toBe("2026-08-10T11:00:00Z");
    expect(task.legacy_reminder_id).toBe("reminder-1");
    expect(task.reminder_enabled).toBe(false);
  });

  it("aceita um ReminderRow no formato antigo (sem notified_at)", () => {
    const reminder: ReminderRow = {
      id: "reminder-1",
      user_id: "user-1",
      title: "Ligar pro dentista",
      notes: null,
      remind_at: new Date().toISOString(),
      active: true,
      created_at: new Date().toISOString(),
    };
    expect(reminder.notified_at).toBeUndefined();
  });

  it("também aceita um ReminderRow com notified_at (formato P1)", () => {
    const reminder: ReminderRow = {
      id: "reminder-1",
      user_id: "user-1",
      title: "Ligar pro dentista",
      notes: null,
      remind_at: new Date().toISOString(),
      active: true,
      notified_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    };
    expect(reminder.notified_at).not.toBeUndefined();
  });
});
