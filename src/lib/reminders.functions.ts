import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { ReminderRow } from "./mael-types";

export const listReminders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ReminderRow[]> => {
    const supabase = context.supabase as unknown as SupabaseClient;
    const { data, error } = await supabase
      .from("reminders")
      .select("*")
      .order("remind_at", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as ReminderRow[];
  });

export const createReminder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        title: z.string().trim().min(1).max(200),
        notes: z.string().trim().max(2000).nullish(),
        remind_at: z.string().datetime({ offset: true }),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as unknown as SupabaseClient;
    const remindAt = new Date(data.remind_at);
    if (Number.isNaN(remindAt.getTime())) throw new Error("Data do lembrete inválida");
    const { data: row, error } = await supabase
      .from("reminders")
      .insert({
        user_id: context.userId,
        title: data.title,
        notes: data.notes ?? null,
        remind_at: remindAt.toISOString(),
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row as ReminderRow;
  });

export const toggleReminder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z.object({ id: z.string().uuid(), active: z.boolean() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as unknown as SupabaseClient;
    const { error } = await supabase
      .from("reminders")
      .update({ active: data.active })
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteReminder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as unknown as SupabaseClient;
    const { error } = await supabase
      .from("reminders")
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
