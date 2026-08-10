import { describe, expect, it, vi } from "vitest";
import { ReminderService } from "./reminder.service";
import { TaskService } from "./task.service";
import type { NewTaskInput, TasksRepository } from "../repositories/tasks.repository";
import type { TaskRow } from "../mael-types";

function taskFromInput(input: NewTaskInput): TaskRow {
  return {
    id: "task-1",
    user_id: input.userId,
    title: input.title,
    description: input.description,
    category: input.category,
    priority: input.priority,
    due_date: input.due_date,
    due_time: input.due_time,
    due_at: input.due_at,
    remind_at: input.remind_at,
    notified_at: input.notified_at,
    legacy_reminder_id: null,
    reminder_enabled: input.reminder_enabled,
    completed: false,
    created_at: "2026-08-08T10:00:00.000Z",
  };
}

function setup() {
  const existing = taskFromInput({
    userId: "user-1",
    title: "Regar plantas",
    description: "",
    category: "geral",
    priority: "media",
    due_date: null,
    due_time: null,
    due_at: null,
    remind_at: "2026-08-10T18:00:00.000Z",
    notified_at: null,
    reminder_enabled: true,
    legacy_reminder_id: null,
  });
  const repo = {
    listByUser: vi.fn(async () => []),
    create: vi.fn(async (input: NewTaskInput) => taskFromInput(input)),
    setCompleted: vi.fn(async () => existing),
    delete: vi.fn(async () => existing),
    listRemindersByUser: vi.fn(async () => []),
    setReminderEnabled: vi.fn(async () => existing),
    clearReminder: vi.fn(async () => existing),
    listDueUnnotified: vi.fn(async () => []),
    markNotified: vi.fn(async () => {}),
  } as unknown as TasksRepository;
  const service = new ReminderService(new TaskService(repo));
  return { repo, service };
}

describe("ReminderService — adapter P2", () => {
  it("cria uma Task e a mapeia para o contrato ReminderRow", async () => {
    const { repo, service } = setup();

    const reminder = await service.create("user-1", {
      title: "Regar plantas",
      notes: "Usar pouca água",
      remind_at: "2026-08-10T18:00:00.000Z",
    });

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        title: "Regar plantas",
        description: "Usar pouca água",
        category: "geral",
        priority: "media",
        remind_at: "2026-08-10T18:00:00.000Z",
        reminder_enabled: true,
        legacy_reminder_id: null,
      }),
    );
    expect(reminder).toMatchObject({
      id: "task-1",
      title: "Regar plantas",
      notes: "Usar pouca água",
      remind_at: "2026-08-10T18:00:00.000Z",
      active: true,
    });
  });

  it("lista somente tasks com remind_at e preserva active/notified_at", async () => {
    const { repo, service } = setup();
    vi.mocked(repo.listRemindersByUser).mockResolvedValue([
      {
        id: "task-2",
        user_id: "user-1",
        title: "Consulta",
        description: "Dentista",
        category: "geral",
        priority: "media",
        due_date: null,
        due_time: null,
        remind_at: "2026-08-12T15:00:00.000Z",
        notified_at: "2026-08-12T15:01:00.000Z",
        reminder_enabled: false,
        completed: false,
        created_at: "2026-08-08T10:00:00.000Z",
      },
    ]);

    await expect(service.listForUser("user-1")).resolves.toEqual([
      expect.objectContaining({
        id: "task-2",
        notes: "Dentista",
        active: false,
        notified_at: "2026-08-12T15:01:00.000Z",
      }),
    ]);
    expect(repo.listRemindersByUser).toHaveBeenCalledWith("user-1");
  });

  it("toggle altera reminder_enabled e delete limpa apenas o lembrete", async () => {
    const { repo, service } = setup();

    await service.setActive("user-1", "task-1", false);
    await service.delete("user-1", "task-1");

    expect(repo.setReminderEnabled).toHaveBeenCalledWith("user-1", "task-1", false);
    expect(repo.clearReminder).toHaveBeenCalledWith("user-1", "task-1");
    expect(repo.delete).not.toHaveBeenCalled();
  });

  it("rejeita uma data sem offset por meio do TaskService", async () => {
    const { service } = setup();
    await expect(
      service.create("user-1", { title: "Algo", remind_at: "2026-08-10 18:00" }),
    ).rejects.toThrow("ISO 8601 com offset");
  });
});
