import type { ChatOrchestrator } from "../chat/orchestrator";
import type { ChatMessageDTO, SendChatResult } from "../mael-types";
import { ChatRepository } from "../repositories/chat.repository";

const HISTORY_LIMIT = 12;

export interface OrchestrateChatInput {
  userId: string;
  userName: string;
  message: string;
  sessionId: string | null;
  timezone: string;
}

/**
 * Persiste a conversa e delega toda decisão de LLM/Tools ao ChatOrchestrator.
 * Mensagens internas de Tool existem apenas em memória nesta requisição.
 */
export class ChatService {
  constructor(
    private readonly repo: ChatRepository,
    private readonly orchestrator: ChatOrchestrator,
  ) {}

  async orchestrate(input: OrchestrateChatInput): Promise<SendChatResult> {
    const sessionId = await this.resolveSession(input.userId, input.sessionId, input.message);
    const userRow = await this.repo.insertMessage({
      sessionId,
      userId: input.userId,
      role: "user",
      content: input.message,
    });
    const history = await this.repo.recentHistory(sessionId, HISTORY_LIMIT);
    const result = await this.orchestrator.run({
      userId: input.userId,
      userName: input.userName,
      userMessage: input.message,
      timezone: input.timezone,
      now: new Date(),
      history,
    });
    const assistantRow = await this.repo.insertMessage({
      sessionId,
      userId: input.userId,
      role: "assistant",
      content: result.reply,
      intent: result.primaryTool ?? "chat",
      toolOutput: result.toolOutput,
    });

    await this.repo.touchSession(sessionId);

    return {
      session_id: sessionId,
      user_message: userRow as ChatMessageDTO,
      assistant_message: assistantRow as ChatMessageDTO,
      executed_tools: result.executedTools,
      mutates_tasks: result.mutatesTasks,
    };
  }

  private async resolveSession(
    userId: string,
    requested: string | null,
    firstMessage: string,
  ): Promise<string> {
    if (requested) {
      const owned = await this.repo.findOwnedSessionId(userId, requested);
      if (owned) return owned;
    }
    return this.repo.createSession(userId, firstMessage);
  }
}
