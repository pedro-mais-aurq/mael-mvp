import type { TaskService } from "../services/task.service";
import { logger } from "../core/logger";
import { asString, type ToolResult } from "./types";

export class ReminderTool {
  constructor(private readonly taskService: TaskService) {}

  async createFromArgs(userId: string, args: Record<string, unknown>): Promise<ToolResult> {
    const title = asString(args["title"]);
    const remindAtRaw = asString(args["remind_at"]);

    if (!title || !remindAtRaw) {
      return {
        ok: false,
        reply: "Para criar o lembrete preciso saber o momento exato. Para quando devo marcá-lo?",
        toolOutput: null,
      };
    }

    try {
      const task = await this.taskService.create(userId, {
        title,
        description: asString(args["notes"]),
        category: "geral",
        priority: "media",
        remind_at: remindAtRaw,
        reminder_enabled: true,
      });
      return {
        ok: true,
        reply: "",
        toolOutput: {
          kind: "reminder_created",
          title: task.title,
          remind_at: task.remind_at ?? remindAtRaw,
        },
      };
    } catch (err) {
      // Regra do MVP (item 7): a mensagem genérica continua indo para o
      // usuário, mas o erro técnico real (RLS, schema, constraint, conexão)
      // precisa ficar registrado para diagnóstico — nunca ser engolido.
      logger.error("Falha ao criar lembrete via Tool", err, {
        route: "reminder.tool.createFromArgs",
        userId,
      });
      return {
        ok: false,
        reply: "Não consegui salvar esse lembrete agora. Tente novamente.",
        toolOutput: null,
      };
    }
  }
}
