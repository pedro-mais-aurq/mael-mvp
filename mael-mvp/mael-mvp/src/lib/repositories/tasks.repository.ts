/**
 * Repository de tarefas (Etapa 6) — único lugar autorizado a falar SQL/PostgREST
 * com a tabela `tasks`. Services nunca chamam `supabase.from(...)` diretamente.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Priority, TaskRow } from "../mael-types";

export interface NewTaskInput {
  userId: string;
  title: string;
  description: string | null;
  category: string | null;
  priority: Priority;
  due_date: string | null;
  due_time: string | null;
  due_at: string | null;
  remind_at: string | null;
  notified_at: string | null;
  reminder_enabled: boolean;
  legacy_reminder_id: string | null;
}

export class TasksRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async listByUser(userId: string): Promise<TaskRow[]> {
    const { data, error } = await this.supabase
      .from("tasks")
      .select("*")
      .eq("user_id", userId)
      .order("completed", { ascending: true })
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []) as TaskRow[];
  }

  async create(input: NewTaskInput): Promise<TaskRow> {
    const { data, error } = await this.supabase
      .from("tasks")
      .insert({
        user_id: input.userId,
        title: input.title,
        description: input.description,
        category: input.category,
        priority: input.priority,
        due_date: input.due_date,
        due_time: input.due_time,
        due_at: input.due_at,
        remind_at: input.remind_at,
        notified_at: input.notified_at,
        reminder_enabled: input.reminder_enabled,
        legacy_reminder_id: input.legacy_reminder_id,
      })
      .select("*")
      .single();
    if (error) throw error;
    return data as TaskRow;
  }

  async setCompleted(userId: string, id: string, completed: boolean): Promise<void> {
    const { error } = await this.supabase
      .from("tasks")
      .update({ completed, completed_at: completed ? new Date().toISOString() : null })
      .eq("id", id)
      .eq("user_id", userId);
    if (error) throw error;
  }

  async delete(userId: string, id: string): Promise<void> {
    const { error } = await this.supabase.from("tasks").delete().eq("id", id).eq("user_id", userId);
    if (error) throw error;
  }

  async listRemindersByUser(userId: string): Promise<TaskRow[]> {
    const { data, error } = await this.supabase
      .from("tasks")
      .select("*")
      .eq("user_id", userId)
      .not("remind_at", "is", null)
      .order("remind_at", { ascending: true });
    if (error) throw error;
    return (data ?? []) as TaskRow[];
  }

  async setReminderEnabled(userId: string, id: string, enabled: boolean): Promise<void> {
    const { error } = await this.supabase
      .from("tasks")
      .update({ reminder_enabled: enabled })
      .eq("id", id)
      .eq("user_id", userId);
    if (error) throw error;
  }

  async clearReminder(userId: string, id: string): Promise<void> {
    const { error } = await this.supabase
      .from("tasks")
      .update({ remind_at: null, notified_at: null, reminder_enabled: true })
      .eq("id", id)
      .eq("user_id", userId);
    if (error) throw error;
  }

  /** Busca global destinada a um scheduler com client de sistema no servidor. */
  async listDueUnnotified(nowIso: string, limit = 100): Promise<TaskRow[]> {
    const { data, error } = await this.supabase
      .from("tasks")
      .select("*")
      .eq("reminder_enabled", true)
      .eq("completed", false)
      .is("notified_at", null)
      .lte("remind_at", nowIso)
      .order("remind_at", { ascending: true })
      .limit(limit);
    if (error) throw error;
    return (data ?? []) as TaskRow[];
  }

  async markNotified(id: string, nowIso: string): Promise<void> {
    const { error } = await this.supabase
      .from("tasks")
      .update({ notified_at: nowIso })
      .eq("id", id);
    if (error) throw error;
  }
}
