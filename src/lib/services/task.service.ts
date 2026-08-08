import { TasksRepository } from "../repositories/tasks.repository";
import { ValidationError } from "../core/exceptions";
import type { Priority, TaskRow } from "../mael-types";

const PRIORITIES = new Set<Priority>(["baixa", "media", "alta"]);

export interface CreateTaskInput {
  title: string;
  description?: string | null | undefined;
  category?: string | null | undefined;
  priority: Priority;
  due_date?: string | null | undefined;
  due_time?: string | null | undefined;
}

export class TaskService {
  constructor(private readonly repo: TasksRepository) {}

  listForUser(): Promise<TaskRow[]> {
    return this.repo.listByUser();
  }

  create(userId: string, input: CreateTaskInput): Promise<TaskRow> {
    return this.repo.create({
      userId,
      title: input.title,
      description: input.description ?? "",
      category: input.category ?? "geral",
      priority: input.priority,
      due_date: input.due_date ?? null,
      due_time: input.due_time ?? null,
    });
  }

  setCompleted(userId: string, id: string, completed: boolean): Promise<void> {
    return this.repo.setCompleted(userId, id, completed);
  }

  delete(userId: string, id: string): Promise<void> {
    return this.repo.delete(userId, id);
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
}
