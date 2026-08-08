import type { ReminderService } from "../services/reminder.service";
import { logger } from "../core/logger";
import { asString, type ToolResult } from "./types";

export class ReminderTool {
  constructor(private readonly reminderService: ReminderService) {}

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
      const reminder = await this.reminderService.create(userId, {
        title,
        notes: asString(args["notes"]),
        remind_at: remindAtRaw,
      });
      return {
        ok: true,
        reply: "",
        toolOutput: {
          kind: "reminder_created",
          title: reminder.title,
          remind_at: reminder.remind_at,
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
