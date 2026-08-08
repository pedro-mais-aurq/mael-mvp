import type { TaskService } from "../services/task.service";
import { ValidationError } from "../core/exceptions";
import { logger } from "../core/logger";
import { asDateOnly, asString, asTimeOnly, type ToolResult } from "./types";

export class TaskTool {
  constructor(private readonly taskService: TaskService) {}

  async createFromArgs(userId: string, args: Record<string, unknown>): Promise<ToolResult> {
    let title: string;
    try {
      title = this.taskService.parseTitleOrThrow(args["title"]);
    } catch (err) {
      if (err instanceof ValidationError) {
        return { ok: false, reply: "Qual é o título da tarefa?", toolOutput: null };
      }
      throw err;
    }

    const priority = this.taskService.normalizePriority(args["priority"]);
    try {
      const task = await this.taskService.create(userId, {
        title,
        description: asString(args["description"]),
        category: asString(args["category"]),
        priority,
        due_date: asDateOnly(args["due_date"]),
        due_time: asTimeOnly(args["due_time"]),
      });

      return {
        ok: true,
        reply: "", // ChatService usa o assistant_reply do modelo quando ok=true
        toolOutput: {
          kind: "task_created",
          title: task.title,
          priority: task.priority,
          due_date: task.due_date,
          due_time: task.due_time,
          category: task.category,
        },
      };
    } catch (err) {
      // Regra do MVP (item 7): a mensagem genérica continua indo para o
      // usuário, mas o erro técnico real (RLS, schema, constraint, conexão)
      // precisa ficar registrado para diagnóstico — nunca ser engolido.
      logger.error("Falha ao criar tarefa via Tool", err, {
        route: "task.tool.createFromArgs",
        userId,
      });
      return {
        ok: false,
        reply: "Não consegui salvar essa tarefa agora. Tente novamente.",
        toolOutput: null,
      };
    }
  }
}
