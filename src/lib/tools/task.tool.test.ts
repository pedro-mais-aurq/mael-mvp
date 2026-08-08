import { describe, expect, it } from "vitest";
import { TaskTool } from "./task.tool";
import { TaskService } from "../services/task.service";
import type { TasksRepository } from "../repositories/tasks.repository";
import type { TaskRow } from "../mael-types";

function serviceWithRepo(overrides: Partial<TasksRepository> = {}): TaskService {
  const repo = {
    listByUser: async () => [],
    create: async (input) =>
      ({
        id: "task-1",
        user_id: input.userId,
        title: input.title,
        description: input.description,
        category: input.category,
        priority: input.priority,
        due_date: input.due_date,
        due_time: input.due_time,
        completed: false,
        created_at: new Date().toISOString(),
      }) satisfies TaskRow,
    setCompleted: async () => {},
    delete: async () => {},
    ...overrides,
  } as TasksRepository;
  return new TaskService(repo);
}

describe("TaskTool", () => {
  it("asks for a title when the LLM omits it", async () => {
    const tool = new TaskTool(serviceWithRepo());
    const result = await tool.createFromArgs("user-1", {});
    expect(result.ok).toBe(false);
    expect(result.reply).toContain("título");
  });

  it("creates a task and returns a task_created tool output", async () => {
    const tool = new TaskTool(serviceWithRepo());
    const result = await tool.createFromArgs("user-1", {
      title: "Comprar pão",
      priority: "alta",
      due_date: "2026-08-10",
    });
    expect(result.ok).toBe(true);
    expect(result.toolOutput).toMatchObject({
      kind: "task_created",
      title: "Comprar pão",
      priority: "alta",
      due_date: "2026-08-10",
    });
  });

  it("falls back gracefully if the repository fails", async () => {
    const tool = new TaskTool(
      serviceWithRepo({
        create: async () => {
          throw new Error("db down");
        },
      }),
    );
    const result = await tool.createFromArgs("user-1", { title: "Algo" });
    expect(result.ok).toBe(false);
    expect(result.toolOutput).toBeNull();
  });
});
