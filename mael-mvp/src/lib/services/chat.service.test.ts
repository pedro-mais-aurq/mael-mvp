import { describe, expect, it, vi } from "vitest";

import type { ChatOrchestrator } from "../chat/orchestrator";
import type { ChatMessageDTO, JsonValue } from "../mael-types";
import type { ChatRepository } from "../repositories/chat.repository";
import { ChatService } from "./chat.service";

function message(
  role: "user" | "assistant",
  content: string,
  intent: string | null = null,
  toolOutput: JsonValue | null = null,
): ChatMessageDTO {
  return {
    id: `${role}-1`,
    session_id: "session-1",
    role,
    content,
    intent,
    tool_output: toolOutput,
    created_at: "2026-08-09T12:00:00.000Z",
  };
}

function setup(ownedSession: string | null = "session-1") {
  const repo = {
    findOwnedSessionId: vi.fn(async () => ownedSession),
    createSession: vi.fn(async () => "session-new"),
    touchSession: vi.fn(async () => undefined),
    recentHistory: vi.fn(async () => [
      { role: "user" as const, content: "contexto" },
      { role: "assistant" as const, content: "entendido" },
    ]),
    insertMessage: vi.fn(
      async (input: {
        role: "user" | "assistant";
        content: string;
        intent?: string;
        toolOutput?: JsonValue | null;
      }) => message(input.role, input.content, input.intent ?? null, input.toolOutput ?? null),
    ),
  } as unknown as ChatRepository;
  const orchestrator = {
    run: vi.fn(async () => ({
      reply: "Tarefa criada.",
      primaryTool: "create_task",
      toolOutput: { kind: "task_created", title: "Comprar pão" } as JsonValue,
      executedTools: ["create_task"],
      mutatesTasks: true,
    })),
  } as unknown as ChatOrchestrator;
  return { repo, orchestrator, service: new ChatService(repo, orchestrator) };
}

describe("ChatService — persistência e sessão", () => {
  it("delega o loop ao orquestrador e persiste somente mensagens finais", async () => {
    const { repo, orchestrator, service } = setup();
    const result = await service.orchestrate({
      userId: "user-1",
      userName: "Ana",
      message: "crie comprar pão",
      sessionId: "session-1",
      timezone: "America/Sao_Paulo",
    });

    expect(repo.recentHistory).toHaveBeenCalledWith("session-1", 12);
    expect(orchestrator.run).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        userName: "Ana",
        userMessage: "crie comprar pão",
        timezone: "America/Sao_Paulo",
        history: expect.any(Array),
        now: expect.any(Date),
      }),
    );
    expect(repo.insertMessage).toHaveBeenCalledTimes(2);
    expect(repo.insertMessage).toHaveBeenLastCalledWith({
      sessionId: "session-1",
      userId: "user-1",
      role: "assistant",
      content: "Tarefa criada.",
      intent: "create_task",
      toolOutput: { kind: "task_created", title: "Comprar pão" },
    });
    expect(result.executed_tools).toEqual(["create_task"]);
    expect(result.mutates_tasks).toBe(true);
  });

  it("cria uma sessão nova quando a solicitada não pertence ao usuário", async () => {
    const { repo, service } = setup(null);
    const result = await service.orchestrate({
      userId: "user-1",
      userName: "Ana",
      message: "oi",
      sessionId: "session-de-outro-usuario",
      timezone: "UTC",
    });

    expect(repo.createSession).toHaveBeenCalledWith("user-1", "oi");
    expect(result.session_id).toBe("session-new");
  });
});
