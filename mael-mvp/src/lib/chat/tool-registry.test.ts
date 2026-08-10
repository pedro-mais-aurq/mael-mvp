import { afterEach, describe, expect, it, vi } from "vitest";

import type { JsonValue } from "../mael-types";
import type { LLMToolCall } from "../providers/llm.provider";
import { NotFoundError } from "../core/exceptions";
import type { TaskTool } from "../tools/task.tool";
import type { VaultSearchTool } from "../tools/vault-search.tool";
import type { TaskResolver } from "./task-resolver";
import { ToolRegistry } from "./tool-registry";
import type { ToolExecutionContext, ToolExecutionResult } from "./tool-types";
import { resolveTurnPolicy } from "./turn-policy";

const TASK_ID = "11111111-1111-4111-8111-111111111111";

afterEach(() => {
  vi.restoreAllMocks();
});

function result(mutatesTasks = false, modelOutput: JsonValue = { ok: true }) {
  return {
    ok: true,
    modelOutput,
    persistedOutput: null,
    fallbackReply: "ok",
    mutatesTasks,
  } satisfies ToolExecutionResult;
}

function toolCall(name: string, args: unknown, id = "call-1"): LLMToolCall {
  return {
    id,
    type: "function",
    function: { name, arguments: typeof args === "string" ? args : JSON.stringify(args) },
  };
}

function setup(userMessage = "crie uma tarefa Comprar pão") {
  const taskTool = {
    create: vi.fn(async () => result(true)),
    list: vi.fn(async () =>
      result(false, { ok: true, tasks: [{ id: TASK_ID, title: "Comprar pão" }] }),
    ),
    update: vi.fn(async () => result(true)),
    setCompleted: vi.fn(async () => result(true)),
    delete: vi.fn(async () => result(true)),
  } as unknown as TaskTool;
  const vaultTool = {
    search: vi.fn(async () => result(false)),
  } as unknown as VaultSearchTool;
  const taskResolver = {
    resolve: vi.fn(async (_userId, targets: ReadonlyArray<ReadonlyArray<string>>) => ({
      truncated: false,
      targets: targets.map((target) => ({
        key: target.join("\u0000"),
        candidates: [{ id: TASK_ID, title: "Comprar pão", completed: false }],
      })),
    })),
  } as unknown as TaskResolver;
  const registry = new ToolRegistry(taskTool, vaultTool, taskResolver);
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
  return { registry, taskTool, vaultTool, taskResolver, context };
}

describe("ToolRegistry — whitelist, schemas e autorização", () => {
  it("publica exatamente os seis tools da P3 sem userId nem create_reminder", () => {
    const { registry } = setup();
    const definitions = registry.definitions();
    expect(definitions.map((item) => item.function.name)).toEqual([
      "create_task",
      "list_tasks",
      "update_task",
      "set_task_completed",
      "delete_task",
      "search_vault",
    ]);
    const serialized = JSON.stringify(definitions);
    expect(serialized).not.toContain("create_reminder");
    expect(serialized).not.toMatch(/user_?id/i);
    for (const definition of definitions) {
      expect(definition.function.parameters).toMatchObject({
        type: "object",
        additionalProperties: false,
      });
    }
  });

  it("injeta o userId autenticado no servidor e rejeita userId vindo do modelo", async () => {
    const { registry, taskTool, context } = setup(
      "crie uma tarefa Comprar pão com prioridade alta",
    );
    const ok = await registry.execute(
      context,
      toolCall("create_task", { title: "Comprar pão", priority: "alta" }),
    );
    expect(ok.ok).toBe(true);
    expect(taskTool.create).toHaveBeenCalledWith("authenticated-user", {
      title: "Comprar pão",
      priority: "alta",
    });

    context.mutationAttempts = 0;
    const injected = await registry.execute(
      context,
      toolCall("create_task", { title: "Ataque", userId: "victim" }, "call-2"),
    );
    expect(injected).toMatchObject({
      ok: false,
      modelOutput: { error: { code: "invalid_arguments" } },
    });
    expect(taskTool.create).toHaveBeenCalledTimes(1);
  });

  it("rejeita tool desconhecida, JSON inválido e argumentos fora do schema", async () => {
    const unknown = setup();
    await expect(
      unknown.registry.execute(unknown.context, toolCall("drop_database", {})),
    ).resolves.toMatchObject({
      modelOutput: { error: { code: "unknown_tool" } },
    });
    const invalidJson = setup();
    await expect(
      invalidJson.registry.execute(invalidJson.context, toolCall("create_task", "{não-json")),
    ).resolves.toMatchObject({ modelOutput: { error: { code: "invalid_json" } } });
    const invalidArgs = setup();
    await expect(
      invalidArgs.registry.execute(invalidArgs.context, toolCall("create_task", { title: "" })),
    ).resolves.toMatchObject({ modelOutput: { error: { code: "invalid_arguments" } } });
    expect(unknown.taskTool.create).not.toHaveBeenCalled();
    expect(invalidJson.taskTool.create).not.toHaveBeenCalled();
    expect(invalidArgs.taskTool.create).not.toHaveBeenCalled();
  });

  it("resolve a Task no backend sem confiar em list_tasks", async () => {
    const backendLookup = setup("conclua a tarefa Comprar pão");
    const beforeList = await backendLookup.registry.execute(
      backendLookup.context,
      toolCall("set_task_completed", { task_id: TASK_ID, completed: true }),
    );
    expect(beforeList.ok).toBe(true);
    expect(backendLookup.taskResolver.resolve).toHaveBeenCalledOnce();
    expect(backendLookup.taskTool.list).not.toHaveBeenCalled();
    expect(backendLookup.taskTool.setCompleted).toHaveBeenCalledOnce();

    const sequenced = setup("conclua a tarefa Comprar pão");
    await sequenced.registry.execute(
      sequenced.context,
      toolCall("list_tasks", { status: "all" }, "call-list"),
    );
    await sequenced.registry.execute(
      sequenced.context,
      toolCall("set_task_completed", { task_id: TASK_ID, completed: true }, "call-done"),
    );
    expect(sequenced.taskTool.setCompleted).toHaveBeenCalledWith("authenticated-user", {
      task_id: TASK_ID,
      completed: true,
    });
  });

  it("bloqueia UUID inventado mesmo que seja sintaticamente válido", async () => {
    const { registry, taskTool, context } = setup("renomeie a tarefa Comprar pão para Invadida");
    await registry.execute(context, toolCall("list_tasks", {}));
    const result = await registry.execute(
      context,
      toolCall("update_task", {
        task_id: "22222222-2222-4222-8222-222222222222",
        title: "Invadida",
      }),
    );
    expect(result.modelOutput).toMatchObject({ error: { code: "task_target_mismatch" } });
    expect(taskTool.update).not.toHaveBeenCalled();
  });

  it("converte mutação sem linha afetada em not_found, nunca sucesso", async () => {
    const { registry, taskTool, context } = setup("renomeie a tarefa Comprar pão para Novo título");
    await registry.execute(context, toolCall("list_tasks", {}));
    vi.mocked(taskTool.update).mockRejectedValueOnce(new NotFoundError("Tarefa não encontrada."));

    const result = await registry.execute(
      context,
      toolCall("update_task", { task_id: TASK_ID, title: "Novo título" }),
    );
    expect(result).toMatchObject({
      ok: false,
      modelOutput: { error: { code: "not_found" } },
      mutatesTasks: false,
    });
  });

  it("autoriza delete apenas com pedido explícito para excluir a Task inteira", async () => {
    const denied = setup("remova o lembrete da tarefa");
    await expect(
      denied.registry.execute(denied.context, toolCall("delete_task", { task_id: TASK_ID })),
    ).resolves.toMatchObject({ modelOutput: { error: { code: "tool_not_authorized" } } });

    const allowed = setup("exclua a tarefa Comprar pão");
    await allowed.registry.execute(allowed.context, toolCall("list_tasks", {}, "call-list"));
    await allowed.registry.execute(
      allowed.context,
      toolCall("delete_task", { task_id: TASK_ID }, "call-delete"),
    );
    expect(allowed.taskTool.delete).toHaveBeenCalledWith("authenticated-user", {
      task_id: TASK_ID,
    });
  });

  it("busca o Cofre com o usuário autenticado", async () => {
    const { registry, vaultTool, context } = setup("qual é minha senha do github no cofre?");
    await registry.execute(context, toolCall("search_vault", { query: "github" }));
    expect(vaultTool.search).toHaveBeenCalledWith("authenticated-user", { query: "github" });
  });

  it("registra decisão auditável sem incluir argumentos da Tool", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { registry, context } = setup("crie uma tarefa SEGREDO-CONFIDENCIAL-123");
    await registry.execute(
      context,
      toolCall("create_task", { title: "SEGREDO-CONFIDENCIAL-123" }, "call-audit"),
    );

    const entry = JSON.parse(String(consoleSpy.mock.calls.at(-1)?.[0]));
    expect(entry).toMatchObject({
      tool: "create_task",
      toolCallId: "call-audit",
      decision: "authorized",
      reason: "tool_succeeded",
      outcome: "success",
    });
    expect(JSON.stringify(entry)).not.toContain("SEGREDO-CONFIDENCIAL-123");
    consoleSpy.mockRestore();
  });

  it("registra NotFound autorizado como falha sem perder o tool_call_id", async () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { registry, taskTool, context } = setup("renomeie a tarefa Comprar pão para Novo título");
    await registry.execute(context, toolCall("list_tasks", {}, "call-list"));
    vi.mocked(taskTool.update).mockRejectedValueOnce(new NotFoundError());
    await registry.execute(
      context,
      toolCall("update_task", { task_id: TASK_ID, title: "Novo título" }, "call-not-found"),
    );

    const entry = JSON.parse(String(consoleSpy.mock.calls.at(-1)?.[0]));
    expect(entry).toMatchObject({
      tool: "update_task",
      toolCallId: "call-not-found",
      decision: "authorized",
      reason: "not_found",
      outcome: "failure",
    });
    consoleSpy.mockRestore();
  });

  it("não registra detalhes potencialmente sensíveis de exceções inesperadas", async () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { registry, taskTool, context } = setup("crie uma tarefa Outro segredo");
    vi.mocked(taskTool.create).mockRejectedValueOnce(
      new Error("ciphertext=SEGREDO-QUE-NAO-DEVE-IR-AO-LOG"),
    );

    const response = await registry.execute(
      context,
      toolCall("create_task", { title: "Outro segredo" }, "call-error"),
    );

    expect(response).toMatchObject({
      ok: false,
      modelOutput: { error: { code: "tool_execution_failed" } },
    });
    const entry = JSON.parse(String(consoleSpy.mock.calls.at(-1)?.[0]));
    expect(entry).toMatchObject({
      tool: "create_task",
      toolCallId: "call-error",
      decision: "authorized",
      reason: "tool_execution_failed",
      outcome: "failure",
    });
    expect(JSON.stringify(entry)).not.toContain("SEGREDO-QUE-NAO-DEVE-IR-AO-LOG");
    expect(JSON.stringify(entry)).not.toContain("Outro segredo");
    consoleSpy.mockRestore();
  });

  it("bloqueia mutação quando há duas tarefas plausíveis com o mesmo título", async () => {
    const secondId = "22222222-2222-4222-8222-222222222222";
    const { registry, taskTool, taskResolver, context } = setup(
      "renomeie a tarefa Comprar pão para Comprar leite",
    );
    vi.mocked(taskTool.list).mockResolvedValueOnce(
      result(false, {
        ok: true,
        tasks: [
          { id: TASK_ID, title: "Comprar pão" },
          { id: secondId, title: "Comprar pão" },
        ],
      }),
    );
    vi.mocked(taskResolver.resolve).mockResolvedValueOnce({
      truncated: false,
      targets: [
        {
          key: "comprar\u0000pao",
          candidates: [
            { id: TASK_ID, title: "Comprar pão", completed: false },
            { id: secondId, title: "Comprar pão", completed: false },
          ],
        },
      ],
    });
    await registry.execute(context, toolCall("list_tasks", {}, "call-list"));
    const response = await registry.execute(
      context,
      toolCall("update_task", { task_id: TASK_ID, title: "Comprar leite" }, "call-update"),
    );
    expect(response).toMatchObject({
      ok: false,
      modelOutput: { error: { code: "task_ambiguous" } },
    });
    expect(taskTool.update).not.toHaveBeenCalled();
  });
});
