import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const route = readFileSync(new URL("./tarefas.tsx", import.meta.url), "utf8");

describe("/tarefas — regressão dos controles de lembrete", () => {
  it("oferece silenciar, reativar e remover sem reutilizar a exclusão da tarefa", () => {
    expect(route).toContain("Silenciar lembrete");
    expect(route).toContain("Reativar lembrete");
    expect(route).toContain("Remover lembrete");
    expect(route).toContain("onSetReminderEnabled(task.id, !reminderEnabled)");
    expect(route).toContain("onClearReminder(task.id)");
    expect(route).not.toContain("onClick={() => onDelete(task.id)}>\n                <X");
  });

  it("chama apenas as server functions canônicas de Task para esses controles", () => {
    expect(route).toContain("setTaskReminderEnabled({ data: { taskId, enabled } })");
    expect(route).toContain("clearTaskReminder({ data: { taskId } })");
    expect(route).not.toContain("reminders.functions");
  });
});
