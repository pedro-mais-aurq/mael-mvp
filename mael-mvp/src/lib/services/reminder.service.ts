import type { ReminderRow, TaskRow } from "../mael-types";
import { TaskService } from "./task.service";

export interface CreateReminderInput {
  title: string;
  notes?: string | null | undefined;
  remind_at: string;
}

/**
 * @deprecated Adapter de compatibilidade P2. Remover junto dos endpoints
 * legados na P3; toda persistência já é delegada ao domínio Task.
 */
export class ReminderService {
  constructor(private readonly taskService: TaskService) {}

  async listForUser(userId: string): Promise<ReminderRow[]> {
    const tasks = await this.taskService.listReminderTasks(userId);
    return tasks.map(toReminderRow);
  }

  async create(userId: string, input: CreateReminderInput): Promise<ReminderRow> {
    const task = await this.taskService.create(userId, {
      title: input.title,
      description: input.notes ?? "",
      category: "geral",
      priority: "media",
      remind_at: input.remind_at,
      reminder_enabled: true,
    });
    return toReminderRow(task);
  }

  async setActive(userId: string, id: string, active: boolean): Promise<void> {
    await this.taskService.setReminderEnabled(userId, id, active);
  }

  async delete(userId: string, id: string): Promise<void> {
    await this.taskService.clearReminder(userId, id);
  }

  async listDue(now: Date): Promise<ReminderRow[]> {
    const tasks = await this.taskService.listDueReminders(now);
    return tasks.map(toReminderRow);
  }

  markNotified(id: string, now: Date): Promise<void> {
    return this.taskService.markNotified(id, now);
  }
}

export function toReminderRow(task: TaskRow): ReminderRow {
  if (!task.remind_at) {
    throw new Error("Uma task sem remind_at não pode ser adaptada para ReminderRow.");
  }
  return {
    id: task.id,
    user_id: task.user_id,
    title: task.title,
    notes: task.description,
    remind_at: task.remind_at,
    active: task.reminder_enabled ?? true,
    notified_at: task.notified_at ?? null,
    created_at: task.created_at,
  };
}
