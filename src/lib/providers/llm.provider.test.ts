import { afterEach, describe, expect, it, vi } from "vitest";

import type { LLMToolDefinition } from "./llm.provider";
import { OpenRouterProvider } from "./llm.provider";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

function successfulFetch(
  message: Record<string, unknown>,
  finishReason = Array.isArray(message["tool_calls"]) ? "tool_calls" : "stop",
) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ choices: [{ message, finish_reason: finishReason }] }),
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

describe("OpenRouterProvider — Chat Completions Tool Calling", () => {
  it("envia tools no endpoint/model corretos, sem streaming", async () => {
    const fetchMock = successfulFetch({ content: "oi" });
    const tools: LLMToolDefinition[] = [
      {
        type: "function",
        function: {
          name: "list_tasks",
          description: "Lista tarefas",
          parameters: { type: "object", properties: {}, additionalProperties: false },
        },
      },
    ];

    await new OpenRouterProvider("fake-key").complete({
      messages: [{ role: "user", content: "minhas tarefas" }],
      tools,
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(init.headers).toMatchObject({ Authorization: "Bearer fake-key" });
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: "openai/gpt-oss-20b:free",
      stream: false,
      tool_choice: "auto",
      tools,
    });
  });

  it("interpreta resposta textual sem inventar Tool Call", async () => {
    successfulFetch({ content: "Tudo certo." });
    await expect(
      new OpenRouterProvider("fake-key").complete({
        messages: [{ role: "user", content: "oi" }],
      }),
    ).resolves.toEqual({ content: "Tudo certo.", toolCalls: [], finishReason: "stop" });
  });

  it("preserva Tool Calls estruturadas e mensagens role=tool", async () => {
    const toolCall = {
      id: "call-1",
      type: "function" as const,
      function: { name: "list_tasks", arguments: '{"status":"open"}' },
    };
    const fetchMock = successfulFetch({ content: null, tool_calls: [toolCall] });
    const result = await new OpenRouterProvider("fake-key").complete({
      messages: [
        { role: "assistant", content: null, tool_calls: [toolCall] },
        { role: "tool", tool_call_id: "call-1", content: '{"ok":true}' },
      ],
    });

    expect(result).toEqual({ content: null, toolCalls: [toolCall], finishReason: "tool_calls" });
    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
    expect(body.messages[1]).toEqual({
      role: "tool",
      tool_call_id: "call-1",
      content: '{"ok":true}',
    });
  });

  it("ignora Tool Calls malformadas", async () => {
    successfulFetch({
      content: null,
      tool_calls: [{ id: "call-1", type: "function", function: { name: 42 } }],
    });
    await expect(new OpenRouterProvider("fake-key").complete({ messages: [] })).resolves.toEqual({
      content: null,
      toolCalls: [],
      finishReason: "tool_calls",
    });
  });

  it("preserva finish_reason de truncamento e normaliza valor desconhecido", async () => {
    successfulFetch({ content: "Resposta parcial" }, "length");
    await expect(new OpenRouterProvider("fake-key").complete({ messages: [] })).resolves.toEqual({
      content: "Resposta parcial",
      toolCalls: [],
      finishReason: "length",
    });

    successfulFetch({ content: "Resposta" }, "future_reason");
    await expect(new OpenRouterProvider("fake-key").complete({ messages: [] })).resolves.toEqual({
      content: "Resposta",
      toolCalls: [],
      finishReason: "unknown",
    });
  });

  it("retorna null quando não há API key", async () => {
    await expect(new OpenRouterProvider(undefined).complete({ messages: [] })).resolves.toBeNull();
  });

  it("propaga erros do payload e do HTTP", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ error: { message: "invalid api key" } }),
    }) as unknown as typeof fetch;
    await expect(new OpenRouterProvider("fake-key").complete({ messages: [] })).rejects.toThrow(
      "retornou um erro",
    );

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: async () => "sensitive-provider-body",
    }) as unknown as typeof fetch;
    const request = new OpenRouterProvider("fake-key").complete({ messages: [] });
    await expect(request).rejects.toThrow("429");
    await expect(request).rejects.not.toThrow("sensitive-provider-body");
  });
});
