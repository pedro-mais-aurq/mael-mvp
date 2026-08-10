import { TasksRepository, type TaskUpdatePatch } from "../repositories/tasks.repository";
import { NotFoundError, ValidationError } from "../core/exceptions";
import type { Priority, TaskRow } from "../mael-types";

const PRIORITIES = new Set<Priority>(["baixa", "media", "alta"]);
const ISO_WITH_OFFSET =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/i;

export interface CreateTaskInput {
  title: string;
  description?: string | null | undefined;
  category?: string | null | undefined;
  priority: Priority;
  due_date?: string | null | undefined;
  due_time?: string | null | undefined;
  due_at?: string | null | undefined;
  remind_at?: string | null | undefined;
  notified_at?: string | null | undefined;
  reminder_enabled?: boolean | undefined;
}

export interface ListTasksInput {
  status?: "open" | "completed" | "all" | undefined;
  has_reminder?: boolean | null | undefined;
  query?: string | undefined;
  due_from?: string | null | undefined;
  due_to?: string | null | undefined;
  limit?: number | undefined;
  /** Filtro interno calculado pelo backend; não faz parte do schema exposto ao LLM. */
  legacy_due_date?: string | null | undefined;
}

export interface UpdateTaskInput {
  title?: string | undefined;
  description?: string | null | undefined;
  category?: string | null | undefined;
  priority?: Priority | undefined;
  due_at?: string | null | undefined;
  remind_at?: string | null | undefined;
  reminder_enabled?: boolean | undefined;
}

export class TaskService {
  constructor(private readonly repo: TasksRepository) {}

  listForUser(userId: string): Promise<TaskRow[]> {
    return this.repo.listByUser(userId);
  }

  async listForTool(
    userId: string,
    input: ListTasksInput,
  ): Promise<{ tasks: TaskRow[]; truncated: boolean }> {
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 50);
    const options = {
      status: input.status ?? "open",
      hasReminder: input.has_reminder ?? null,
      query: this.normalizeSearchQuery(input.query),
      dueFrom: this.normalizeIsoDateTime(input.due_from, "Início do prazo"),
      dueTo: this.normalizeIsoDateTime(input.due_to, "Fim do prazo"),
      limit: limit + 1,
    } as const;
    const [modernRows, legacyRows] = await Promise.all([
      this.repo.listForTool(userId, options),
      input.legacy_due_date
        ? this.repo.listLegacyDueDate(userId, input.legacy_due_date, {
            status: options.status,
            hasReminder: options.hasReminder,
            query: options.query,
            limit: options.limit,
          })
        : Promise.resolve([]),
    ]);
    const byId = new Map<string, TaskRow>();
    for (const task of [...modernRows, ...legacyRows]) byId.set(task.id, task);
    const rows = [...byId.values()].sort((left, right) => {
      if (left.completed !== right.completed) return left.completed ? 1 : -1;
      return right.created_at.localeCompare(left.created_at);
    });
    const truncated = modernRows.length > limit || legacyRows.length > limit || rows.length > limit;
    return { tasks: rows.slice(0, limit), truncated };
  }

  async listForMutationResolution(
    userId: string,
    status: "open" | "completed" | "all",
    limit = 100,
  ): Promise<{ tasks: TaskRow[]; truncated: boolean }> {
    const safeLimit = Math.min(Math.max(limit, 1), 200);
    const rows = await this.repo.listForResolution(userId, {
      status,
      limit: safeLimit + 1,
    });
    return { tasks: rows.slice(0, safeLimit), truncated: rows.length > safeLimit };
  }

  async findForUser(userId: string, id: string): Promise<TaskRow> {
    const task = await this.repo.findById(userId, id);
    if (!task) throw new NotFoundError("Tarefa não encontrada.");
    return task;
  }

  create(userId: string, input: CreateTaskInput): Promise<TaskRow> {
    const title = this.parseTitleOrThrow(input.title);
    if (!PRIORITIES.has(input.priority)) {
      throw new ValidationError("Prioridade da tarefa inválida.");
    }

    return this.repo.create({
      userId,
      title,
      description: input.description ?? "",
      category: input.category ?? "geral",
      priority: input.priority,
      due_date: input.due_date ?? null,
      due_time: input.due_time ?? null,
      due_at: this.normalizeIsoDateTime(input.due_at, "Prazo"),
      remind_at: this.normalizeIsoDateTime(input.remind_at, "Data do lembrete"),
      notified_at: this.normalizeIsoDateTime(input.notified_at, "Data da notificação"),
      reminder_enabled: input.reminder_enabled ?? true,
      legacy_reminder_id: null,
    });
  }

  async update(userId: string, id: string, input: UpdateTaskInput): Promise<TaskRow> {
    const patch: TaskUpdatePatch = {};
    if (Object.hasOwn(input, "title")) patch.title = this.parseTitleOrThrow(input.title);
    if (Object.hasOwn(input, "description")) patch.description = input.description?.trim() ?? "";
    if (Object.hasOwn(input, "category")) patch.category = input.category?.trim() || "geral";
    if (Object.hasOwn(input, "priority")) {
      if (!input.priority || !PRIORITIES.has(input.priority)) {
        throw new ValidationError("Prioridade da tarefa inválida.");
      }
      patch.priority = input.priority;
    }
    if (Object.hasOwn(input, "due_at")) {
      patch.due_at = this.normalizeIsoDateTime(input.due_at, "Prazo");
    }
    if (Object.hasOwn(input, "remind_at")) {
      patch.remind_at = this.normalizeIsoDateTime(input.remind_at, "Data do lembrete");
      patch.notified_at = null;
      if (!Object.hasOwn(input, "reminder_enabled")) patch.reminder_enabled = true;
    }
    if (input.reminder_enabled !== undefined) {
      patch.reminder_enabled = input.reminder_enabled;
    }
    if (Object.keys(patch).length === 0) {
      throw new ValidationError("Informe ao menos um campo para atualizar.");
    }

    const task = await this.repo.update(userId, id, patch);
    if (!task) throw new NotFoundError("Tarefa não encontrada.");
    return task;
  }

  async setCompleted(userId: string, id: string, completed: boolean): Promise<TaskRow> {
    const task = await this.repo.setCompleted(userId, id, completed);
    if (!task) throw new NotFoundError("Tarefa não encontrada.");
    return task;
  }

  async delete(userId: string, id: string): Promise<TaskRow> {
    const task = await this.repo.delete(userId, id);
    if (!task) throw new NotFoundError("Tarefa não encontrada.");
    return task;
  }

  listReminderTasks(userId: string): Promise<TaskRow[]> {
    return this.repo.listRemindersByUser(userId);
  }

  async setReminderEnabled(userId: string, id: string, enabled: boolean): Promise<TaskRow> {
    const task = await this.repo.setReminderEnabled(userId, id, enabled);
    if (!task) throw new NotFoundError("Tarefa não encontrada.");
    return task;
  }

  async clearReminder(userId: string, id: string): Promise<TaskRow> {
    const task = await this.repo.clearReminder(userId, id);
    if (!task) throw new NotFoundError("Tarefa não encontrada.");
    return task;
  }

  listDueReminders(now: Date): Promise<TaskRow[]> {
    return this.repo.listDueUnnotified(now.toISOString());
  }

  markNotified(id: string, now: Date): Promise<void> {
    return this.repo.markNotified(id, now.toISOString());
  }

  /**
   * Validação tolerante para args extraídos pelo LLM (TaskTool): título é a
   * única exigência dura, o resto recebe defaults sensatos. Lança
   * ValidationError (nunca deixa o Tool inserir lixo no banco).
   */
  parseTitleOrThrow(rawTitle: unknown): string {
    const title = typeof rawTitle === "string" ? rawTitle.trim() : "";
    if (!title) throw new ValidationError("Título da tarefa é obrigatório.");
    return title.slice(0, 200);
  }

  normalizePriority(raw: unknown): Priority {
    const value = typeof raw === "string" ? raw : "media";
    return PRIORITIES.has(value as Priority) ? (value as Priority) : "media";
  }

  private normalizeIsoDateTime(value: string | null | undefined, label: string): string | null {
    if (value == null || value === "") return null;
    if (!ISO_WITH_OFFSET.test(value)) {
      throw new ValidationError(`${label} inválida: informe ISO 8601 com offset.`);
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new ValidationError(`${label} inválida.`);
    }
    return date.toISOString();
  }

  private normalizeSearchQuery(value: string | null | undefined): string | null {
    if (value == null) return null;
    const query = Array.from(value, (character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127 ? " " : character;
    })
      .join("")
      .trim()
      .slice(0, 120);
    return query || null;
  }
}
