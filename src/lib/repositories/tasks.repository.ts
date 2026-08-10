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

export interface TaskUpdatePatch {
  title?: string;
  description?: string;
  category?: string;
  priority?: Priority;
  due_at?: string | null;
  remind_at?: string | null;
  notified_at?: string | null;
  reminder_enabled?: boolean;
}

export interface TaskListOptions {
  status: "open" | "completed" | "all";
  hasReminder: boolean | null;
  query: string | null;
  dueFrom: string | null;
  dueTo: string | null;
  limit: number;
}

export interface TaskResolutionOptions {
  status: "open" | "completed" | "all";
  limit: number;
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
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

  async listForTool(userId: string, options: TaskListOptions): Promise<TaskRow[]> {
    let query = this.supabase
      .from("tasks")
      .select("*")
      .eq("user_id", userId)
      .order("completed", { ascending: true })
      .order("created_at", { ascending: false });

    if (options.status !== "all") {
      query = query.eq("completed", options.status === "completed");
    }
    if (options.hasReminder === true) query = query.not("remind_at", "is", null);
    if (options.hasReminder === false) query = query.is("remind_at", null);
    if (options.query) query = query.ilike("title", `%${escapeLikePattern(options.query)}%`);
    if (options.dueFrom) query = query.gte("due_at", options.dueFrom);
    if (options.dueTo) query = query.lte("due_at", options.dueTo);

    const { data, error } = await query.limit(options.limit);
    if (error) throw error;
    return (data ?? []) as TaskRow[];
  }

  /**
   * Conjunto canônico para resolução de mutações. Não recebe query nem limit do
   * modelo: o backend lê um lote amplo do usuário e o TaskResolver aplica o alvo
   * extraído da mensagem original. Se o lote estourar, a resolução é truncada e
   * nenhuma mutação é autorizada.
   */
  async listForResolution(userId: string, options: TaskResolutionOptions): Promise<TaskRow[]> {
    let query = this.supabase
      .from("tasks")
      .select("*")
      .eq("user_id", userId)
      .order("completed", { ascending: true })
      .order("created_at", { ascending: false });

    if (options.status !== "all") {
      query = query.eq("completed", options.status === "completed");
    }

    const { data, error } = await query.limit(options.limit);
    if (error) throw error;
    return (data ?? []) as TaskRow[];
  }

  async listLegacyDueDate(
    userId: string,
    dueDate: string,
    options: Omit<TaskListOptions, "dueFrom" | "dueTo">,
  ): Promise<TaskRow[]> {
    let query = this.supabase
      .from("tasks")
      .select("*")
      .eq("user_id", userId)
      .is("due_at", null)
      .eq("due_date", dueDate)
      .order("completed", { ascending: true })
      .order("created_at", { ascending: false });

    if (options.status !== "all") {
      query = query.eq("completed", options.status === "completed");
    }
    if (options.hasReminder === true) query = query.not("remind_at", "is", null);
    if (options.hasReminder === false) query = query.is("remind_at", null);
    if (options.query) query = query.ilike("title", `%${escapeLikePattern(options.query)}%`);

    const { data, error } = await query.limit(options.limit);
    if (error) throw error;
    return (data ?? []) as TaskRow[];
  }

  async findById(userId: string, id: string): Promise<TaskRow | null> {
    const { data, error } = await this.supabase
      .from("tasks")
      .select("*")
      .eq("id", id)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    return (data as TaskRow | null) ?? null;
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

  async update(userId: string, id: string, patch: TaskUpdatePatch): Promise<TaskRow | null> {
    const { data, error } = await this.supabase
      .from("tasks")
      .update(patch)
      .eq("id", id)
      .eq("user_id", userId)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    return (data as TaskRow | null) ?? null;
  }

  async setCompleted(userId: string, id: string, completed: boolean): Promise<TaskRow | null> {
    const { data, error } = await this.supabase
      .from("tasks")
      .update({ completed, completed_at: completed ? new Date().toISOString() : null })
      .eq("id", id)
      .eq("user_id", userId)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    return (data as TaskRow | null) ?? null;
  }

  async delete(userId: string, id: string): Promise<TaskRow | null> {
    const { data, error } = await this.supabase
      .from("tasks")
      .delete()
      .eq("id", id)
      .eq("user_id", userId)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    return (data as TaskRow | null) ?? null;
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

  async setReminderEnabled(userId: string, id: string, enabled: boolean): Promise<TaskRow | null> {
    const { data, error } = await this.supabase
      .from("tasks")
      .update({ reminder_enabled: enabled })
      .eq("id", id)
      .eq("user_id", userId)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    return (data as TaskRow | null) ?? null;
  }

  async clearReminder(userId: string, id: string): Promise<TaskRow | null> {
    const { data, error } = await this.supabase
      .from("tasks")
      .update({ remind_at: null, notified_at: null, reminder_enabled: true })
      .eq("id", id)
      .eq("user_id", userId)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    return (data as TaskRow | null) ?? null;
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
