import { describe, expect, it, vi } from "vitest";
import { ChatService } from "./chat.service";
import type { ChatRepository } from "../repositories/chat.repository";
import type { LLMProvider } from "../providers/llm.provider";
import type { TaskTool } from "../tools/task.tool";
import { ReminderTool } from "../tools/reminder.tool";
import type { VaultSearchTool } from "../tools/vault-search.tool";
import type { ChatMessageDTO, JsonValue, TaskRow } from "../mael-types";
import { TaskService } from "./task.service";
import type { NewTaskInput, TasksRepository } from "../repositories/tasks.repository";

function makeMessage(
  role: "user" | "assistant",
  content: string,
  intent?: string,
  toolOutput: JsonValue | null = null,
): ChatMessageDTO {
  return {
    id: crypto.randomUUID(),
    session_id: "session-1",
    role,
    content,
    intent: intent ?? null,
    tool_output: toolOutput,
    created_at: new Date().toISOString(),
  };
}

function fakeRepo(): ChatRepository {
  return {
    findOwnedSessionId: async () => "session-1",
    createSession: async () => "session-1",
    touchSession: async () => {},
    recentHistory: async () => [],
    insertMessage: async (input: {
      role: "user" | "assistant";
      content: string;
      intent?: string;
      toolOutput?: JsonValue | null;
    }) => makeMessage(input.role, input.content, input.intent, input.toolOutput ?? null),
  } as unknown as ChatRepository;
}

describe("ChatService", () => {
  it("falls back to chat intent when the LLM is unavailable", async () => {
    const llm: LLMProvider = { complete: async () => null };
    const service = new ChatService(
      fakeRepo(),
      llm,
      {} as TaskTool,
      {} as ReminderTool,
      {} as VaultSearchTool,
    );
    const result = await service.orchestrate({
      userId: "user-1",
      userName: "Ana",
      message: "oi",
      sessionId: null,
    });
    expect(result.assistant_message.intent).toBe("chat");
    expect(result.assistant_message.content).toContain("Não consegui processar");
  });

  it("routes create_task intent to TaskTool and preserves the model's reply on success", async () => {
    const llm: LLMProvider = {
      complete: async () =>
        JSON.stringify({
          intent: "create_task",
          args: { title: "Comprar pão" },
          assistant_reply: "Anotei: comprar pão.",
        }),
    };
    const taskTool = {
      createFromArgs: vi.fn(async () => ({
        ok: true,
        reply: "",
        toolOutput: { kind: "task_created", title: "Comprar pão" },
      })),
    } as unknown as TaskTool;

    const service = new ChatService(
      fakeRepo(),
      llm,
      taskTool,
      {} as ReminderTool,
      {} as VaultSearchTool,
    );
    const result = await service.orchestrate({
      userId: "user-1",
      userName: "Ana",
      message: "anota comprar pão",
      sessionId: null,
    });

    expect(taskTool.createFromArgs).toHaveBeenCalledWith("user-1", { title: "Comprar pão" });
    expect(result.assistant_message.intent).toBe("create_task");
    expect(result.assistant_message.content).toBe("Anotei: comprar pão.");
  });

  it("mantém create_reminder e o encaminha ao domínio Task", async () => {
    const llm: LLMProvider = {
      complete: async () =>
        JSON.stringify({
          intent: "create_reminder",
          args: {
            title: "Consulta",
            notes: "Dentista",
            remind_at: "2026-08-10T18:00:00.000Z",
          },
          assistant_reply: "Lembrete criado para a consulta.",
        }),
    };
    const create = vi.fn(async (input: NewTaskInput): Promise<TaskRow> => ({
      id: "task-reminder-1",
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
      completed: false,
      created_at: "2026-08-08T10:00:00.000Z",
    }));
    const taskRepo = {
      listByUser: vi.fn(async () => []),
      create,
      setCompleted: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
      listRemindersByUser: vi.fn(async () => []),
      setReminderEnabled: vi.fn(async () => {}),
      clearReminder: vi.fn(async () => {}),
      listDueUnnotified: vi.fn(async () => []),
      markNotified: vi.fn(async () => {}),
    } as unknown as TasksRepository;

    const service = new ChatService(
      fakeRepo(),
      llm,
      {} as TaskTool,
      new ReminderTool(new TaskService(taskRepo)),
      {} as VaultSearchTool,
    );
    const result = await service.orchestrate({
      userId: "user-1",
      userName: "Ana",
      message: "me lembra da consulta",
      sessionId: null,
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Consulta",
        description: "Dentista",
        remind_at: "2026-08-10T18:00:00.000Z",
        reminder_enabled: true,
      }),
    );
    expect(result.assistant_message.intent).toBe("create_reminder");
    expect(result.assistant_message.tool_output).toMatchObject({
      kind: "reminder_created",
      title: "Consulta",
    });
  });

  it("downgrades to chat intent when a tool reports failure", async () => {
    const llm: LLMProvider = {
      complete: async () =>
        JSON.stringify({
          intent: "create_reminder",
          args: {},
          assistant_reply: "Vou criar o lembrete.",
        }),
    };
    const reminderTool = {
      createFromArgs: vi.fn(async () => ({
        ok: false,
        reply: "Para quando devo marcar?",
        toolOutput: null,
      })),
    } as unknown as ReminderTool;

    const service = new ChatService(
      fakeRepo(),
      llm,
      {} as TaskTool,
      reminderTool,
      {} as VaultSearchTool,
    );
    const result = await service.orchestrate({
      userId: "user-1",
      userName: "Ana",
      message: "me lembra de algo",
      sessionId: null,
    });

    expect(result.assistant_message.intent).toBe("chat");
    expect(result.assistant_message.content).toBe("Para quando devo marcar?");
  });
});
