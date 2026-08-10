import type { SupabaseClient } from "@supabase/supabase-js";

import type { ReminderRow } from "../mael-types";

export interface NewReminderInput {
  userId: string;
  title: string;
  notes: string | null;
  remind_at: string;
}

export class RemindersRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async listByUser(): Promise<ReminderRow[]> {
    const { data, error } = await this.supabase
      .from("reminders")
      .select("*")
      .order("remind_at", { ascending: true });
    if (error) throw error;
    return (data ?? []) as ReminderRow[];
  }

  async create(input: NewReminderInput): Promise<ReminderRow> {
    const { data, error } = await this.supabase
      .from("reminders")
      .insert({
        user_id: input.userId,
        title: input.title,
        notes: input.notes,
        remind_at: input.remind_at,
      })
      .select("*")
      .single();
    if (error) throw error;
    return data as ReminderRow;
  }

  async setActive(userId: string, id: string, active: boolean): Promise<void> {
    const { error } = await this.supabase
      .from("reminders")
      .update({ active })
      .eq("id", id)
      .eq("user_id", userId);
    if (error) throw error;
  }

  async delete(userId: string, id: string): Promise<void> {
    const { error } = await this.supabase
      .from("reminders")
      .delete()
      .eq("id", id)
      .eq("user_id", userId);
    if (error) throw error;
  }

  /** Usado pelo scheduler (Etapa 9): lembretes ativos, vencidos, ainda não notificados. */
  async listDueUnnotified(nowIso: string, limit = 100): Promise<ReminderRow[]> {
    const { data, error } = await this.supabase
      .from("reminders")
      .select("*")
      .eq("active", true)
      .is("notified_at", null)
      .lte("remind_at", nowIso)
      .limit(limit);
    if (error) throw error;
    return (data ?? []) as ReminderRow[];
  }

  async markNotified(id: string, nowIso: string): Promise<void> {
    const { error } = await this.supabase
      .from("reminders")
      .update({ notified_at: nowIso })
      .eq("id", id);
    if (error) throw error;
  }
}
