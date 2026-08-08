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
}

export class TasksRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async listByUser(): Promise<TaskRow[]> {
    const { data, error } = await this.supabase
      .from("tasks")
      .select("*")
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
      })
      .select("*")
      .single();
    if (error) throw error;
    return data as TaskRow;
  }

  async setCompleted(userId: string, id: string, completed: boolean): Promise<void> {
    const { error } = await this.supabase
      .from("tasks")
      .update({ completed })
      .eq("id", id)
      .eq("user_id", userId);
    if (error) throw error;
  }

  async delete(userId: string, id: string): Promise<void> {
    const { error } = await this.supabase.from("tasks").delete().eq("id", id).eq("user_id", userId);
    if (error) throw error;
  }
}
