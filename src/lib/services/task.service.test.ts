import { describe, expect, it, vi } from "vitest";
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
    legacy_reminder_id: input.legacy_reminder_id,
    reminder_enabled: input.reminder_enabled,
    completed: false,
    completed_at: null,
    created_at: "2026-08-08T10:00:00.000Z",
  };
}

function fakeRepo(overrides: Partial<TasksRepository> = {}): TasksRepository {
  return {
    listByUser: vi.fn(async () => []),
    create: vi.fn(async (input: NewTaskInput) => taskFromInput(input)),
    setCompleted: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
    listRemindersByUser: vi.fn(async () => []),
    setReminderEnabled: vi.fn(async () => {}),
    clearReminder: vi.fn(async () => {}),
    listDueUnnotified: vi.fn(async () => []),
    markNotified: vi.fn(async () => {}),
    ...overrides,
  } as unknown as TasksRepository;
}

describe("TaskService", () => {
  it("cria uma task comum com defaults canônicos", async () => {
    const repo = fakeRepo();
    const service = new TaskService(repo);

    await service.create("user-1", { title: "  Comprar pão  ", priority: "media" });

    expect(repo.create).toHaveBeenCalledWith({
      userId: "user-1",
      title: "Comprar pão",
      description: "",
      category: "geral",
      priority: "media",
      due_date: null,
      due_time: null,
      due_at: null,
      remind_at: null,
      notified_at: null,
      reminder_enabled: true,
      legacy_reminder_id: null,
    });
  });

  it.each([
    {
      name: "due_at",
      input: { due_at: "2026-08-10T09:00:00-03:00" },
      expected: { due_at: "2026-08-10T12:00:00.000Z", remind_at: null },
    },
    {
      name: "remind_at",
      input: { remind_at: "2026-08-10T18:00:00.000Z" },
      expected: { due_at: null, remind_at: "2026-08-10T18:00:00.000Z" },
    },
    {
      name: "due_at e remind_at",
      input: {
        due_at: "2026-08-11T12:00:00.000Z",
        remind_at: "2026-08-10T12:00:00.000Z",
      },
      expected: {
        due_at: "2026-08-11T12:00:00.000Z",
        remind_at: "2026-08-10T12:00:00.000Z",
      },
    },
  ])("cria task com $name", async ({ input, expected }) => {
    const repo = fakeRepo();
    const service = new TaskService(repo);

    await service.create("user-1", { title: "Consulta", priority: "alta", ...input });

    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining(expected));
  });

  it("rejeita timestamps sem offset ou inválidos", () => {
    const service = new TaskService(fakeRepo());
    expect(() =>
      service.create("user-1", {
        title: "Consulta",
        priority: "media",
        due_at: "2026-08-10 08:00",
      }),
    ).toThrow("ISO 8601 com offset");
    expect(() =>
      service.create("user-1", {
        title: "Consulta",
        priority: "media",
        remind_at: "não-é-uma-data",
      }),
    ).toThrow("ISO 8601 com offset");
  });

  it("delega conclusão, lembretes vencidos e notificação ao repository", async () => {
    const repo = fakeRepo();
    const service = new TaskService(repo);
    const now = new Date("2026-08-10T18:00:00.000Z");

    await service.setCompleted("user-1", "task-1", true);
    await service.setReminderEnabled("user-1", "task-1", false);
    await service.setReminderEnabled("user-1", "task-1", true);
    await service.clearReminder("user-1", "task-1");
    await service.listDueReminders(now);
    await service.markNotified("task-1", now);

    expect(repo.setCompleted).toHaveBeenCalledWith("user-1", "task-1", true);
    expect(repo.setReminderEnabled).toHaveBeenNthCalledWith(1, "user-1", "task-1", false);
    expect(repo.setReminderEnabled).toHaveBeenNthCalledWith(2, "user-1", "task-1", true);
    expect(repo.clearReminder).toHaveBeenCalledWith("user-1", "task-1");
    expect(repo.delete).not.toHaveBeenCalled();
    expect(repo.listDueUnnotified).toHaveBeenCalledWith("2026-08-10T18:00:00.000Z");
    expect(repo.markNotified).toHaveBeenCalledWith("task-1", "2026-08-10T18:00:00.000Z");
  });

  it("parseTitleOrThrow e normalizePriority preservam compatibilidade do TaskTool", () => {
    const service = new TaskService(fakeRepo());
    expect(() => service.parseTitleOrThrow("   ")).toThrow();
    expect(service.parseTitleOrThrow(`  ${"a".repeat(300)}  `)).toHaveLength(200);
    expect(service.normalizePriority("alta")).toBe("alta");
    expect(service.normalizePriority("urgentissimo")).toBe("media");
  });
});
