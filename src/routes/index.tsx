import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Send, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

import { AppShell } from "@/components/app-shell";
import { sendChat } from "@/lib/chat.functions";
import type { ChatMessageDTO, JsonValue } from "@/lib/mael-types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const foolLogo = new URL("../assets/fool-logo.svg", import.meta.url).href;

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Mael — Converse com O Louco" },
      {
        name: "description",
        content:
          "Fale com O Louco: peça em linguagem natural para criar tarefas, agendar lembretes e consultar seu cofre de senhas criptografado.",
      },
      { property: "og:title", content: "Mael — Converse com O Louco" },
      {
        property: "og:description",
        content: "O arcano zero do tarô como assistente pessoal: tarefas, lembretes e cofre seguro, em português.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ChatPage,
});

const QUICK_PROMPTS = [
  "Anota a tarefa de comprar pão amanhã de manhã",
  "Me lembra de regar as plantas hoje às 18h",
  "Qual é a senha do meu banco?",
  "O que o dia de hoje me reserva?",
];

type ToolOutput =
  | {
      kind: "task_created";
      title?: string;
      due_date?: string | null;
      due_time?: string | null;
      priority?: string;
      category?: string | null;
    }
  | { kind: "reminder_created"; title?: string; remind_at?: string }
  | {
      kind: "vault_matches";
      query?: string;
      entries?: { name?: string; service?: string | null; username?: string | null }[];
    };

function ToolOutputCard({ output }: { output: ToolOutput }) {
  if (output.kind === "task_created") {
    return (
      <div className="mt-3 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
        <span className="font-display text-[0.65rem] tracking-[0.25em] text-primary uppercase">
          Tarefa anotada
        </span>
        <p className="mt-0.5 font-medium">{String(output.title ?? "")}</p>
        <p className="text-xs text-muted-foreground">
          {[output.due_date, output.due_time].filter(Boolean).join(" · ") || "sem data"}
          {output.priority ? ` · prioridade ${String(output.priority)}` : ""}
        </p>
      </div>
    );
  }
  if (output.kind === "reminder_created") {
    const when = typeof output.remind_at === "string" ? new Date(output.remind_at) : null;
    return (
      <div className="mt-3 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
        <span className="font-display text-[0.65rem] tracking-[0.25em] text-primary uppercase">
          Lembrete gravado
        </span>
        <p className="mt-0.5 font-medium">{String(output.title ?? "")}</p>
        {when && (
          <p className="text-xs text-muted-foreground">
            {format(when, "d 'de' MMMM 'às' HH:mm", { locale: ptBR })}
          </p>
        )}
      </div>
    );
  }
  if (output.kind === "vault_matches" && Array.isArray(output.entries)) {
    const entries = output.entries as { name?: string; service?: string | null; username?: string | null }[];
    if (entries.length === 0) return null;
    return (
      <div className="mt-3 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
        <span className="font-display text-[0.65rem] tracking-[0.25em] text-primary uppercase">
          Encontrado no cofre
        </span>
        <ul className="mt-1 space-y-1">
          {entries.map((e, i) => (
            <li key={i} className="flex items-baseline gap-2">
              <span className="text-primary">✦</span>
              <span className="font-medium">{e.service ?? e.name}</span>
              {e.username && <span className="text-xs text-muted-foreground">{e.username}</span>}
            </li>
          ))}
        </ul>
      </div>
    );
  }
  return null;
}

function AssistantCard({ message }: { message: ChatMessageDTO }) {
  return (
    <div className="flex items-start gap-3">
      <img src={foolLogo} alt="" className="mt-1 h-8 w-8 shrink-0" />
      <div className="tarot-card max-w-[85%] px-4 py-3 pt-5">
        <span className="font-display absolute top-1.5 left-3 text-[0.55rem] tracking-[0.3em] text-primary/70 uppercase">
          0 · O Louco
        </span>
        <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p>
        {message.tool_output && <ToolOutputCard output={message.tool_output as ToolOutput} />}
        <p className="mt-2 text-right text-[0.65rem] text-muted-foreground">
          {format(new Date(message.created_at), "HH:mm")}
        </p>
      </div>
    </div>
  );
}

function UserBubble({ message }: { message: ChatMessageDTO }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-xl rounded-br-sm bg-primary px-4 py-2.5 text-primary-foreground">
        <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p>
        <p className="mt-1 text-right text-[0.65rem] opacity-70">
          {format(new Date(message.created_at), "HH:mm")}
        </p>
      </div>
    </div>
  );
}

function ChatPage() {
  const queryClient = useQueryClient();
  const [messages, setMessages] = useState<ChatMessageDTO[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const sessionIdRef = useRef<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pending]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || pending) return;
    setInput("");
    setPending(true);

    const optimistic: ChatMessageDTO = {
      id: `optimistic-${Date.now()}`,
      session_id: sessionIdRef.current ?? "",
      role: "user",
      content: message,
      intent: null,
      tool_output: null,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);

    try {
      const result = await sendChat({
        data: { message, session_id: sessionIdRef.current },
      });
      sessionIdRef.current = result.session_id;
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== optimistic.id),
        result.user_message,
        result.assistant_message,
      ]);
      const intent = result.assistant_message.intent;
      if (intent === "create_task") {
        queryClient.invalidateQueries({ queryKey: ["tasks"] });
        toast.success("Tarefa anotada no pergaminho.");
      } else if (intent === "create_reminder") {
        queryClient.invalidateQueries({ queryKey: ["reminders"] });
        toast.success("Lembrete gravado — o sino tocará na hora certa.");
      }
    } catch (err) {
      console.error(err);
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      toast.error("A conexão com o oráculo falhou. Tente novamente.");
    } finally {
      setPending(false);
    }
  }

  return (
    <AppShell>
      <div className="flex h-[calc(100vh-8.5rem)] flex-col">
        <div className="flex-1 space-y-5 overflow-y-auto pr-1 pb-4">
          {messages.length === 0 && !pending ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <img src={foolLogo} alt="O Louco" className="h-36 w-36" />
              <h1 className="font-display mt-5 text-2xl font-bold tracking-[0.12em] text-primary gold-glow">
                O Louco aguarda seu primeiro passo
              </h1>
              <p className="mt-2 max-w-md text-sm text-muted-foreground">
                Peça em linguagem natural: anoto tarefas no pergaminho, gravo lembretes que
                tocam na hora certa e consulto seu cofre — sempre sem revelar segredos.
              </p>
              <div className="mt-6 flex max-w-lg flex-wrap justify-center gap-2">
                {QUICK_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => send(prompt)}
                    className="rounded-full border border-primary/40 px-3.5 py-1.5 text-xs text-primary/90 transition-colors hover:bg-primary/10 hover:text-primary"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {messages.map((m) =>
                m.role === "user" ? (
                  <UserBubble key={m.id} message={m} />
                ) : (
                  <AssistantCard key={m.id} message={m} />
                ),
              )}
              {pending && (
                <div className="flex items-start gap-3">
                  <img src={foolLogo} alt="" className="mt-1 h-8 w-8 animate-pulse" />
                  <div className="tarot-card px-4 py-3 pt-5">
                    <span className="font-display absolute top-1.5 left-3 text-[0.55rem] tracking-[0.3em] text-primary/70 uppercase">
                      0 · O Louco
                    </span>
                    <p className="flex items-center gap-2 text-sm text-muted-foreground italic">
                      <Sparkles className="h-3.5 w-3.5 animate-spin text-primary" />
                      consultando as estrelas…
                    </p>
                  </div>
                </div>
              )}
            </>
          )}
          <div ref={bottomRef} />
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="flex items-end gap-2 border-t border-border/70 pt-3"
        >
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            placeholder="Fale com O Louco… (Enter envia, Shift+Enter quebra linha)"
            rows={1}
            className={cn("min-h-10 max-h-32 resize-none")}
            autoFocus
          />
          <Button type="submit" size="icon" disabled={pending || !input.trim()} title="Enviar">
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </div>
    </AppShell>
  );
}
