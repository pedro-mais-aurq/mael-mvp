import { describe, expect, it } from "vitest";
import { ReminderService } from "./reminder.service";
import type { RemindersRepository } from "../repositories/reminders.repository";
import type { ReminderRow } from "../mael-types";

function fakeRepo(overrides: Partial<RemindersRepository> = {}): RemindersRepository {
  return {
    listByUser: async () => [],
    create: async (input) =>
      ({
        id: "reminder-1",
        user_id: input.userId,
        title: input.title,
        notes: input.notes,
        remind_at: input.remind_at,
        active: true,
        created_at: new Date().toISOString(),
      }) satisfies ReminderRow,
    setActive: async () => {},
    delete: async () => {},
    listDueUnnotified: async () => [],
    markNotified: async () => {},
    ...overrides,
  } as RemindersRepository;
}

describe("ReminderService", () => {
  it("creates a reminder with a valid ISO date", async () => {
    const service = new ReminderService(fakeRepo());
    const reminder = await service.create("user-1", {
      title: "Regar plantas",
      remind_at: "2026-08-10T18:00:00.000Z",
    });
    expect(reminder.title).toBe("Regar plantas");
    expect(reminder.remind_at).toBe("2026-08-10T18:00:00.000Z");
  });

  it("rejects an invalid date", async () => {
    const service = new ReminderService(fakeRepo());
    await expect(
      service.create("user-1", { title: "Algo", remind_at: "não-é-uma-data" }),
    ).rejects.toThrow("Data do lembrete inválida.");
  });
});
