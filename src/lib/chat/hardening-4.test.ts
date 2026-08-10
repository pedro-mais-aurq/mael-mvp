import { describe, expect, it, vi } from "vitest";

import type { JsonValue } from "../mael-types";
import type { LLMProvider, LLMToolCall } from "../providers/llm.provider";
import type { TaskTool } from "../tools/task.tool";
import type { VaultSearchTool } from "../tools/vault-search.tool";
import { ChatOrchestrator } from "./orchestrator";
import type { TaskResolver } from "./task-resolver";
import { ToolRegistry } from "./tool-registry";
import type { ToolExecutionContext, ToolExecutionResult } from "./tool-types";
import { resolveTurnPolicy } from "./turn-policy";

const NOW = new Date("2026-08-09T15:00:00.000Z");
const TIMEZONE = "America/Sao_Paulo";
const TASK_A = "11111111-1111-4111-8111-111111111111";
const TASK_B = "22222222-2222-4222-8222-222222222222";

function call(name: string, args: Record<string, unknown>, id = `call-${name}`): LLMToolCall {
  return { id, type: "function", function: { name, arguments: JSON.stringify(args) } };
}

function result(
  ok = true,
  mutatesTasks = false,
  fallbackReply = ok ? "Operação concluída." : "Não foi possível alterar a segunda Task.",
): ToolExecutionResult {
  const modelOutput: JsonValue = ok
    ? { ok: true }
    : { ok: false, error: { code: "forced_failure", message: fallbackReply } };
  return { ok, modelOutput, persistedOutput: null, fallbackReply, mutatesTasks };
}

function setup(userMessage: string, failTaskId?: string) {
  const taskTool = {
    create: vi.fn(async () => result(true, true)),
    list: vi.fn(async () => result(true)),
    update: vi.fn(async () => result(true, true)),
    setCompleted: vi.fn(async (_userId: string, input: { task_id: string }) =>
      input.task_id === failTaskId ? result(false) : result(true, true),
    ),
    delete: vi.fn(async () => result(true, true)),
  } as unknown as TaskTool;
  const vaultTool = {
    search: vi.fn(async () => result(true)),
  } as unknown as VaultSearchTool;
  const taskByTarget = new Map([
    ["comprar\u0000pao", { id: TASK_A, title: "Comprar pão", completed: false }],
    ["pagar\u0000conta", { id: TASK_B, title: "Pagar conta", completed: false }],
    ["x", { id: TASK_A, title: "X", completed: false }],
  ]);
  const taskResolver = {
    resolve: vi.fn(async (_userId, targets: ReadonlyArray<ReadonlyArray<string>>) => ({
      truncated: false,
      targets: targets.map((target) => {
        const key = target.join("\u0000");
        const task = taskByTarget.get(key);
        return { key, candidates: task ? [task] : [] };
      }),
    })),
  } as unknown as TaskResolver;
  const context: ToolExecutionContext = {
    userId: "authenticated-user",
    userMessage,
    now: NOW,
    timezone: TIMEZONE,
    policy: resolveTurnPolicy(userMessage, { now: NOW, timezone: TIMEZONE }),
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

describe("P3 Hardening 4 — matriz adversarial obrigatória", () => {
  it("rejeita due_at diferente do pedido original", async () => {
    const harness = setup("Adie a tarefa X para amanhã às 9.");
    const denied = await harness.registry.execute(
      harness.context,
      call("update_task", { task_id: TASK_A, due_at: "2026-08-10T16:00:00.000Z" }),
    );
    expect(denied.modelOutput).toMatchObject({
      error: { code: "update_temporal_value_scope_mismatch" },
    });
    expect(harness.taskTool.update).not.toHaveBeenCalled();
  });

  it("aceita due_at equivalente calculado no timezone do usuário", async () => {
    const harness = setup("Adie a tarefa X para amanhã às 9.");
    expect(harness.context.policy.temporalScope.dueAt).toEqual({
      kind: "instant",
      iso: "2026-08-10T12:00:00.000Z",
    });
    const accepted = await harness.registry.execute(
      harness.context,
      call("update_task", { task_id: TASK_A, due_at: "2026-08-10T09:00:00-03:00" }),
    );
    expect(accepted.ok).toBe(true);
  });

  it("rejeita remind_at diferente ao alterar lembrete", async () => {
    const harness = setup("Mude o lembrete da tarefa X para amanhã às 9.");
    const denied = await harness.registry.execute(
      harness.context,
      call("update_task", { task_id: TASK_A, remind_at: "2026-08-10T13:00:00.000Z" }),
    );
    expect(denied.modelOutput).toMatchObject({
      error: { code: "update_temporal_value_scope_mismatch" },
    });
    expect(harness.taskTool.update).not.toHaveBeenCalled();
  });

  it("rejeita create_task com horário diferente", async () => {
    const harness = setup("Crie Comprar pão amanhã às 9.");
    expect(harness.context.policy.createTaskScope?.requestedTitles).toEqual(["comprar pao"]);
    const denied = await harness.registry.execute(
      harness.context,
      call("create_task", { title: "Comprar pão", due_at: "2026-08-10T13:00:00.000Z" }),
    );
    expect(denied.modelOutput).toMatchObject({
      error: { code: "create_temporal_value_scope_mismatch" },
    });
    expect(harness.taskTool.create).not.toHaveBeenCalled();
  });

  it("aceita create_task somente com o due_at solicitado", async () => {
    const harness = setup("Crie Comprar pão amanhã às 9.");
    const accepted = await harness.registry.execute(
      harness.context,
      call("create_task", { title: "Comprar pão", due_at: "2026-08-10T12:00:00.000Z" }),
    );
    expect(accepted.ok).toBe(true);
    expect(harness.taskTool.create).toHaveBeenCalledWith("authenticated-user", {
      title: "Comprar pão",
      due_at: "2026-08-10T12:00:00.000Z",
    });
  });

  it("interpreta data explícita no timezone antes de converter para UTC", async () => {
    const harness = setup("Crie uma tarefa Reunião em 15/08/2026 às 14.");
    expect(harness.context.policy.createTaskScope?.requestedTitles).toEqual(["reuniao"]);
    expect(harness.context.policy.temporalScope.dueAt).toEqual({
      kind: "instant",
      iso: "2026-08-15T17:00:00.000Z",
    });
    const accepted = await harness.registry.execute(
      harness.context,
      call("create_task", { title: "Reunião", due_at: "2026-08-15T17:00:00.000Z" }),
    );
    expect(accepted.ok).toBe(true);
  });

  it("vincula lembrete criado ao remind_at solicitado", async () => {
    const harness = setup("Me lembre de comprar pão amanhã às 9.");
    const accepted = await harness.registry.execute(
      harness.context,
      call("create_task", {
        title: "Comprar pão",
        remind_at: "2026-08-10T09:00:00-03:00",
      }),
    );
    expect(accepted.ok).toBe(true);
    expect(harness.context.policy.temporalScope.remindAt).toEqual({
      kind: "instant",
      iso: "2026-08-10T12:00:00.000Z",
    });
  });

  it("remove amanhã do título e não inventa horário", async () => {
    const harness = setup("Crie uma tarefa Comprar pão amanhã.");
    expect(harness.context.policy.createTaskScope?.requestedTitles).toEqual(["comprar pao"]);
    expect(harness.context.policy.temporalScope.dueAt).toEqual({
      kind: "date_only",
      localDate: "2026-08-10",
    });
    const denied = await harness.registry.execute(
      harness.context,
      call("create_task", { title: "Comprar pão" }),
    );
    expect(denied.modelOutput).toMatchObject({
      error: { code: "create_temporal_time_required" },
    });
    expect(harness.taskTool.create).not.toHaveBeenCalled();
  });

  it("impede que A seja consumida duas vezes no mesmo lote", async () => {
    const harness = setup("Conclua Comprar pão e Pagar conta.");
    expect(harness.context.policy.maxMutations).toBe(2);
    const first = await harness.registry.execute(
      harness.context,
      call("set_task_completed", { task_id: TASK_A, completed: true }, "first"),
    );
    const duplicate = await harness.registry.execute(
      harness.context,
      call("set_task_completed", { task_id: TASK_A, completed: true }, "duplicate"),
    );
    expect(first.ok).toBe(true);
    expect(duplicate.modelOutput).toMatchObject({ error: { code: "task_target_consumed" } });
    expect(harness.taskTool.setCompleted).toHaveBeenCalledTimes(1);
  });

  it("bloqueia dois targets distintos que resolvem para a mesma Task", async () => {
    const harness = setup("Conclua Comprar pão e Pagar conta.");
    vi.mocked(harness.taskResolver.resolve).mockImplementationOnce(
      async (_userId, targets: ReadonlyArray<ReadonlyArray<string>>) => ({
        truncated: false,
        targets: targets.map((target) => ({
          key: target.join("\u0000"),
          candidates: [{ id: TASK_A, title: "Task sobreposta", completed: false }],
        })),
      }),
    );
    const denied = await harness.registry.execute(
      harness.context,
      call("set_task_completed", { task_id: TASK_A, completed: true }),
    );
    expect(denied.modelOutput).toMatchObject({ error: { code: "task_target_overlap" } });
    expect(harness.taskTool.setCompleted).not.toHaveBeenCalled();
  });

  it("consome A e B uma vez cada em lote correto", async () => {
    const harness = setup("Conclua Comprar pão e Pagar conta.");
    const first = await harness.registry.execute(
      harness.context,
      call("set_task_completed", { task_id: TASK_A, completed: true }, "first"),
    );
    const second = await harness.registry.execute(
      harness.context,
      call("set_task_completed", { task_id: TASK_B, completed: true }, "second"),
    );
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(harness.taskTool.setCompleted).toHaveBeenCalledTimes(2);
  });

  it("força resposta de sucesso parcial quando A funciona e B falha", async () => {
    const harness = setup("Conclua duas tarefas: Comprar pão e Pagar conta.", TASK_B);
    const complete = vi
      .fn()
      .mockResolvedValueOnce({
        content: null,
        toolCalls: [
          call("set_task_completed", { task_id: TASK_A, completed: true }, "first"),
          call("set_task_completed", { task_id: TASK_B, completed: true }, "second"),
        ],
        finishReason: "tool_calls",
      })
      .mockResolvedValueOnce({ content: "Concluí as duas.", toolCalls: [], finishReason: "stop" });
    const orchestrator = new ChatOrchestrator(
      { complete } as unknown as LLMProvider,
      harness.registry,
    );
    const output = await orchestrator.run({
      userId: "authenticated-user",
      userName: "não usado",
      userMessage: "Conclua duas tarefas: Comprar pão e Pagar conta.",
      timezone: TIMEZONE,
      now: NOW,
      history: [],
    });
    expect(output.reply).toContain("parcialmente concluída");
    expect(output.reply).not.toBe("Concluí as duas.");
  });

  it("adicionar lembrete em Task existente usa somente update_task", async () => {
    const harness = setup("Adicione um lembrete à tarefa Comprar pão para amanhã às 9.");
    expect([...harness.context.policy.allowedTools]).toContain("update_task");
    expect(harness.context.policy.allowedTools.has("create_task")).toBe(false);
    expect(harness.context.policy.allowedTools.has("delete_task")).toBe(false);
    const accepted = await harness.registry.execute(
      harness.context,
      call("update_task", { task_id: TASK_A, remind_at: "2026-08-10T12:00:00.000Z" }),
    );
    expect(accepted.ok).toBe(true);
    expect(harness.taskTool.update).toHaveBeenCalledOnce();
    expect(harness.taskTool.create).not.toHaveBeenCalled();
    expect(harness.taskTool.delete).not.toHaveBeenCalled();
  });

  it("remover lembrete continua usando update_task e preserva a Task", async () => {
    const harness = setup("Remova o lembrete da tarefa Comprar pão.");
    const accepted = await harness.registry.execute(
      harness.context,
      call("update_task", { task_id: TASK_A, remind_at: null }),
    );
    expect(accepted.ok).toBe(true);
    expect(harness.taskTool.update).toHaveBeenCalledOnce();
    expect(harness.taskTool.delete).not.toHaveBeenCalled();
  });

  it("remove palavras de intenção do target do Vault", async () => {
    const harness = setup("Quero trocar minha senha do GitHub.");
    expect(harness.context.policy.vaultQueryTerms).toEqual(["github"]);
    const accepted = await harness.registry.execute(
      harness.context,
      call("search_vault", { query: "GitHub" }),
    );
    expect(accepted.ok).toBe(true);
    expect(harness.vaultTool.search).toHaveBeenCalledWith("authenticated-user", {
      query: "GitHub",
    });
  });

  it("vincula categoria simples ao valor solicitado", async () => {
    const harness = setup("Mude a categoria da tarefa X para trabalho.");
    const denied = await harness.registry.execute(
      harness.context,
      call("update_task", { task_id: TASK_A, category: "pessoal" }),
    );
    expect(denied.modelOutput).toMatchObject({ error: { code: "task_value_scope_mismatch" } });
    expect(harness.taskTool.update).not.toHaveBeenCalled();
  });
});
