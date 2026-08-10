import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("arquitetura P2 — Task como domínio canônico", () => {
  it("compõe as server functions legadas sobre TaskService/TasksRepository", () => {
    const functions = source("./reminders.functions.ts");
    expect(functions).toContain(
      "new ReminderService(new TaskService(new TasksRepository(supabase)))",
    );
    expect(functions).not.toContain("RemindersRepository");
    expect(functions).not.toContain('.from("reminders")');
  });

  it("mantém ReminderTool apenas como adapter legado, fora do Chat P3", () => {
    const chatServer = source("./chat.server.ts");
    const reminderTool = source("./tools/reminder.tool.ts");
    expect(reminderTool).toContain("export class ReminderTool");
    expect(chatServer).not.toContain("ReminderTool");
    expect(chatServer).toContain(
      "new ToolRegistry(taskTool, vaultSearchTool, taskResolver, githubTool)",
    );
    expect(chatServer).not.toContain("RemindersRepository");
    expect(chatServer).not.toContain("ReminderService");
  });

  it("scheduler consulta e marca notificações no TaskService", () => {
    const scheduler = source("./scheduler/reminder-scheduler.ts");
    expect(scheduler).toContain("this.taskService.listDueReminders(now)");
    expect(scheduler).toContain("this.taskService.markNotified(task.id, now)");
    expect(scheduler).not.toContain("ReminderService");
  });

  it("expõe controles canônicos de lembrete com autenticação e validação", () => {
    const functions = source("./tasks.functions.ts");
    expect(functions).toContain("export const setTaskReminderEnabled");
    expect(functions).toContain("export const clearTaskReminder");
    expect(functions).toContain(".middleware([requireSupabaseAuth])");
    expect(functions).toContain("taskId: z.string().uuid()");
    expect(functions).toContain("taskService(supabase).setReminderEnabled");
    expect(functions).toContain("taskService(supabase).clearReminder");
    expect(functions).not.toContain('.from("reminders")');
  });

  it("faz /tarefas operar lembretes somente pelas server functions de Task", () => {
    const route = source("../routes/tarefas.tsx");
    expect(route).toContain("setTaskReminderEnabled");
    expect(route).toContain("clearTaskReminder");
    expect(route).not.toContain("reminders.functions");
  });
});
