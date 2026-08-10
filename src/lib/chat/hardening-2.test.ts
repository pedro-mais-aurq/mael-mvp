import { describe, expect, it, vi } from "vitest";

import type { JsonValue } from "../mael-types";
import type { LLMCompletionResult, LLMProvider, LLMToolCall } from "../providers/llm.provider";
import type { TaskTool } from "../tools/task.tool";
import type { VaultSearchTool } from "../tools/vault-search.tool";
import { ChatOrchestrator } from "./orchestrator";
import type { TaskResolver } from "./task-resolver";
import { ToolRegistry } from "./tool-registry";
import type { ToolExecutionResult } from "./tool-types";
import { normalizePolicyText } from "./turn-policy";

const TASK_A = "11111111-1111-4111-8111-111111111111";
const TASK_B = "22222222-2222-4222-8222-222222222222";

function call(id: string, name: string, args: Record<string, unknown> = {}): LLMToolCall {
  return { id, type: "function", function: { name, arguments: JSON.stringify(args) } };
}

function toolCalls(...calls: LLMToolCall[]): LLMCompletionResult {
  return { content: null, toolCalls: calls, finishReason: "tool_calls" };
}

function answer(content: string): LLMCompletionResult {
  return { content, toolCalls: [], finishReason: "stop" };
}

function result(
  input: {
    modelOutput?: JsonValue;
    persistedOutput?: JsonValue | null;
    fallbackReply?: string;
    mutatesTasks?: boolean;
  } = {},
): ToolExecutionResult {
  return {
    ok: true,
    modelOutput: input.modelOutput ?? { ok: true },
    persistedOutput: input.persistedOutput ?? null,
    fallbackReply: input.fallbackReply ?? "Operação concluída.",
    mutatesTasks: input.mutatesTasks ?? false,
  };
}

function taskList(tasks: Array<{ id: string; title: string }>): ToolExecutionResult {
  return result({
    modelOutput: { ok: true, tasks, truncated: false },
    persistedOutput: { kind: "task_list", count: tasks.length, truncated: false },
    fallbackReply: `Consultei ${tasks.length} tarefa(s).`,
  });
}

function mutation(title = "Tarefa"): ToolExecutionResult {
  return result({
    modelOutput: { ok: true, task: { id: TASK_A, title } },
    persistedOutput: { kind: "task_updated", task: { id: TASK_A, title } },
    fallbackReply: `${title} atualizada.`,
    mutatesTasks: true,
  });
}

function setup(
  userMessage: string,
  completions: LLMCompletionResult[],
  options: {
    tasks?: Array<{ id: string; title: string }>;
  } = {},
) {
  const complete = vi.fn(
    async (_request: Parameters<LLMProvider["complete"]>[0]) => completions.shift() ?? null,
  );
  const taskTool = {
    create: vi.fn(async () => mutation()),
    list: vi.fn(async () => taskList(options.tasks ?? [{ id: TASK_A, title: "Comprar pão" }])),
    update: vi.fn(async () => mutation()),
    setCompleted: vi.fn(async () => mutation()),
    delete: vi.fn(async () => mutation()),
  } as unknown as TaskTool;
  const vaultTool = {
    search: vi.fn(async () =>
      result({
        modelOutput: { ok: true, entries: [], security_notice: "Sem segredos." },
        persistedOutput: { kind: "vault_matches", match_count: 0 },
        fallbackReply: "Cofre consultado.",
      }),
    ),
  } as unknown as VaultSearchTool;
  const resolverTasks = options.tasks ?? [{ id: TASK_A, title: "Comprar pão" }];
  const taskResolver = {
    resolve: vi.fn(async (_userId, targets: ReadonlyArray<ReadonlyArray<string>>) => ({
      truncated: false,
      targets: targets.map((target) => ({
        key: target.join("\u0000"),
        candidates: resolverTasks
          .filter((task) => {
            const title = new Set(normalizePolicyText(task.title).split(/\s+/));
            return target.every((term) => title.has(term));
          })
          .map((task) => ({ ...task, completed: false })),
      })),
    })),
  } as unknown as TaskResolver;
  const orchestrator = new ChatOrchestrator(
    { complete } as LLMProvider,
    new ToolRegistry(taskTool, vaultTool, taskResolver),
  );
  return {
    complete,
    taskTool,
    vaultTool,
    run: () =>
      orchestrator.run({
        userId: "authenticated-user",
        userName: "Ana",
        userMessage,
        timezone: "America/Sao_Paulo",
        now: new Date("2026-08-09T15:00:00.000Z"),
        history: [{ role: "user", content: userMessage }],
      }),
  };
}

describe("P3 Hardening 2 — escopo e vínculo adversarial", () => {
  it.each([
    ["mude minha senha do GitHub", "update_task", "update"],
    ["atualize meu perfil", "update_task", "update"],
    ["finalize o texto", "set_task_completed", "setCompleted"],
    ["feito, obrigado", "set_task_completed", "setCompleted"],
  ] as const)("bloqueia falso positivo de mutação: %s", async (message, toolName, method) => {
    const harness = setup(message, [
      toolCalls(call("illegal-write", toolName, { task_id: TASK_A, completed: true })),
      answer("Alteração feita."),
    ]);

    const response = await harness.run();

    expect(harness.taskTool[method]).not.toHaveBeenCalled();
    expect(response.mutatesTasks).toBe(false);
  });

  it("exige list_tasks em 'mostre minhas tarefas' mesmo se o LLM responder diretamente", async () => {
    const harness = setup("mostre minhas tarefas", [answer("Você tem três tarefas.")]);

    const response = await harness.run();

    expect(harness.taskTool.list).not.toHaveBeenCalled();
    expect(response.reply).toBe("Não consegui consultar suas tarefas agora. Tente novamente.");
  });

  it("exige search_vault em 'me diga meu login salvo no cofre'", async () => {
    const harness = setup("me diga meu login salvo no cofre", [
      answer("Seu login é inventado@example.com."),
    ]);

    const response = await harness.run();

    expect(harness.vaultTool.search).not.toHaveBeenCalled();
    expect(response.reply).toBe("Qual serviço ou entrada do Cofre você quer consultar?");
    expect(response.reply).not.toContain("inventado@example.com");
  });

  it.each([
    "não quero de jeito nenhum que você exclua a tarefa Comprar pão",
    "evite excluir a tarefa Comprar pão",
    "quero impedir que você exclua a tarefa Comprar pão",
  ])("bloqueia delete mesmo com negação distante ou preventiva: %s", async (message) => {
    const harness = setup(message, [
      toolCalls(call("illegal-delete", "delete_task", { task_id: TASK_A })),
      answer("Excluída."),
    ]);

    const response = await harness.run();

    expect(harness.taskTool.delete).not.toHaveBeenCalled();
    expect(response.mutatesTasks).toBe(false);
  });

  it("vincula delete ao alvo original, não a qualquer UUID listado", async () => {
    const harness = setup(
      "exclua a tarefa Comprar pão",
      [
        toolCalls(call("list", "list_tasks", { status: "all" })),
        toolCalls(call("delete", "delete_task", { task_id: TASK_B })),
        answer("Excluída."),
      ],
      {
        tasks: [
          { id: TASK_A, title: "Comprar pão" },
          { id: TASK_B, title: "Pagar conta" },
        ],
      },
    );

    const response = await harness.run();

    expect(harness.taskTool.list).toHaveBeenCalledOnce();
    expect(harness.taskTool.delete).not.toHaveBeenCalled();
    expect(response.reply).toContain("não corresponde ao alvo");
  });

  it("bloqueia list_tasks cuja query diverge do alvo da mutação", async () => {
    const harness = setup("exclua a tarefa Comprar pão", [
      toolCalls(call("list", "list_tasks", { query: "Pagar conta", status: "all" })),
      toolCalls(call("delete", "delete_task", { task_id: TASK_B })),
      answer("Excluída."),
    ]);

    const response = await harness.run();

    expect(harness.taskTool.list).not.toHaveBeenCalled();
    expect(harness.taskTool.delete).not.toHaveBeenCalled();
    expect(response.mutatesTasks).toBe(false);
  });

  it("não considera consulta Vault fora do serviço pedido", async () => {
    const harness = setup("qual meu login do GitHub no Cofre?", [
      toolCalls(call("vault", "search_vault", { query: "Facebook" })),
      answer("Seu login é exemplo@site.com."),
    ]);

    const response = await harness.run();

    expect(harness.vaultTool.search).not.toHaveBeenCalled();
    expect(response.reply).toBe("Não consegui consultar o Cofre agora. Tente novamente.");
    expect(response.reply).not.toContain("exemplo@site.com");
  });

  it("não considera consulta de amanhã sem intervalo temporal", async () => {
    const harness = setup("quais tarefas tenho amanhã?", [
      toolCalls(call("list", "list_tasks", { status: "open" })),
      answer("Você tem duas tarefas amanhã."),
    ]);

    const response = await harness.run();

    expect(harness.taskTool.list).not.toHaveBeenCalled();
    expect(response.reply).toBe("Não consegui consultar suas tarefas agora. Tente novamente.");
  });

  it("aceita o intervalo exato de amanhã no timezone autenticado", async () => {
    const harness = setup("quais tarefas tenho amanhã?", [
      toolCalls(
        call("list", "list_tasks", {
          status: "open",
          due_from: "2026-08-10T03:00:00.000Z",
          due_to: "2026-08-11T02:59:59.999Z",
        }),
      ),
      answer("Consulta concluída."),
    ]);

    const response = await harness.run();

    expect(harness.taskTool.list).toHaveBeenCalledOnce();
    expect(response.executedTools).toContain("list_tasks");
    expect(response.reply).toBe("Consulta concluída.");
  });

  it("bloqueia escolha arbitrária entre títulos semanticamente plausíveis", async () => {
    const harness = setup(
      "conclua a tarefa Comprar pão",
      [
        toolCalls(call("list", "list_tasks", { status: "all" })),
        toolCalls(
          call("complete", "set_task_completed", {
            task_id: TASK_A,
            completed: true,
          }),
        ),
        answer("Concluída."),
      ],
      {
        tasks: [
          { id: TASK_A, title: "Comprar pão hoje" },
          { id: TASK_B, title: "Comprar pão amanhã" },
        ],
      },
    );

    const response = await harness.run();

    expect(harness.taskTool.setCompleted).not.toHaveBeenCalled();
    expect(response.reply).toContain("Qual delas");
  });

  it("permite três lembretes explícitos e bloqueia a quarta mutação", async () => {
    const harness = setup("crie 3 lembretes para amanhã às 9: A, B e C", [
      toolCalls(
        call("create-1", "create_task", {
          title: "A",
          remind_at: "2026-08-10T12:00:00.000Z",
        }),
        call("create-2", "create_task", {
          title: "B",
          remind_at: "2026-08-10T12:00:00.000Z",
        }),
        call("create-3", "create_task", {
          title: "C",
          remind_at: "2026-08-10T12:00:00.000Z",
        }),
        call("create-4", "create_task", {
          title: "D",
          remind_at: "2026-08-10T12:00:00.000Z",
        }),
      ),
      answer("Criei quatro lembretes."),
    ]);

    const response = await harness.run();

    expect(harness.taskTool.create).toHaveBeenCalledTimes(3);
    expect(response.executedTools).toEqual(["create_task", "create_task", "create_task"]);
    expect(response.reply).toContain("parcialmente concluída");
  });
});
