import { describe, expect, it, vi } from "vitest";

import type { TaskRow } from "../mael-types";
import type { TaskService } from "../services/task.service";
import { TaskTool } from "./task.tool";

const TASK_ID = "11111111-1111-4111-8111-111111111111";

function task(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id: TASK_ID,
    user_id: "user-1",
    title: "Comprar pão",
    description: "Integral",
    category: "casa",
    priority: "media",
    due_date: null,
    due_time: null,
    due_at: null,
    remind_at: null,
    notified_at: null,
    legacy_reminder_id: "legacy-secret-id",
    reminder_enabled: true,
    completed: false,
    completed_at: null,
    created_at: "2026-08-09T12:00:00.000Z",
    ...overrides,
  };
}

function setup(overrides: Partial<TaskService> = {}) {
  const service = {
    create: vi.fn(async () => task()),
    listForTool: vi.fn(async () => ({ tasks: [task()], truncated: false })),
    update: vi.fn(async () => task({ title: "Comprar pão e leite" })),
    setCompleted: vi.fn(async (_userId: string, _id: string, completed: boolean) =>
      task({ completed, completed_at: completed ? "2026-08-09T13:00:00.000Z" : null }),
    ),
    delete: vi.fn(async () => task()),
    ...overrides,
  } as unknown as TaskService;
  return { service, tool: new TaskTool(service) };
}

describe("TaskTool — operações reais da P3", () => {
  it("cria Task comum e delega o userId autenticado", async () => {
    const { service, tool } = setup();
    const result = await tool.create("user-1", { title: "Comprar pão", priority: "alta" });

    expect(service.create).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({
        title: "Comprar pão",
        priority: "alta",
        due_date: null,
        due_time: null,
        notified_at: null,
      }),
    );
    expect(result).toMatchObject({
      ok: true,
      persistedOutput: { kind: "task_created", title: "Comprar pão" },
      mutatesTasks: true,
    });
  });

  it("representa lembrete como create_task com remind_at", async () => {
    const remindAt = "2026-08-10T15:00:00.000Z";
    const { tool } = setup({
      create: vi.fn(async () => task({ title: "Consulta", remind_at: remindAt })),
    });
    const result = await tool.create("user-1", { title: "Consulta", remind_at: remindAt });
    expect(result.persistedOutput).toEqual({
      kind: "reminder_created",
      title: "Consulta",
      remind_at: remindAt,
    });
  });

  it("lista somente campos seguros e sinaliza truncamento", async () => {
    const { tool } = setup({
      listForTool: vi.fn(async () => ({ tasks: [task()], truncated: true })),
    });
    const result = await tool.list("user-1", { status: "open", limit: 1 });
    const serialized = JSON.stringify(result.modelOutput);
    expect(serialized).toContain(TASK_ID);
    expect(serialized).toContain('"truncated":true');
    expect(serialized).not.toContain("user_id");
    expect(serialized).not.toContain("legacy-secret-id");
    expect(result.persistedOutput).toEqual({
      kind: "task_list",
      count: 1,
      truncated: true,
    });
    expect(JSON.stringify(result.persistedOutput)).not.toContain("Integral");
  });

  it("atualiza, conclui, reabre e exclui pela camada de serviço", async () => {
    const { service, tool } = setup();
    await expect(
      tool.update("user-1", { task_id: TASK_ID, title: "Comprar pão e leite" }),
    ).resolves.toMatchObject({ persistedOutput: { kind: "task_updated" } });
    await expect(
      tool.setCompleted("user-1", { task_id: TASK_ID, completed: true }),
    ).resolves.toMatchObject({ fallbackReply: "Tarefa marcada como concluída." });
    await expect(
      tool.setCompleted("user-1", { task_id: TASK_ID, completed: false }),
    ).resolves.toMatchObject({ fallbackReply: "Tarefa reaberta." });
    await expect(tool.delete("user-1", { task_id: TASK_ID })).resolves.toMatchObject({
      persistedOutput: { kind: "task_deleted", task: { id: TASK_ID } },
    });
    expect(service.update).toHaveBeenCalledWith("user-1", TASK_ID, {
      title: "Comprar pão e leite",
    });
    expect(service.delete).toHaveBeenCalledWith("user-1", TASK_ID);
  });
});
