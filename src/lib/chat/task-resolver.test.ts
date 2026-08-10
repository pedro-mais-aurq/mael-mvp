import { describe, expect, it, vi } from "vitest";

import type { TaskRow } from "../mael-types";
import type { TaskService } from "../services/task.service";
import { TaskResolver } from "./task-resolver";

function task(id: string, title: string, completed = false): TaskRow {
  return {
    id,
    user_id: "user-1",
    title,
    description: "",
    category: "geral",
    priority: "media",
    due_date: null,
    due_time: null,
    due_at: null,
    remind_at: null,
    notified_at: null,
    reminder_enabled: true,
    completed,
    completed_at: null,
    created_at: "2026-08-09T12:00:00.000Z",
  };
}

describe("TaskResolver — resolução controlada pelo backend", () => {
  it("aplica target normalizado ao conjunto canônico do TaskService", async () => {
    const listForMutationResolution = vi.fn(async () => ({
      tasks: [task("a", "Comprar pão hoje"), task("b", "Comprar pão amanhã")],
      truncated: false,
    }));
    const resolver = new TaskResolver({ listForMutationResolution } as unknown as TaskService);

    const result = await resolver.resolve("user-1", [["comprar", "pao"]], "all");

    expect(listForMutationResolution).toHaveBeenCalledWith("user-1", "all");
    expect(result.targets[0]?.candidates.map((candidate) => candidate.id)).toEqual(["a", "b"]);
  });

  it("propaga truncamento absoluto mesmo com um candidato retornado", async () => {
    const listForMutationResolution = vi.fn(async () => ({
      tasks: [task("a", "Consulta")],
      truncated: true,
    }));
    const resolver = new TaskResolver({ listForMutationResolution } as unknown as TaskService);

    await expect(resolver.resolve("user-1", [["consulta"]], "open")).resolves.toMatchObject({
      truncated: true,
      targets: [{ candidates: [{ id: "a" }] }],
    });
  });
});
