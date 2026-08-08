/**
 * Ponto de composição do chat (Etapa 3-8).
 *
 * Este arquivo é mantido por compatibilidade: `chat.functions.ts` importa
 * `orchestrateChat` daqui, com a mesma assinatura de sempre. A lógica de
 * negócio em si foi movida para `services/chat.service.ts`, que por sua vez
 * usa `LLMProvider`, `ChatRepository` e as Tools (TaskTool, ReminderTool,
 * VaultSearchTool) — nenhuma dessas peças conhece Supabase/HTTP diretamente
 * fora dos Repositories/Providers.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { ChatRepository } from "./repositories/chat.repository";
import { TasksRepository } from "./repositories/tasks.repository";
import { RemindersRepository } from "./repositories/reminders.repository";
import { VaultRepository } from "./repositories/vault.repository";
import { TaskService } from "./services/task.service";
import { ReminderService } from "./services/reminder.service";
import { VaultService } from "./services/vault.service";
import { ChatService } from "./services/chat.service";
import { TaskTool } from "./tools/task.tool";
import { ReminderTool } from "./tools/reminder.tool";
import { VaultSearchTool } from "./tools/vault-search.tool";
import { createDefaultLLMProvider } from "./providers/llm.provider";
import type { SendChatResult } from "./mael-types";

function buildChatService(supabase: SupabaseClient): ChatService {
  const taskTool = new TaskTool(new TaskService(new TasksRepository(supabase)));
  const reminderTool = new ReminderTool(new ReminderService(new RemindersRepository(supabase)));
  const vaultSearchTool = new VaultSearchTool(new VaultService(new VaultRepository(supabase)));

  return new ChatService(
    new ChatRepository(supabase),
    createDefaultLLMProvider(),
    taskTool,
    reminderTool,
    vaultSearchTool,
  );
}

export async function orchestrateChat(opts: {
  supabase: SupabaseClient;
  userId: string;
  userName: string;
  message: string;
  sessionId: string | null;
}): Promise<SendChatResult> {
  const chatService = buildChatService(opts.supabase);
  return chatService.orchestrate({
    userId: opts.userId,
    userName: opts.userName,
    message: opts.message,
    sessionId: opts.sessionId,
  });
}
