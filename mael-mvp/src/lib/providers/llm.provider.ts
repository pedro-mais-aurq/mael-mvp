/**
 * LLMProvider (Etapa 7) — nenhuma outra parte do sistema fala HTTP com o
 * provedor de IA diretamente; tudo passa por esta interface. A implementação
 * atual usa o OpenRouter (compatível com a API de chat completions da
 * OpenAI); trocar de provedor no futuro significa escrever uma nova classe
 * que implemente `LLMProvider`, sem tocar em ChatService ou em qualquer
 * Tool.
 */

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMCompletionRequest {
  messages: LLMMessage[];
  temperature?: number;
  jsonMode?: boolean;
}

export interface LLMProvider {
  complete(request: LLMCompletionRequest): Promise<string | null>;
}

// BUG CORRIGIDO: faltava o segmento "/api" — a URL antiga
// ("https://openrouter.ai/v1/chat/completions") retorna 404 em toda
// chamada. O endpoint real de chat completions do OpenRouter é:
const GATEWAY_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "openai/gpt-oss-20b:free";

export class OpenRouterProvider implements LLMProvider {
  constructor(
    private readonly apiKey: string | undefined,
    private readonly model: string = DEFAULT_MODEL,
  ) {}

  async complete(request: LLMCompletionRequest): Promise<string | null> {
    if (!this.apiKey) return null;

    const res = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        // Recomendados (não obrigatórios) pelo OpenRouter para
        // identificar a origem das chamadas nos limites de uso/rankings.
        "HTTP-Referer": "https://mael.app",
        "X-Title": "Mael",
      },
      body: JSON.stringify({
        model: this.model,
        temperature: request.temperature ?? 0.5,
        ...(request.jsonMode ? { response_format: { type: "json_object" } } : {}),
        messages: request.messages,
      }),
    });

    if (!res.ok) {
      throw new Error(`Provedor de IA respondeu ${res.status}: ${await res.text()}`);
    }

    const payload = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      error?: { message?: string };
    };

    if (payload.error) {
      throw new Error(`Provedor de IA retornou erro: ${payload.error.message ?? "desconhecido"}`);
    }

    return payload.choices?.[0]?.message?.content ?? "";
  }
}

/**
 * Fábrica: lê a chave do ambiente uma única vez, no ponto de composição.
 *
 * Preferimos `OPENROUTER_API_KEY` (nome oficial usado na documentação do
 * OpenRouter e no `.env.example`), mas mantemos `OPEN_ROUTER_API` como
 * fallback para não quebrar ambientes que já configuraram a variável antiga.
 */
export function createDefaultLLMProvider(): LLMProvider {
  const apiKey = process.env["OPENROUTER_API_KEY"] ?? process.env["OPEN_ROUTER_API"];
  if (!apiKey) {
    // Não lançamos aqui: complete() já trata apiKey ausente devolvendo
    // null, e ChatService cai de volta para o intent "chat" com uma
    // mensagem de erro genérica em vez de derrubar a requisição inteira.

    console.warn(
      '[LLMProvider] Nenhuma variável de ambiente "OPENROUTER_API_KEY" (ou "OPEN_ROUTER_API") definida — o chat vai responder sempre com a mensagem de fallback.',
    );
  }
  return new OpenRouterProvider(apiKey);
}

/** @deprecated use {@link OpenRouterProvider} — mantido só por compatibilidade de import. */
export const LovableGatewayProvider = OpenRouterProvider;
