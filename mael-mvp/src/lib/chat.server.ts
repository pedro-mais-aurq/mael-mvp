/** Ponto de composição do Chat P3. */
import type { SupabaseClient } from "@supabase/supabase-js";

import { ChatOrchestrator } from "./chat/orchestrator";
import { TaskResolver } from "./chat/task-resolver";
import { ToolRegistry } from "./chat/tool-registry";
import type { SendChatResult } from "./mael-types";
import { createDefaultLLMProvider } from "./providers/llm.provider";
import { ChatRepository } from "./repositories/chat.repository";
import { TasksRepository } from "./repositories/tasks.repository";
import { VaultRepository } from "./repositories/vault.repository";
import { ChatService } from "./services/chat.service";
import { TaskService } from "./services/task.service";
import { VaultService } from "./services/vault.service";
import { TaskTool } from "./tools/task.tool";
import { VaultSearchTool } from "./tools/vault-search.tool";
import { GitHubTool } from "./tools/github.tool";

function buildChatService(supabase: SupabaseClient): ChatService {
  const taskService = new TaskService(new TasksRepository(supabase));
  const taskTool = new TaskTool(taskService);
  const taskResolver = new TaskResolver(taskService);
  const vaultSearchTool = new VaultSearchTool(new VaultService(new VaultRepository(supabase)));
  const githubTool = new GitHubTool({
    async listRepositories(userId, input) {
      const { buildGitHubServices } = await import("./github/composition.server");
      return buildGitHubServices(supabase).githubService.listRepositories(userId, input);
    },
    async getRepository(userId, owner, repo) {
      const { buildGitHubServices } = await import("./github/composition.server");
      return buildGitHubServices(supabase).githubService.getRepository(userId, owner, repo);
    },
    async listPullRequests(userId, input) {
      const { buildGitHubServices } = await import("./github/composition.server");
      return buildGitHubServices(supabase).githubService.listPullRequests(userId, input);
    },
    async listIssues(userId, input) {
      const { buildGitHubServices } = await import("./github/composition.server");
      return buildGitHubServices(supabase).githubService.listIssues(userId, input);
    },
  });
  const registry = new ToolRegistry(taskTool, vaultSearchTool, taskResolver, githubTool);
  const orchestrator = new ChatOrchestrator(createDefaultLLMProvider(), registry);
  return new ChatService(new ChatRepository(supabase), orchestrator);
}

export async function orchestrateChat(opts: {
  supabase: SupabaseClient;
  userId: string;
  userName: string;
  message: string;
  sessionId: string | null;
  timezone: string;
}): Promise<SendChatResult> {
  return buildChatService(opts.supabase).orchestrate({
    userId: opts.userId,
    userName: opts.userName,
    message: opts.message,
    sessionId: opts.sessionId,
    timezone: opts.timezone,
  });
}
