import { describe, expect, it, vi } from "vitest";
import { ReminderTool } from "./reminder.tool";
import { TaskService } from "../services/task.service";
import type { NewTaskInput, TasksRepository } from "../repositories/tasks.repository";
import type { TaskRow } from "../mael-types";

function setup() {
  const create = vi.fn(async (input: NewTaskInput): Promise<TaskRow> => ({
    id: "task-reminder-1",
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
    reminder_enabled: input.reminder_enabled,
    completed: false,
    created_at: "2026-08-08T10:00:00.000Z",
  }));
  const repo = {
    listByUser: vi.fn(async () => []),
    create,
    setCompleted: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
    listRemindersByUser: vi.fn(async () => []),
    setReminderEnabled: vi.fn(async () => {}),
    clearReminder: vi.fn(async () => {}),
    listDueUnnotified: vi.fn(async () => []),
    markNotified: vi.fn(async () => {}),
  } as unknown as TasksRepository;
  return { create, tool: new ReminderTool(new TaskService(repo)) };
}

describe("ReminderTool — adapter P2", () => {
  it("cria uma Task com remind_at e mantém o Tool Output legado", async () => {
    const { create, tool } = setup();

    const result = await tool.createFromArgs("user-1", {
      title: "Consulta",
      notes: "Dentista",
      remind_at: "2026-08-10T18:00:00.000Z",
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({
      userId: "user-1",
      title: "Consulta",
      description: "Dentista",
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
    expect(result).toMatchObject({
      ok: true,
      toolOutput: {
        kind: "reminder_created",
        title: "Consulta",
        remind_at: "2026-08-10T18:00:00.000Z",
      },
    });
  });

  it("não tenta criar sem título ou horário", async () => {
    const { create, tool } = setup();
    const result = await tool.createFromArgs("user-1", { title: "Consulta" });
    expect(result.ok).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });
});
