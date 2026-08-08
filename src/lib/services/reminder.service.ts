import { RemindersRepository } from "../repositories/reminders.repository";
import { ValidationError } from "../core/exceptions";
import type { ReminderRow } from "../mael-types";

export interface CreateReminderInput {
  title: string;
  notes?: string | null | undefined;
  remind_at: string;
}

export class ReminderService {
  constructor(private readonly repo: RemindersRepository) {}

  listForUser(): Promise<ReminderRow[]> {
    return this.repo.listByUser();
  }

  create(userId: string, input: CreateReminderInput): Promise<ReminderRow> {
    const remindAt = new Date(input.remind_at);
    if (Number.isNaN(remindAt.getTime())) {
      return Promise.reject(new ValidationError("Data do lembrete inválida."));
    }
    return this.repo.create({
      userId,
      title: input.title,
      notes: input.notes ?? "",
      remind_at: remindAt.toISOString(),
    });
  }

  setActive(userId: string, id: string, active: boolean): Promise<void> {
    return this.repo.setActive(userId, id, active);
  }

  delete(userId: string, id: string): Promise<void> {
    return this.repo.delete(userId, id);
  }

  /** Etapa 9: usado pelo Scheduler para descobrir o que está vencido. */
  listDue(now: Date): Promise<ReminderRow[]> {
    return this.repo.listDueUnnotified(now.toISOString());
  }

  markNotified(id: string, now: Date): Promise<void> {
    return this.repo.markNotified(id, now.toISOString());
  }
}
