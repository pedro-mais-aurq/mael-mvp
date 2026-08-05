import type { SupabaseClient } from "@supabase/supabase-js";

import type { ChatMessageDTO, SendChatResult, VaultMetaEntry } from "./mael-types";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-2.5-flash";
const HISTORY_LIMIT = 12;

const ALLOWED_INTENTS = new Set(["create_task", "create_reminder", "search_password", "chat"]);
const ALLOWED_PRIORITIES = new Set(["baixa", "media", "alta"]);

function systemPrompt(nowIso: string, userName: string): string {
  return `Você é O Louco (Le Mat), o arcano zero do tarô — o andarilho à beira do precipício, fardel ao ombro, cão fiel aos pés e o sol como guia. Você conversa com ${userName}.

PERSONA: fala português brasileiro com alma poética — breve, luminoso, com um sorriso sábio por trás das palavras. Mas por trás do bobo há um assistente pessoal preciso que age no mundo real por meio de ferramentas.

Data e hora atual (UTC): ${nowIso}. Interprete datas relativas ("amanhã", "sexta às 9h") a partir dela, sempre em UTC.

Responda SEMPRE com um único objeto JSON válido, sem markdown e sem texto fora do JSON:
{"intent": "chat|create_task|create_reminder|search_password", "args": {...}, "assistant_reply": "..."}

INTENTS:
- create_task: {"title": str, "description": str|null, "category": str|null, "priority": "baixa"|"media"|"alta", "due_date": "YYYY-MM-DD"|null, "due_time": "HH:MM"|null}
- create_reminder: {"title": str, "notes": str|null, "remind_at": "ISO8601 em UTC"}
- search_password: {"query": str} — busca entradas do cofre do usuário. NUNCA invente resultados; os dados reais chegarão pelo sistema.
- chat: {} — quando nenhuma ferramenta se aplica.

REGRAS:
- assistant_reply: no máximo 3 frases, na voz do Louco, útil antes de poético.
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
  const cleaned = raw.replace(/```json\s*/gi, "").replace(/```/g, "").trim();
  const direct = attempt(cleaned);
  if (direct) return direct;
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) return attempt(cleaned.slice(start, end + 1));
  return null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asDateOnly(value: unknown): string | null {
  const s = asString(value);
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function asTimeOnly(value: unknown): string | null {
  const s = asString(value);
  return s && /^\d{2}:\d{2}(:\d{2})?$/.test(s) ? s.slice(0, 5) : null;
}

export async function orchestrateChat(opts: {
  supabase: SupabaseClient;
  userId: string;
  userName: string;
  message: string;
  sessionId: string | null;
}): Promise<SendChatResult> {
  const { supabase, userId, userName, message } = opts;
  const now = new Date();

  // Sessão: reutiliza a existente (validando dono) ou cria uma nova.
  let sessionId = opts.sessionId;
  if (sessionId) {
    const { data: session } = await supabase
      .from("chat_sessions")
      .select("id")
      .eq("id", sessionId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!session) sessionId = null;
  }
  if (!sessionId) {
    const { data: created, error } = await supabase
      .from("chat_sessions")
      .insert({ user_id: userId, title: message.slice(0, 60) })
      .select("id")
      .single();
    if (error) throw new Error(`Falha ao criar sessão: ${error.message}`);
    sessionId = created.id as string;
  }

  // Persiste a mensagem do usuário.
  const { data: userRow, error: userErr } = await supabase
    .from("chat_messages")
    .insert({ session_id: sessionId, user_id: userId, role: "user", content: message })
    .select("id, session_id, role, content, intent, tool_output, created_at")
    .single();
  if (userErr) throw new Error(`Falha ao salvar mensagem: ${userErr.message}`);

  // Últimas N mensagens (o backend original pegava as PRIMEIRAS 20 — bug corrigido).
  const { data: historyRows } = await supabase
    .from("chat_messages")
    .select("role, content")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT);
  const history = (historyRows ?? [])
    .reverse()
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content as string }));

  let action: ModelAction | null = null;
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (apiKey) {
    try {
      const res = await fetch(GATEWAY_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: MODEL,
          temperature: 0.5,
          response_format: { type: "json_object" },
          messages: [{ role: "system", content: systemPrompt(now.toISOString(), userName) }, ...history],
        }),
      });
      if (!res.ok) {
        console.error(`AI gateway falhou [${res.status}]: ${await res.text()}`);
      } else {
        const payload = (await res.json()) as {
          choices?: { message?: { content?: string } }[];
        };
        const raw = payload.choices?.[0]?.message?.content ?? "";
        action = parseModelJson(raw);
      }
    } catch (err) {
      console.error("Erro ao chamar o gateway de IA:", err);
    }
  }

  let intent = action && ALLOWED_INTENTS.has(action.intent) ? action.intent : "chat";
  let reply =
    action?.assistant_reply?.trim() ||
    "As cartas embaralharam por um instante — repita sua pergunta, viajante.";
  let toolOutput: Record<string, unknown> | null = null;

  if (intent === "create_task" && action) {
    const title = asString(action.args["title"]);
    if (title) {
      const priorityRaw = asString(action.args["priority"]) ?? "media";
      const priority = ALLOWED_PRIORITIES.has(priorityRaw) ? priorityRaw : "media";
      const task = {
        user_id: userId,
        title,
        description: asString(action.args["description"]),
        category: asString(action.args["category"]),
        priority,
        due_date: asDateOnly(action.args["due_date"]),
        due_time: asTimeOnly(action.args["due_time"]),
      };
      const { error } = await supabase.from("tasks").insert(task);
      if (error) {
        reply = "Tentei anotar sua tarefa no pergaminho, mas a tinta falhou. Tente novamente.";
        intent = "chat";
      } else {
        toolOutput = {
          kind: "task_created",
          title: task.title,
          priority,
          due_date: task.due_date,
          due_time: task.due_time,
          category: task.category,
        };
      }
    } else {
      intent = "chat";
    }
  } else if (intent === "create_reminder" && action) {
    const title = asString(action.args["title"]);
    const remindAtRaw = asString(action.args["remind_at"]);
    const remindAt = remindAtRaw ? new Date(remindAtRaw) : null;
    if (title && remindAt && !Number.isNaN(remindAt.getTime())) {
      const { error } = await supabase.from("reminders").insert({
        user_id: userId,
        title,
        notes: asString(action.args["notes"]),
        remind_at: remindAt.toISOString(),
      });
      if (error) {
        reply = "O sino do lembrete não tocou — falha ao gravar. Tente de novo.";
        intent = "chat";
      } else {
        toolOutput = { kind: "reminder_created", title, remind_at: remindAt.toISOString() };
      }
    } else {
      reply = "Para gravar um lembrete preciso saber o momento exato. Quando devo soar o sino?";
      intent = "chat";
    }
  } else if (intent === "search_password" && action) {
    const query = asString(action.args["query"]);
    if (query) {
      // Metadados apenas — NUNCA o ciphertext. O conteúdo sensível só é
      // decifrado no dispositivo do usuário, com a senha mestra.
      const pattern = `%${query.replace(/[%,]/g, " ")}%`;
      const { data: entries } = await supabase
        .from("vault_entries")
        .select("name, service, username, strength_label")
        .or(`name.ilike.${pattern},service.ilike.${pattern},username.ilike.${pattern}`)
        .order("name")
        .limit(8);
      const metas: VaultMetaEntry[] = entries ?? [];
      toolOutput = { kind: "vault_matches", query, entries: metas };
      reply =
        metas.length === 0
          ? `Consultei seu cofre e não encontrei nada sobre "${query}". Se quiser, posso guardar essa senha agora — abra o Cofre.`
          : metas.length === 1
            ? `Encontrei uma entrada no seu cofre: ${metas[0].service ?? metas[0].name}. Por segurança, a senha só é revelada no Cofre, com sua senha mestra.`
            : `Encontrei ${metas.length} entradas no seu cofre. A senha em si só é revelada no Cofre, com sua senha mestra.`;
    } else {
      intent = "chat";
    }
  }

  const { data: assistantRow, error: assistantErr } = await supabase
    .from("chat_messages")
    .insert({
      session_id: sessionId,
      user_id: userId,
      role: "assistant",
      content: reply,
      intent,
      tool_output: toolOutput,
    })
    .select("id, session_id, role, content, intent, tool_output, created_at")
    .single();
  if (assistantErr) throw new Error(`Falha ao salvar resposta: ${assistantErr.message}`);

  await supabase
    .from("chat_sessions")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", sessionId);

  return {
    session_id: sessionId,
    user_message: userRow as ChatMessageDTO,
    assistant_message: assistantRow as ChatMessageDTO,
  };
}
