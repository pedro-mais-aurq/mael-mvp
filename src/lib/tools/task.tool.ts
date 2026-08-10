import type { Priority, TaskRow } from "../mael-types";
import type { ListTasksInput, TaskService, UpdateTaskInput } from "../services/task.service";
import type { ToolExecutionResult } from "../chat/tool-types";

export interface CreateTaskToolInput {
  title: string;
  description?: string | null | undefined;
  category?: string | null | undefined;
  priority?: Priority | undefined;
  due_at?: string | null | undefined;
  remind_at?: string | null | undefined;
}

export interface UpdateTaskToolInput extends UpdateTaskInput {
  task_id: string;
}

function safeTask(task: TaskRow) {
  return {
    id: task.id,
    title: task.title,
    description: task.description?.slice(0, 500) ?? null,
    category: task.category,
    priority: task.priority,
    due_date: task.due_date,
    due_time: task.due_time,
    due_at: task.due_at ?? null,
    remind_at: task.remind_at ?? null,
    reminder_enabled: task.reminder_enabled ?? true,
    completed: task.completed,
    completed_at: task.completed_at ?? null,
  };
}

export class TaskTool {
  constructor(private readonly taskService: TaskService) {}

  async create(userId: string, input: CreateTaskToolInput): Promise<ToolExecutionResult> {
    const task = await this.taskService.create(userId, {
      ...input,
      priority: input.priority ?? "media",
      due_date: null,
      due_time: null,
      notified_at: null,
      reminder_enabled: true,
    });
    const reminder = Boolean(task.remind_at);
    const persistedOutput = reminder
      ? { kind: "reminder_created", title: task.title, remind_at: task.remind_at ?? null }
      : {
          kind: "task_created",
          title: task.title,
          priority: task.priority,
          due_at: task.due_at ?? null,
          category: task.category,
        };

    return {
      ok: true,
      modelOutput: { ok: true, event: "task_created", task: safeTask(task) },
      persistedOutput,
      fallbackReply: reminder
        ? `Tarefa com lembrete criada: ${task.title}.`
        : `Tarefa criada: ${task.title}.`,
      mutatesTasks: true,
    };
  }

  async list(userId: string, input: ListTasksInput): Promise<ToolExecutionResult> {
    const { tasks, truncated } = await this.taskService.listForTool(userId, input);
    return {
      ok: true,
      modelOutput: {
        ok: true,
        tasks: tasks.map(safeTask),
        truncated,
      },
      persistedOutput: {
        kind: "task_list",
        count: tasks.length,
        truncated,
      },
      fallbackReply:
        tasks.length === 0
          ? "Não encontrei tarefas com esses filtros."
          : `Consultei ${tasks.length} tarefa${tasks.length === 1 ? "" : "s"}.`,
      mutatesTasks: false,
    };
  }

  async update(userId: string, input: UpdateTaskToolInput): Promise<ToolExecutionResult> {
    const { task_id: taskId, ...patch } = input;
    const task = await this.taskService.update(userId, taskId, patch);
    return {
      ok: true,
      modelOutput: { ok: true, event: "task_updated", task: safeTask(task) },
      persistedOutput: {
        kind: "task_updated",
        task: { id: task.id, title: task.title, completed: task.completed },
      },
      fallbackReply: `Tarefa atualizada: ${task.title}.`,
      mutatesTasks: true,
    };
  }

  async setCompleted(
    userId: string,
    input: { task_id: string; completed: boolean },
  ): Promise<ToolExecutionResult> {
    const task = await this.taskService.setCompleted(userId, input.task_id, input.completed);
    return {
      ok: true,
      modelOutput: { ok: true, event: "task_completed", task: safeTask(task) },
      persistedOutput: {
        kind: "task_completed",
        task: { id: task.id, title: task.title, completed: task.completed },
      },
      fallbackReply: input.completed ? "Tarefa marcada como concluída." : "Tarefa reaberta.",
      mutatesTasks: true,
    };
  }

  async delete(userId: string, input: { task_id: string }): Promise<ToolExecutionResult> {
    const task = await this.taskService.delete(userId, input.task_id);
    return {
      ok: true,
      modelOutput: {
        ok: true,
        event: "task_deleted",
        task: { id: task.id, title: task.title },
      },
      persistedOutput: {
        kind: "task_deleted",
        task: { id: task.id, title: task.title },
      },
      fallbackReply: `Tarefa excluída: ${task.title}.`,
      mutatesTasks: true,
    };
  }
}
