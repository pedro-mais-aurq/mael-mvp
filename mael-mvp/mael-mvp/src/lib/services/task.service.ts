import { TasksRepository } from "../repositories/tasks.repository";
import { ValidationError } from "../core/exceptions";
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

export class TaskService {
  constructor(private readonly repo: TasksRepository) {}

  listForUser(userId: string): Promise<TaskRow[]> {
    return this.repo.listByUser(userId);
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

  setCompleted(userId: string, id: string, completed: boolean): Promise<void> {
    return this.repo.setCompleted(userId, id, completed);
  }

  delete(userId: string, id: string): Promise<void> {
    return this.repo.delete(userId, id);
  }

  listReminderTasks(userId: string): Promise<TaskRow[]> {
    return this.repo.listRemindersByUser(userId);
  }

  setReminderEnabled(userId: string, id: string, enabled: boolean): Promise<void> {
    return this.repo.setReminderEnabled(userId, id, enabled);
  }

  clearReminder(userId: string, id: string): Promise<void> {
    return this.repo.clearReminder(userId, id);
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
}
