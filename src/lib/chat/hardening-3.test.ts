import { afterEach, describe, expect, it, vi } from "vitest";

import type { JsonValue } from "../mael-types";
import type { LLMToolCall } from "../providers/llm.provider";
import type { TaskTool } from "../tools/task.tool";
import type { VaultSearchTool } from "../tools/vault-search.tool";
import type { TaskResolution, TaskResolver } from "./task-resolver";
import { ToolRegistry } from "./tool-registry";
import type { ToolExecutionContext, ToolExecutionResult } from "./tool-types";
import { resolveTurnPolicy } from "./turn-policy";

const TASK_A = "11111111-1111-4111-8111-111111111111";
const TASK_B = "22222222-2222-4222-8222-222222222222";

afterEach(() => vi.restoreAllMocks());

function call(name: string, args: Record<string, unknown>, id = "call-1"): LLMToolCall {
  return { id, type: "function", function: { name, arguments: JSON.stringify(args) } };
}

function success(modelOutput: JsonValue = { ok: true }, mutatesTasks = false): ToolExecutionResult {
  return {
    ok: true,
    modelOutput,
    persistedOutput: null,
    fallbackReply: "Operação concluída.",
    mutatesTasks,
  };
}

function resolution(
  candidates: Array<{ id: string; title: string; completed?: boolean }>,
  truncated = false,
): (targets: ReadonlyArray<ReadonlyArray<string>>) => TaskResolution {
  return (targets) => ({
    truncated,
    targets: targets.map((target) => ({
      key: target.join("\u0000"),
      candidates: candidates.map((task) => ({ ...task, completed: task.completed ?? false })),
    })),
  });
}

function setup(
  userMessage: string,
  options: {
    candidates?: Array<{ id: string; title: string; completed?: boolean }>;
    truncated?: boolean;
    listedTasks?: Array<{ id: string; title: string }>;
  } = {},
) {
  const taskTool = {
    create: vi.fn(async () => success({ ok: true, event: "task_created" }, true)),
    list: vi.fn(async () =>
      success({
        ok: true,
        tasks: options.listedTasks ?? [{ id: TASK_A, title: "Comprar pão" }],
        truncated: false,
      }),
    ),
    update: vi.fn(async () => success({ ok: true, event: "task_updated" }, true)),
    setCompleted: vi.fn(async () => success({ ok: true, event: "task_completed" }, true)),
    delete: vi.fn(async () => success({ ok: true, event: "task_deleted" }, true)),
  } as unknown as TaskTool;
  const vaultTool = {
    search: vi.fn(async () => success({ ok: true, entries: [] })),
  } as unknown as VaultSearchTool;
  const taskResolver = {
    resolve: vi.fn(async (_userId, targets: ReadonlyArray<ReadonlyArray<string>>) =>
      resolution(
        options.candidates ?? [{ id: TASK_A, title: "Comprar pão" }],
        options.truncated,
      )(targets),
    ),
  } as unknown as TaskResolver;
  const context: ToolExecutionContext = {
    userId: "authenticated-user",
    userMessage,
    now: new Date("2026-08-09T15:00:00.000Z"),
    timezone: "America/Sao_Paulo",
    policy: resolveTurnPolicy(userMessage, {
      now: new Date("2026-08-09T15:00:00.000Z"),
      timezone: "America/Sao_Paulo",
    }),
    backendTaskResolution: null,
    backendTaskResolutionPromise: null,
    createdTaskTitles: new Set(),
    consumedTaskTargetKeys: new Set(),
    consumedTaskIds: new Set(),
    mutationAttempts: 0,
    readAttempts: 0,
  };
  return {
    registry: new ToolRegistry(taskTool, vaultTool, taskResolver),
    context,
    taskTool,
    vaultTool,
    taskResolver,
  };
}

describe("P3 Hardening 3 — matriz adversarial obrigatória", () => {
  it("1. detecta ambiguidade escondida por limit=1", async () => {
    const harness = setup("Exclua a tarefa Comprar pão.", {
      candidates: [
        { id: TASK_A, title: "Comprar pão hoje" },
        { id: TASK_B, title: "Comprar pão amanhã" },
      ],
      listedTasks: [{ id: TASK_A, title: "Comprar pão hoje" }],
    });
    await harness.registry.execute(
      harness.context,
      call("list_tasks", { query: "Comprar pão", limit: 1, status: "all" }, "list"),
    );
    const result = await harness.registry.execute(
      harness.context,
      call("delete_task", { task_id: TASK_A }, "delete"),
    );
    expect(result.modelOutput).toMatchObject({ error: { code: "task_ambiguous" } });
    expect(harness.taskTool.delete).not.toHaveBeenCalled();
  });

  it("2. não deixa status do LLM esconder candidato", async () => {
    const harness = setup("Exclua a tarefa Comprar pão.", {
      candidates: [
        { id: TASK_A, title: "Comprar pão", completed: false },
        { id: TASK_B, title: "Comprar pão", completed: true },
      ],
    });
    await harness.registry.execute(
      harness.context,
      call("list_tasks", { status: "open", limit: 1 }, "list"),
    );
    await harness.registry.execute(
      harness.context,
      call("delete_task", { task_id: TASK_A }, "delete"),
    );
    expect(harness.taskResolver.resolve).toHaveBeenCalledWith(
      "authenticated-user",
      [["comprar", "pao"]],
      "all",
    );
    expect(harness.taskTool.delete).not.toHaveBeenCalled();
  });

  it("3. detecta query artificialmente mais específica", async () => {
    const harness = setup("Exclua a tarefa Comprar.", {
      candidates: [
        { id: TASK_A, title: "Comprar pão" },
        { id: TASK_B, title: "Comprar leite" },
      ],
    });
    await harness.registry.execute(
      harness.context,
      call("list_tasks", { query: "Comprar pão", limit: 1, status: "all" }, "list"),
    );
    const result = await harness.registry.execute(
      harness.context,
      call("delete_task", { task_id: TASK_A }, "delete"),
    );
    expect(result.modelOutput).toMatchObject({ error: { code: "task_ambiguous" } });
    expect(harness.taskTool.delete).not.toHaveBeenCalled();
  });

  it("4. truncated=true nunca resolve o recurso", async () => {
    const harness = setup("Exclua a tarefa Comprar pão.", { truncated: true });
    const result = await harness.registry.execute(
      harness.context,
      call("delete_task", { task_id: TASK_A }),
    );
    expect(result.modelOutput).toMatchObject({ error: { code: "task_resolution_truncated" } });
    expect(harness.taskTool.delete).not.toHaveBeenCalled();
  });

  it("5. rejeita update com campo extra", async () => {
    const harness = setup("Mude a prioridade da tarefa Comprar pão para alta.");
    const result = await harness.registry.execute(
      harness.context,
      call("update_task", { task_id: TASK_A, priority: "alta", title: "Outro" }),
    );
    expect(result.modelOutput).toMatchObject({ error: { code: "task_field_scope_mismatch" } });
    expect(harness.taskResolver.resolve).not.toHaveBeenCalled();
    expect(harness.taskTool.update).not.toHaveBeenCalled();
  });

  it("6. rejeita prioridade diferente da solicitada", async () => {
    const harness = setup("Mude a prioridade da tarefa Comprar pão para alta.");
    const result = await harness.registry.execute(
      harness.context,
      call("update_task", { task_id: TASK_A, priority: "baixa" }),
    );
    expect(result.modelOutput).toMatchObject({ error: { code: "task_value_scope_mismatch" } });
    expect(harness.taskTool.update).not.toHaveBeenCalled();
  });

  it("7. rejeita complete invertido", async () => {
    const harness = setup("Conclua a tarefa Comprar pão.");
    const result = await harness.registry.execute(
      harness.context,
      call("set_task_completed", { task_id: TASK_A, completed: false }),
    );
    expect(result.modelOutput).toMatchObject({ error: { code: "task_value_scope_mismatch" } });
    expect(harness.taskTool.setCompleted).not.toHaveBeenCalled();
  });

  it("8. rejeita reopen invertido", async () => {
    const harness = setup("Reabra a tarefa Comprar pão.", {
      candidates: [{ id: TASK_A, title: "Comprar pão", completed: true }],
    });
    const result = await harness.registry.execute(
      harness.context,
      call("set_task_completed", { task_id: TASK_A, completed: true }),
    );
    expect(result.modelOutput).toMatchObject({ error: { code: "task_value_scope_mismatch" } });
    expect(harness.taskTool.setCompleted).not.toHaveBeenCalled();
  });

  it("9. rejeita create_task com título diferente", async () => {
    const harness = setup("Crie uma tarefa Comprar pão.");
    const result = await harness.registry.execute(
      harness.context,
      call("create_task", { title: "Pagar conta" }),
    );
    expect(result.modelOutput).toMatchObject({ error: { code: "create_title_mismatch" } });
    expect(harness.taskTool.create).not.toHaveBeenCalled();
  });

  it("10. rejeita reminder não solicitado na criação", async () => {
    const harness = setup("Crie uma tarefa Comprar pão.");
    const result = await harness.registry.execute(
      harness.context,
      call("create_task", {
        title: "Comprar pão",
        remind_at: "2026-08-10T12:00:00.000Z",
      }),
    );
    expect(result.modelOutput).toMatchObject({ error: { code: "create_field_scope_mismatch" } });
    expect(harness.taskTool.create).not.toHaveBeenCalled();
  });

  it("10b. rejeita prioridade customizada não solicitada", async () => {
    const harness = setup("Crie uma tarefa Comprar pão.");
    const result = await harness.registry.execute(
      harness.context,
      call("create_task", { title: "Comprar pão", priority: "alta" }),
    );
    expect(result.modelOutput).toMatchObject({ error: { code: "create_field_scope_mismatch" } });
    expect(harness.taskTool.create).not.toHaveBeenCalled();
  });

  it("10c. criação plural não aceita título fora da lista", async () => {
    const harness = setup("Crie três tarefas: A, B e C.");
    const result = await harness.registry.execute(
      harness.context,
      call("create_task", { title: "D" }),
    );
    expect(result.modelOutput).toMatchObject({ error: { code: "create_title_mismatch" } });
    expect(harness.taskTool.create).not.toHaveBeenCalled();
  });

  it("11. rejeita query/limit em listagem geral", async () => {
    const harness = setup("Mostre minhas tarefas.");
    const result = await harness.registry.execute(
      harness.context,
      call("list_tasks", { status: "open", query: "Comprar pão", limit: 1 }),
    );
    expect(result.modelOutput).toMatchObject({ error: { code: "task_query_scope_mismatch" } });
    expect(harness.taskTool.list).not.toHaveBeenCalled();
  });

  it("12. rejeita status diferente do pedido", async () => {
    const harness = setup("Mostre minhas tarefas concluídas.");
    const result = await harness.registry.execute(
      harness.context,
      call("list_tasks", { status: "open", limit: 50 }),
    );
    expect(result.modelOutput).toMatchObject({ error: { code: "task_query_status_mismatch" } });
    expect(harness.taskTool.list).not.toHaveBeenCalled();
  });

  it("13. Cofre sem serviço pede alvo e não executa busca", async () => {
    const harness = setup("Me diga meu login salvo no Cofre.");
    const result = await harness.registry.execute(
      harness.context,
      call("search_vault", { query: "Facebook" }),
    );
    expect(result.modelOutput).toMatchObject({ error: { code: "vault_target_required" } });
    expect(result.fallbackReply).toContain("Qual serviço");
    expect(harness.vaultTool.search).not.toHaveBeenCalled();
  });

  it("14. extrai somente GitHub do pedido Vault com verbo", async () => {
    const harness = setup("Mude minha senha do GitHub.");
    expect(harness.context.policy.vaultQueryTerms).toEqual(["github"]);
    const result = await harness.registry.execute(
      harness.context,
      call("search_vault", { query: "GitHub" }),
    );
    expect(result.ok).toBe(true);
    expect(harness.vaultTool.search).toHaveBeenCalledOnce();
  });

  it("15. remove pontuação e cortesia do target", () => {
    expect(resolveTurnPolicy("Conclua a tarefa Comprar pão, por favor.").taskTargetTerms).toEqual([
      ["comprar", "pao"],
    ]);
    expect(resolveTurnPolicy("Exclua a tarefa Comprar pão por gentileza.").taskTargetTerms).toEqual(
      [["comprar", "pao"]],
    );
  });

  it("16. extrai target com sinônimos do domínio", () => {
    expect(resolveTurnPolicy("Conclua o compromisso Consulta.").taskTargetTerms).toEqual([
      ["consulta"],
    ]);
    expect(resolveTurnPolicy("Altere a pendência Comprar pão.").taskTargetTerms).toEqual([
      ["comprar", "pao"],
    ]);
  });

  it("17. remover lembrete atualiza somente reminder e nunca apaga Task", async () => {
    const harness = setup("Remova o lembrete da tarefa Comprar pão.");
    expect(harness.context.policy.allowedTools.has("update_task")).toBe(true);
    expect(harness.context.policy.allowedTools.has("delete_task")).toBe(false);
    const result = await harness.registry.execute(
      harness.context,
      call("update_task", { task_id: TASK_A, remind_at: null }),
    );
    expect(result.ok).toBe(true);
    expect(harness.taskTool.update).toHaveBeenCalledWith("authenticated-user", {
      task_id: TASK_A,
      remind_at: null,
    });
    expect(harness.taskTool.delete).not.toHaveBeenCalled();
  });

  it("18. consulta de amanhã injeta due_date legado sem inventar due_at", async () => {
    const harness = setup("Quais tarefas tenho amanhã?");
    const result = await harness.registry.execute(
      harness.context,
      call("list_tasks", {
        status: "open",
        limit: 50,
        due_from: "2026-08-10T03:00:00.000Z",
        due_to: "2026-08-11T02:59:59.999Z",
      }),
    );
    expect(result.ok).toBe(true);
    expect(harness.taskTool.list).toHaveBeenCalledWith(
      "authenticated-user",
      expect.objectContaining({ legacy_due_date: "2026-08-10" }),
    );
  });

  it("registra dimensões seguras da rejeição sem payload", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const harness = setup("Mude a prioridade da tarefa Comprar pão para alta.");
    await harness.registry.execute(
      harness.context,
      call("update_task", { task_id: TASK_A, priority: "alta", title: "SIGILOSO" }),
    );
    const entry = JSON.parse(String(consoleSpy.mock.calls.at(-1)?.[0]));
    expect(entry).toMatchObject({
      reason: "task_field_scope_mismatch",
      resource_binding: "not_evaluated",
      field_scope: "denied",
      value_scope: "not_evaluated",
      query_scope: "not_evaluated",
    });
    expect(JSON.stringify(entry)).not.toContain("SIGILOSO");
  });
});
