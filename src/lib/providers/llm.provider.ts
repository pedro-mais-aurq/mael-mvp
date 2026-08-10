/** Contrato interno do Mael para Chat Completions com Tool Calling. */
export interface LLMToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface LLMToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export type LLMMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: LLMToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface LLMCompletionRequest {
  messages: LLMMessage[];
  tools?: LLMToolDefinition[];
  temperature?: number;
}

export interface LLMCompletionResult {
  content: string | null;
  toolCalls: LLMToolCall[];
  finishReason: LLMFinishReason;
}

export type LLMFinishReason =
  "stop" | "tool_calls" | "length" | "content_filter" | "error" | "unknown";

export interface LLMProvider {
  complete(request: LLMCompletionRequest): Promise<LLMCompletionResult | null>;
}

const GATEWAY_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "openai/gpt-oss-20b:free";

function isToolCall(value: unknown): value is LLMToolCall {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  const fn = candidate["function"];
  return (
    typeof candidate["id"] === "string" &&
    candidate["type"] === "function" &&
    Boolean(fn) &&
    typeof fn === "object" &&
    typeof (fn as Record<string, unknown>)["name"] === "string" &&
    typeof (fn as Record<string, unknown>)["arguments"] === "string"
  );
}

function parseFinishReason(value: unknown): LLMFinishReason {
  if (
    value === "stop" ||
    value === "tool_calls" ||
    value === "length" ||
    value === "content_filter" ||
    value === "error"
  ) {
    return value;
  }
  return "unknown";
}

export class OpenRouterProvider implements LLMProvider {
  constructor(
    private readonly apiKey: string | undefined,
    private readonly model: string = DEFAULT_MODEL,
  ) {}

  async complete(request: LLMCompletionRequest): Promise<LLMCompletionResult | null> {
    if (!this.apiKey) return null;

    const res = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://mael.app",
        "X-Title": "Mael",
      },
      body: JSON.stringify({
        model: this.model,
        temperature: request.temperature ?? 0.4,
        stream: false,
        messages: request.messages,
        ...(request.tools?.length
          ? {
              tools: request.tools,
              tool_choice: "auto",
            }
          : {}),
      }),
    });

    if (!res.ok) {
      throw new Error(`Provedor de IA respondeu com status ${res.status}.`);
    }

    const payload = (await res.json()) as {
      choices?: Array<{
        finish_reason?: unknown;
        message?: {
          content?: unknown;
          tool_calls?: unknown;
        };
      }>;
      error?: { message?: string };
    };

    if (payload.error) {
      throw new Error("Provedor de IA retornou um erro.");
    }

    const choice = payload.choices?.[0];
    const message = choice?.message;
    const toolCalls = Array.isArray(message?.tool_calls)
      ? message.tool_calls.filter(isToolCall)
      : [];

    return {
      content: typeof message?.content === "string" ? message.content : null,
      toolCalls,
      finishReason: parseFinishReason(choice?.finish_reason),
    };
  }
}

export function createDefaultLLMProvider(): LLMProvider {
  const apiKey = process.env["OPENROUTER_API_KEY"] ?? process.env["OPEN_ROUTER_API"];
  if (!apiKey) {
    console.warn(
      '[LLMProvider] Nenhuma variável de ambiente "OPENROUTER_API_KEY" (ou "OPEN_ROUTER_API") definida.',
    );
  }
  return new OpenRouterProvider(apiKey);
}

/** @deprecated Mantido apenas por compatibilidade de import. */
export const LovableGatewayProvider = OpenRouterProvider;
