import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const chatRoute = readFileSync(new URL("./index.tsx", import.meta.url), "utf8");
const taskTool = readFileSync(new URL("../lib/tools/task.tool.ts", import.meta.url), "utf8");

describe("Chat UI — persisted output minimizado", () => {
  it("renderiza vault_matches por match_count sem depender de entries", () => {
    expect(chatRoute).toContain('kind: "vault_matches"; match_count?: number');
    expect(chatRoute).toContain("Cofre consultado");
    expect(chatRoute).not.toContain("output.entries");
  });

  it("renderiza task_list por count sem persistir IDs ou títulos", () => {
    expect(chatRoute).toContain('kind: "task_list"; count?: number');
    expect(chatRoute).not.toContain("output.tasks");
    expect(taskTool).toContain('kind: "task_list"');
    expect(taskTool).toContain("count: tasks.length");
    expect(taskTool).not.toContain(
      "tasks: tasks.map((task) => ({ id: task.id, title: task.title }))",
    );
  });
});
