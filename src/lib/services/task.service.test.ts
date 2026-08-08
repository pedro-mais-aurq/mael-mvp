import { describe, expect, it } from "vitest";
import { TaskService } from "./task.service";
import type { TasksRepository } from "../repositories/tasks.repository";
import type { TaskRow } from "../mael-types";

function fakeRepo(overrides: Partial<TasksRepository> = {}): TasksRepository {
  return {
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
}

describe("TaskService", () => {
  it("creates a task with the given fields", async () => {
    const service = new TaskService(fakeRepo());
    const task = await service.create("user-1", {
      title: "Comprar pão",
      priority: "media",
    });
    expect(task.title).toBe("Comprar pão");
    expect(task.priority).toBe("media");
  });

  it("parseTitleOrThrow rejects empty titles", () => {
    const service = new TaskService(fakeRepo());
    expect(() => service.parseTitleOrThrow("   ")).toThrow();
    expect(() => service.parseTitleOrThrow(undefined)).toThrow();
  });

  it("parseTitleOrThrow trims and caps length", () => {
    const service = new TaskService(fakeRepo());
    expect(service.parseTitleOrThrow("  Regar plantas  ")).toBe("Regar plantas");
    expect(service.parseTitleOrThrow("a".repeat(300)).length).toBe(200);
  });

  it("normalizePriority falls back to media for invalid values", () => {
    const service = new TaskService(fakeRepo());
    expect(service.normalizePriority("alta")).toBe("alta");
    expect(service.normalizePriority("urgentissimo")).toBe("media");
    expect(service.normalizePriority(undefined)).toBe("media");
  });
});
