import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { TasksRepository } from "./repositories/tasks.repository";
import { TaskService } from "./services/task.service";
import { handleServiceError } from "./core/exceptions";
import type { TaskRow } from "./mael-types";

function taskService(supabase: SupabaseClient): TaskService {
  return new TaskService(new TasksRepository(supabase));
}

export const listTasks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<TaskRow[]> => {
    const supabase = context.supabase as unknown as SupabaseClient;
    try {
      return await taskService(supabase).listForUser(context.userId);
    } catch (err) {
      throw handleServiceError(err, { route: "tasks.listTasks", userId: context.userId });
    }
  });

export const createTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        title: z.string().trim().min(1).max(200),
        description: z.string().trim().max(2000).nullish(),
        category: z.string().trim().max(60).nullish(),
        priority: z.enum(["baixa", "media", "alta"]).default("media"),
        due_date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullish(),
        due_time: z
          .string()
          .regex(/^\d{2}:\d{2}$/)
          .nullish(),
        due_at: z.string().datetime({ offset: true }).nullish(),
        remind_at: z.string().datetime({ offset: true }).nullish(),
        reminder_enabled: z.boolean().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as unknown as SupabaseClient;
    try {
      return await taskService(supabase).create(context.userId, data);
    } catch (err) {
      throw handleServiceError(err, { route: "tasks.createTask", userId: context.userId });
    }
  });

export const toggleTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ id: z.string().uuid(), completed: z.boolean() }).parse(data))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as unknown as SupabaseClient;
    try {
      await taskService(supabase).setCompleted(context.userId, data.id, data.completed);
      return { ok: true };
    } catch (err) {
      throw handleServiceError(err, { route: "tasks.toggleTask", userId: context.userId });
    }
  });

export const setTaskReminderEnabled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z.object({ taskId: z.string().uuid(), enabled: z.boolean() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as unknown as SupabaseClient;
    try {
      await taskService(supabase).setReminderEnabled(context.userId, data.taskId, data.enabled);
      return { ok: true };
    } catch (err) {
      throw handleServiceError(err, {
        route: "tasks.setTaskReminderEnabled",
        userId: context.userId,
      });
    }
  });

export const clearTaskReminder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ taskId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as unknown as SupabaseClient;
    try {
      await taskService(supabase).clearReminder(context.userId, data.taskId);
      return { ok: true };
    } catch (err) {
      throw handleServiceError(err, {
        route: "tasks.clearTaskReminder",
        userId: context.userId,
      });
    }
  });

export const deleteTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as unknown as SupabaseClient;
    try {
      await taskService(supabase).delete(context.userId, data.id);
      return { ok: true };
    } catch (err) {
      throw handleServiceError(err, { route: "tasks.deleteTask", userId: context.userId });
    }
  });
