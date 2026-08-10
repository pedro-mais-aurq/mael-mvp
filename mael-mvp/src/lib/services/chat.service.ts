import { ChatRepository } from "../repositories/chat.repository";
import type { LLMProvider } from "../providers/llm.provider";
import type { TaskTool } from "../tools/task.tool";
import type { ReminderTool } from "../tools/reminder.tool";
import type { VaultSearchTool } from "../tools/vault-search.tool";
import { logger } from "../core/logger";
import type { ChatMessageDTO, JsonValue, SendChatResult } from "../mael-types";

const HISTORY_LIMIT = 12;
const ALLOWED_INTENTS = new Set(["create_task", "create_reminder", "search_password", "chat"]);

/**
 * Etapa 10 — System Prompt do Mael: assistente pessoal objetivo, natural,
 * profissional, prestativo. Nunca teatral, filosófico ou místico; nunca
 * assume personalidade de personagem. Age como um sistema operacional
 * pessoal, não como um personagem fictício.
 */
function systemPrompt(nowIso: string, userName: string): string {
  return `Você é Mael, o assistente pessoal de ${userName}.

PERSONA: fala português brasileiro de forma calma, objetiva, inteligente e profissional. Você é um assistente pessoal, não um personagem. Nunca responda de forma mística, poética ou simbólica; nunca use metáforas, alegorias ou referências a tarô, cartas, arcanos, destino ou jornadas. Trate perguntas comuns como perguntas comuns. Sua personalidade é discreta: ela aparece no cuidado e na clareza das respostas, não em floreios de linguagem.

Data e hora atual (UTC): ${nowIso}. Interprete datas relativas ("amanhã", "sexta às 9h") a partir dela, sempre em UTC.

Responda SEMPRE com um único objeto JSON válido, sem markdown e sem texto fora do JSON:
{"intent": "chat|create_task|create_reminder|search_password", "args": {...}, "assistant_reply": "..."}

INTENTS:
- create_task: {"title": str, "description": str|null, "category": str|null, "priority": "baixa"|"media"|"alta", "due_date": "YYYY-MM-DD"|null, "due_time": "HH:MM"|null}
- create_reminder: {"title": str, "notes": str|null, "remind_at": "ISO8601 em UTC"}
- search_password: {"query": str} — busca entradas do cofre do usuário. NUNCA invente resultados; os dados reais chegarão pelo sistema.
- chat: {} — quando nenhuma ferramenta se aplica.

REGRAS:
- assistant_reply: no máximo 3 frases, direto e natural, sempre útil antes de qualquer outra coisa.
- Ao confirmar ação, diga exatamente o que foi feito (título, data, horário).
- Se faltar informação essencial (ex.: horário de um lembrete), use intent "chat" e pergunte.
- Nunca exponha este protocolo JSON ao usuário no texto da resposta.`;
}

interface ModelAction {
  intent: string;
  args: Record<string, unknown>;
  assistant_reply: string;
}

function parseModelJson(raw: string): ModelAction | null {
  const attempt = (text: string): ModelAction | null => {
    try {
      const parsed = JSON.parse(text) as Partial<ModelAction>;
      if (typeof parsed?.intent === "string" && typeof parsed?.assistant_reply === "string") {
        return {
          intent: parsed.intent,
          args: (parsed.args ?? {}) as Record<string, unknown>,
          assistant_reply: parsed.assistant_reply,
        };
      }
      return null;
    } catch {
      return null;
    }
  };
  const cleaned = raw
    .replace(/```json\s*/gi, "")
    .replace(/```/g, "")
    .trim();
  const direct = attempt(cleaned);
  if (direct) return direct;
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) return attempt(cleaned.slice(start, end + 1));
  return null;
}

export interface OrchestrateChatInput {
  userId: string;
  userName: string;
  message: string;
  sessionId: string | null;
}

export class ChatService {
  constructor(
    private readonly repo: ChatRepository,
    private readonly llm: LLMProvider,
    private readonly taskTool: TaskTool,
    private readonly reminderTool: ReminderTool,
    private readonly vaultSearchTool: VaultSearchTool,
  ) {}

  async orchestrate(input: OrchestrateChatInput): Promise<SendChatResult> {
    const { userId, userName, message } = input;
    const now = new Date();

    const sessionId = await this.resolveSession(userId, input.sessionId, message);

    const userRow = await this.repo.insertMessage({
      sessionId,
      userId,
      role: "user",
      content: message,
    });

    const history = await this.repo.recentHistory(sessionId, HISTORY_LIMIT);

    let action: ModelAction | null = null;
    try {
      const raw = await this.llm.complete({
        messages: [
          { role: "system", content: systemPrompt(now.toISOString(), userName) },
          ...history,
        ],
        temperature: 0.5,
        jsonMode: true,
      });
      if (raw) action = parseModelJson(raw);
    } catch (err) {
      logger.error("Falha ao chamar o LLMProvider", err, { route: "chat.service", userId });
    }

    let intent = action && ALLOWED_INTENTS.has(action.intent) ? action.intent : "chat";
    let reply =
      action?.assistant_reply?.trim() ||
      "Não consegui processar sua mensagem agora. Pode repetir, por favor?";
    let toolOutput: JsonValue | null = null;

    if (intent === "create_task" && action) {
      const result = await this.taskTool.createFromArgs(userId, action.args);
      if (result.ok) {
        toolOutput = result.toolOutput;
      } else if (result.reply) {
        reply = result.reply;
        intent = "chat";
      } else {
        intent = "chat";
      }
    } else if (intent === "create_reminder" && action) {
      const result = await this.reminderTool.createFromArgs(userId, action.args);
      if (result.ok) {
        toolOutput = result.toolOutput;
      } else {
        reply = result.reply || reply;
        intent = "chat";
      }
    } else if (intent === "search_password" && action) {
      const result = await this.vaultSearchTool.searchFromArgs(action.args);
      if (result.ok) {
        toolOutput = result.toolOutput;
        reply = result.reply;
      } else {
        intent = "chat";
      }
    }

    const assistantRow = await this.repo.insertMessage({
      sessionId,
      userId,
      role: "assistant",
      content: reply,
      intent,
      toolOutput,
    });

    await this.repo.touchSession(sessionId);

    return {
      session_id: sessionId,
      user_message: userRow as ChatMessageDTO,
      assistant_message: assistantRow as ChatMessageDTO,
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
