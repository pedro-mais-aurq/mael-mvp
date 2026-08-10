import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { TasksRepository } from "./repositories/tasks.repository";
import { TaskService } from "./services/task.service";
import { ReminderService } from "./services/reminder.service";
import { handleServiceError } from "./core/exceptions";
import type { ReminderRow } from "./mael-types";

function reminderService(supabase: SupabaseClient): ReminderService {
  return new ReminderService(new TaskService(new TasksRepository(supabase)));
}

export const listReminders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ReminderRow[]> => {
    const supabase = context.supabase as unknown as SupabaseClient;
    try {
      return await reminderService(supabase).listForUser(context.userId);
    } catch (err) {
      throw handleServiceError(err, { route: "reminders.listReminders", userId: context.userId });
    }
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
    try {
      return await reminderService(supabase).create(context.userId, data);
    } catch (err) {
      throw handleServiceError(err, { route: "reminders.createReminder", userId: context.userId });
    }
  });

export const toggleReminder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ id: z.string().uuid(), active: z.boolean() }).parse(data))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as unknown as SupabaseClient;
    try {
      await reminderService(supabase).setActive(context.userId, data.id, data.active);
      return { ok: true };
    } catch (err) {
      throw handleServiceError(err, { route: "reminders.toggleReminder", userId: context.userId });
    }
  });

export const deleteReminder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as unknown as SupabaseClient;
    try {
      await reminderService(supabase).delete(context.userId, data.id);
      return { ok: true };
    } catch (err) {
      throw handleServiceError(err, { route: "reminders.deleteReminder", userId: context.userId });
    }
  });
