import { z } from "zod";

import { AppError, NotFoundError } from "../core/exceptions";
import { logger } from "../core/logger";
import type { LLMToolCall, LLMToolDefinition } from "../providers/llm.provider";
import type { TaskTool } from "../tools/task.tool";
import type { VaultSearchTool } from "../tools/vault-search.tool";
import type { TaskResolver } from "./task-resolver";
import { sameTemporalInstant, type TemporalValueBinding } from "./temporal-binding";
import type { ToolExecutionContext, ToolExecutionResult } from "./tool-types";
import {
  isKnownToolName,
  isWriteTool,
  normalizePolicyText,
  type CreateTaskField,
  type TaskMutationField,
  type ToolName,
} from "./turn-policy";

const isoDateTime = z.string().datetime({ offset: true });
const taskId = z.string().uuid();

const createTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2000).nullable().optional(),
    category: z.string().trim().max(60).nullable().optional(),
    priority: z.enum(["baixa", "media", "alta"]).optional(),
    due_at: isoDateTime.nullable().optional(),
    remind_at: isoDateTime.nullable().optional(),
  })
  .strict();

const listTasksSchema = z
  .object({
    status: z.enum(["open", "completed", "all"]).default("open"),
    has_reminder: z.boolean().nullable().optional(),
    query: z.string().trim().min(1).max(120).optional(),
    due_from: isoDateTime.optional(),
    due_to: isoDateTime.optional(),
    limit: z.number().int().min(1).max(50).default(50),
  })
  .strict()
  .refine(
    (value) =>
      !value.due_from ||
      !value.due_to ||
      new Date(value.due_from).getTime() <= new Date(value.due_to).getTime(),
    {
      message: "due_from deve ser anterior ou igual a due_to.",
    },
  );

const updateTaskSchema = z
  .object({
    task_id: taskId,
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    category: z.string().trim().max(60).nullable().optional(),
    priority: z.enum(["baixa", "media", "alta"]).optional(),
    due_at: isoDateTime.nullable().optional(),
    remind_at: isoDateTime.nullable().optional(),
    reminder_enabled: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).some((key) => key !== "task_id"), {
    message: "Informe ao menos um campo para atualizar.",
  });

const setCompletedSchema = z.object({ task_id: taskId, completed: z.boolean() }).strict();
const deleteTaskSchema = z.object({ task_id: taskId }).strict();
const searchVaultSchema = z.object({ query: z.string().trim().min(1).max(120) }).strict();
type CreateTaskArguments = z.output<typeof createTaskSchema>;
type ListTasksArguments = z.output<typeof listTasksSchema>;
type UpdateTaskArguments = z.output<typeof updateTaskSchema>;
type SetCompletedArguments = z.output<typeof setCompletedSchema>;
type SearchVaultArguments = z.output<typeof searchVaultSchema>;

const objectSchema = (
  properties: Record<string, unknown>,
  required: string[] = [],
): Record<string, unknown> => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

interface RegisteredTool {
  name: ToolName;
  kind: "read" | "write";
  definition: LLMToolDefinition;
  execute(context: ToolExecutionContext, args: unknown): Promise<ToolExecutionResult>;
}

function invalidResult(code: string, message: string): ToolExecutionResult {
  return {
    ok: false,
    modelOutput: { ok: false, error: { code, message } },
    persistedOutput: null,
    fallbackReply: message,
    mutatesTasks: false,
  };
}

function resultReason(result: ToolExecutionResult): string {
  if (result.ok) return "tool_succeeded";
  if (
    !result.modelOutput ||
    typeof result.modelOutput !== "object" ||
    Array.isArray(result.modelOutput)
  ) {
    return "tool_failed";
  }
  const error = result.modelOutput["error"];
  if (!error || typeof error !== "object" || Array.isArray(error)) return "tool_failed";
  const code = error["code"];
  return typeof code === "string" ? code : "tool_failed";
}

function auditScopeFields(reason: string): Record<string, string> {
  const denied = (pattern: RegExp) => (pattern.test(reason) ? "denied" : "not_evaluated");
  return {
    resource_binding: denied(
      /(?:task_(?:target|resolution|ambiguous|not_found)|vault_target|create_title)/,
    ),
    field_scope: denied(/field_scope/),
    value_scope: denied(/value_scope|create_title/),
    query_scope: denied(/query_scope|query_status|vault_query/),
  };
}

function defineTool<TSchema extends z.ZodTypeAny>(input: {
  name: ToolName;
  kind: "read" | "write";
  description: string;
  parameters: Record<string, unknown>;
  schema: TSchema;
  execute(context: ToolExecutionContext, args: z.output<TSchema>): Promise<ToolExecutionResult>;
}): RegisteredTool {
  return {
    name: input.name,
    kind: input.kind,
    definition: {
      type: "function",
      function: {
        name: input.name,
        description: input.description,
        parameters: input.parameters,
      },
    },
    async execute(context, args) {
      const parsed = input.schema.safeParse(args);
      if (!parsed.success) {
        return invalidResult("invalid_arguments", "Os argumentos da ação são inválidos.");
      }
      return input.execute(context, parsed.data);
    },
  };
}

async function requireBackendResolvedTask(
  context: ToolExecutionContext,
  id: string,
  resolver: TaskResolver,
): Promise<ToolExecutionResult | null> {
  if (context.policy.taskTargetTerms.length === 0) {
    return invalidResult(
      "task_target_required",
      "Identifique explicitamente qual Task deve ser alterada.",
    );
  }

  if (!context.backendTaskResolutionPromise) {
    context.backendTaskResolutionPromise = resolver.resolve(
      context.userId,
      context.policy.taskTargetTerms,
      context.policy.taskResolutionStatus,
    );
  }
  const resolution = await context.backendTaskResolutionPromise;
  context.backendTaskResolution = resolution;

  if (resolution.truncated) {
    return invalidResult(
      "task_resolution_truncated",
      "A busca de candidatos ficou incompleta. Refine qual Task deve ser alterada.",
    );
  }

  if (resolution.targets.some((target) => target.candidates.length > 1)) {
    return invalidResult(
      "task_ambiguous",
      "Encontrei mais de uma tarefa compatível com o pedido. Qual delas você quer alterar?",
    );
  }

  if (resolution.targets.some((target) => target.candidates.length === 0)) {
    return invalidResult("task_not_found", "Não encontrei uma Task compatível com esse alvo.");
  }

  const uniquelyResolved = resolution.targets.map((target) => ({
    key: target.key,
    taskId: target.candidates[0]!.id,
  }));
  if (new Set(uniquelyResolved.map((target) => target.taskId)).size !== uniquelyResolved.length) {
    return invalidResult(
      "task_target_overlap",
      "Dois alvos do pedido apontam para a mesma Task. Refine os itens do lote.",
    );
  }

  const binding = uniquelyResolved.find((target) => target.taskId === id);
  if (!binding) {
    return invalidResult(
      "task_target_mismatch",
      "A tarefa escolhida não corresponde ao alvo solicitado.",
    );
  }
  if (
    context.consumedTaskTargetKeys.has(binding.key) ||
    context.consumedTaskIds.has(binding.taskId)
  ) {
    return invalidResult(
      "task_target_consumed",
      "Essa Task já foi consumida por outra mutação neste lote.",
    );
  }
  context.consumedTaskTargetKeys.add(binding.key);
  context.consumedTaskIds.add(binding.taskId);
  return null;
}

function suppliedFields<T extends object>(args: T, ignored: ReadonlySet<string>): string[] {
  return Object.keys(args).filter((key) => !ignored.has(key));
}

function tokens(value: string): string[] {
  return normalizePolicyText(value).split(/\s+/).filter(Boolean);
}

function validateCreateScope(
  context: ToolExecutionContext,
  args: CreateTaskArguments,
): ToolExecutionResult | null {
  const scope = context.policy.createTaskScope;
  if (!scope || !scope.batchResolvable || scope.requestedTitles.length === 0) {
    return invalidResult(
      "create_scope_unresolved",
      "Não consegui identificar com segurança cada Task a criar. Detalhe os títulos.",
    );
  }

  const fields = suppliedFields(args, new Set()).filter(
    (field) => args[field as keyof typeof args] !== undefined,
  );
  const outsideScope = fields.find((field) => !scope.allowedFields.has(field as CreateTaskField));
  if (outsideScope) {
    return invalidResult(
      "create_field_scope_mismatch",
      "A criação incluiu um campo que não foi solicitado.",
    );
  }

  const title = normalizePolicyText(args.title);
  if (!scope.requestedTitles.includes(title) || context.createdTaskTitles.has(title)) {
    return invalidResult(
      "create_title_mismatch",
      "O título da Task não corresponde a um item solicitado.",
    );
  }

  const expectedPriority = context.policy.taskMutationScope.expectedPriority;
  if (expectedPriority && args.priority !== expectedPriority) {
    return invalidResult(
      "create_value_scope_mismatch",
      "A prioridade informada não corresponde ao pedido original.",
    );
  }
  const expectedCategory = context.policy.taskMutationScope.expectedCategory;
  if (
    Object.hasOwn(args, "category") &&
    (!expectedCategory || normalizePolicyText(args.category ?? "") !== expectedCategory)
  ) {
    return invalidResult(
      "create_value_scope_mismatch",
      "A categoria informada não corresponde ao pedido original.",
    );
  }
  const temporalError = validateTemporalScope(context, args, "create");
  if (temporalError) return temporalError;
  return null;
}

function validateUpdateScope(
  context: ToolExecutionContext,
  args: UpdateTaskArguments,
): ToolExecutionResult | null {
  const scope = context.policy.taskMutationScope;
  const fields = suppliedFields(args, new Set(["task_id"]));
  const outsideScope = fields.find((field) => !scope.allowedFields.has(field as TaskMutationField));
  if (outsideScope || fields.length === 0) {
    return invalidResult(
      "task_field_scope_mismatch",
      "A atualização contém campos que não foram autorizados pelo pedido original.",
    );
  }

  if (scope.expectedPriority && args.priority !== scope.expectedPriority) {
    return invalidResult(
      "task_value_scope_mismatch",
      "A prioridade não corresponde ao valor solicitado.",
    );
  }
  if (scope.expectedTitle && normalizePolicyText(args.title ?? "") !== scope.expectedTitle) {
    return invalidResult(
      "task_value_scope_mismatch",
      "O novo título não corresponde ao valor solicitado.",
    );
  }
  if (
    Object.hasOwn(args, "category") &&
    (!scope.expectedCategory || normalizePolicyText(args.category ?? "") !== scope.expectedCategory)
  ) {
    return invalidResult(
      "task_value_scope_mismatch",
      "A categoria não corresponde ao valor solicitado.",
    );
  }

  switch (scope.expectedReminderAction) {
    case "clear":
      if (
        !Object.hasOwn(args, "remind_at") ||
        args.remind_at !== null ||
        (Object.hasOwn(args, "reminder_enabled") && args.reminder_enabled !== true)
      ) {
        return invalidResult(
          "task_value_scope_mismatch",
          "Remover um lembrete exige limpar remind_at sem apagar a Task.",
        );
      }
      break;
    case "disable":
      if (args.reminder_enabled !== false) {
        return invalidResult(
          "task_value_scope_mismatch",
          "Silenciar um lembrete exige reminder_enabled=false.",
        );
      }
      break;
    case "enable":
      if (args.reminder_enabled !== true) {
        return invalidResult(
          "task_value_scope_mismatch",
          "Reativar um lembrete exige reminder_enabled=true.",
        );
      }
      break;
    case "set":
      if (
        !Object.hasOwn(args, "remind_at") ||
        args.remind_at === null ||
        (Object.hasOwn(args, "reminder_enabled") && args.reminder_enabled !== true)
      ) {
        return invalidResult(
          "task_value_scope_mismatch",
          "Adicionar ou alterar um lembrete exige remind_at e não pode desativá-lo.",
        );
      }
      break;
    case null:
      break;
  }
  const temporalError = validateTemporalScope(context, args, "update");
  if (temporalError) return temporalError;
  return null;
}

function validateTemporalField(
  args: { due_at?: string | null | undefined; remind_at?: string | null | undefined },
  field: "due_at" | "remind_at",
  binding: TemporalValueBinding,
  operation: "create" | "update",
): ToolExecutionResult | null {
  if (binding.kind === "none") return null;
  if (binding.kind === "date_only") {
    return invalidResult(
      `${operation}_temporal_time_required`,
      `A data ${binding.localDate} não possui horário explícito. Informe o horário antes de executar.`,
    );
  }
  if (binding.kind === "unresolved") {
    return invalidResult(
      `${operation}_temporal_scope_unresolved`,
      "Não consegui determinar com segurança a data e a hora solicitadas.",
    );
  }
  const actual = args[field];
  if (
    !Object.hasOwn(args, field) ||
    typeof actual !== "string" ||
    !sameTemporalInstant(actual, binding.iso)
  ) {
    return invalidResult(
      `${operation}_temporal_value_scope_mismatch`,
      `O valor de ${field} não corresponde à data e hora solicitadas.`,
    );
  }
  return null;
}

function validateTemporalScope(
  context: ToolExecutionContext,
  args: { due_at?: string | null | undefined; remind_at?: string | null | undefined },
  operation: "create" | "update",
): ToolExecutionResult | null {
  return (
    validateTemporalField(args, "due_at", context.policy.temporalScope.dueAt, operation) ??
    validateTemporalField(args, "remind_at", context.policy.temporalScope.remindAt, operation)
  );
}

function validateCompletedScope(
  context: ToolExecutionContext,
  args: SetCompletedArguments,
): ToolExecutionResult | null {
  const expected = context.policy.taskMutationScope.expectedCompleted;
  if (expected === null || args.completed !== expected) {
    return invalidResult(
      "task_value_scope_mismatch",
      "A direção concluir/reabrir não corresponde ao pedido original.",
    );
  }
  return null;
}

interface LocalDateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function localParts(date: Date, timezone: string): LocalDateTimeParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
  };
}

function zonedDateTimeToUtc(target: LocalDateTimeParts, timezone: string): number {
  const targetAsUtc = Date.UTC(
    target.year,
    target.month - 1,
    target.day,
    target.hour,
    target.minute,
    target.second,
  );
  let instant = targetAsUtc;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actual = localParts(new Date(instant), timezone);
    const actualAsUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
    );
    instant += targetAsUtc - actualAsUtc;
  }
  return instant;
}

function expectedTaskDateRange(context: ToolExecutionContext): { from: number; to: number } | null {
  const scope = context.policy.taskDateScope;
  if (!scope) return null;

  const localNow = localParts(context.now, context.timezone);
  const dateAtUtc = new Date(Date.UTC(localNow.year, localNow.month - 1, localNow.day));
  const offset = scope === "tomorrow" ? 1 : 0;
  dateAtUtc.setUTCDate(dateAtUtc.getUTCDate() + offset);
  const startTarget: LocalDateTimeParts = {
    year: dateAtUtc.getUTCFullYear(),
    month: dateAtUtc.getUTCMonth() + 1,
    day: dateAtUtc.getUTCDate(),
    hour: 0,
    minute: 0,
    second: 0,
  };
  const nextDate = new Date(Date.UTC(startTarget.year, startTarget.month - 1, startTarget.day + 1));
  const endTarget: LocalDateTimeParts = {
    year: nextDate.getUTCFullYear(),
    month: nextDate.getUTCMonth() + 1,
    day: nextDate.getUTCDate(),
    hour: 0,
    minute: 0,
    second: 0,
  };
  const from = zonedDateTimeToUtc(startTarget, context.timezone);
  const nextStart = zonedDateTimeToUtc(endTarget, context.timezone);
  return { from, to: nextStart - 1 };
}

function expectedTaskLocalDate(context: ToolExecutionContext): string | null {
  const scope = context.policy.taskDateScope;
  if (!scope) return null;
  const localNow = localParts(context.now, context.timezone);
  const date = new Date(Date.UTC(localNow.year, localNow.month - 1, localNow.day));
  if (scope === "tomorrow") date.setUTCDate(date.getUTCDate() + 1);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function validateTaskQueryScope(
  context: ToolExecutionContext,
  args: ListTasksArguments,
): ToolExecutionResult | null {
  const readScope = context.policy.taskReadScope;
  if (readScope) {
    if (args.status !== readScope.expectedStatus) {
      return invalidResult(
        "task_query_status_mismatch",
        "O status da consulta não corresponde ao pedido original.",
      );
    }
    if (
      readScope.expectedHasReminder === null
        ? args.has_reminder !== undefined && args.has_reminder !== null
        : args.has_reminder !== readScope.expectedHasReminder
    ) {
      return invalidResult(
        "task_query_scope_mismatch",
        "O filtro de lembrete não corresponde ao pedido original.",
      );
    }
    if (args.query || args.limit !== 50) {
      return invalidResult(
        "task_query_scope_mismatch",
        "Uma listagem geral não pode ser reduzida por query ou limit arbitrários.",
      );
    }
    if (readScope.general && (args.due_from || args.due_to)) {
      return invalidResult(
        "task_query_scope_mismatch",
        "A listagem geral não autorizou um recorte temporal.",
      );
    }
  }

  const expectedRange = expectedTaskDateRange(context);
  if (expectedRange) {
    const actualFrom = args.due_from ? Date.parse(args.due_from) : Number.NaN;
    const actualTo = args.due_to ? Date.parse(args.due_to) : Number.NaN;
    const toleranceMs = 60_000;
    const endDistance = Math.min(
      Math.abs(actualTo - expectedRange.to),
      Math.abs(actualTo - (expectedRange.to + 1)),
    );
    if (
      !Number.isFinite(actualFrom) ||
      !Number.isFinite(actualTo) ||
      Math.abs(actualFrom - expectedRange.from) > toleranceMs ||
      endDistance > toleranceMs
    ) {
      return invalidResult(
        "task_query_scope_mismatch",
        "A consulta de tarefas não cobre o período solicitado.",
      );
    }
  }

  if (args.query && context.policy.taskTargetTerms.length > 0) {
    const queryTerms = new Set(tokens(args.query));
    const overlapsRequestedTarget = context.policy.taskTargetTerms.some((target) =>
      target.some((term) => queryTerms.has(term)),
    );
    if (!overlapsRequestedTarget) {
      return invalidResult(
        "task_query_scope_mismatch",
        "A busca de tarefas não corresponde ao alvo solicitado.",
      );
    }
  }
  return null;
}

function validateVaultQueryScope(
  context: ToolExecutionContext,
  args: SearchVaultArguments,
): ToolExecutionResult | null {
  if (context.policy.vaultTargetMissing || context.policy.vaultQueryTerms.length === 0) {
    return invalidResult(
      "vault_target_required",
      "Qual serviço ou entrada do Cofre você quer consultar?",
    );
  }
  const queryTerms = new Set(tokens(args.query));
  const matchesRequestedScope = context.policy.vaultQueryTerms.every((term) =>
    queryTerms.has(term),
  );
  return matchesRequestedScope
    ? null
    : invalidResult(
        "vault_query_scope_mismatch",
        "A busca no Cofre não corresponde ao serviço solicitado.",
      );
}

export class ToolRegistry {
  private readonly tools: Map<string, RegisteredTool>;

  constructor(taskTool: TaskTool, vaultSearchTool: VaultSearchTool, taskResolver: TaskResolver) {
    const registered: RegisteredTool[] = [
      defineTool({
        name: "create_task",
        kind: "write",
        description:
          "Cria uma Task real do usuário autenticado. Para lembretes, use remind_at com timestamp ISO 8601 completo.",
        parameters: objectSchema(
          {
            title: { type: "string", minLength: 1, maxLength: 200 },
            description: { type: ["string", "null"], maxLength: 2000 },
            category: { type: ["string", "null"], maxLength: 60 },
            priority: { type: "string", enum: ["baixa", "media", "alta"] },
            due_at: { type: ["string", "null"], format: "date-time" },
            remind_at: { type: ["string", "null"], format: "date-time" },
          },
          ["title"],
        ),
        schema: createTaskSchema,
        async execute(context, args) {
          const scopeError = validateCreateScope(context, args);
          if (scopeError) return scopeError;
          const result = await taskTool.create(context.userId, args);
          if (result.ok) context.createdTaskTitles.add(normalizePolicyText(args.title));
          return result;
        },
      }),
      defineTool({
        name: "list_tasks",
        kind: "read",
        description:
          "Lista Tasks reais do usuário. Aceita somente filtros seguros de status, lembrete, título e intervalo de prazo.",
        parameters: objectSchema({
          status: { type: "string", enum: ["open", "completed", "all"], default: "open" },
          has_reminder: { type: ["boolean", "null"] },
          query: { type: "string", minLength: 1, maxLength: 120 },
          due_from: { type: "string", format: "date-time" },
          due_to: { type: "string", format: "date-time" },
          limit: { type: "integer", minimum: 1, maximum: 50, default: 50 },
        }),
        schema: listTasksSchema,
        async execute(context, args) {
          const scopeError = validateTaskQueryScope(context, args);
          if (scopeError) return scopeError;
          const result = await taskTool.list(context.userId, {
            ...args,
            legacy_due_date: expectedTaskLocalDate(context),
          });
          return result;
        },
      }),
      defineTool({
        name: "update_task",
        kind: "write",
        description:
          "Atualiza campos permitidos de uma Task resolvida pelo backend. Campo ausente não muda; null limpa o campo permitido.",
        parameters: objectSchema(
          {
            task_id: { type: "string", format: "uuid" },
            title: { type: "string", minLength: 1, maxLength: 200 },
            description: { type: ["string", "null"], maxLength: 2000 },
            category: { type: ["string", "null"], maxLength: 60 },
            priority: { type: "string", enum: ["baixa", "media", "alta"] },
            due_at: { type: ["string", "null"], format: "date-time" },
            remind_at: { type: ["string", "null"], format: "date-time" },
            reminder_enabled: { type: "boolean" },
          },
          ["task_id"],
        ),
        schema: updateTaskSchema,
        async execute(context, args) {
          const scopeError = validateUpdateScope(context, args);
          if (scopeError) return scopeError;
          const resolutionError = await requireBackendResolvedTask(
            context,
            args.task_id,
            taskResolver,
          );
          return resolutionError ?? taskTool.update(context.userId, args);
        },
      }),
      defineTool({
        name: "set_task_completed",
        kind: "write",
        description: "Conclui ou reabre uma Task real resolvida pelo backend.",
        parameters: objectSchema(
          {
            task_id: { type: "string", format: "uuid" },
            completed: { type: "boolean" },
          },
          ["task_id", "completed"],
        ),
        schema: setCompletedSchema,
        async execute(context, args) {
          const scopeError = validateCompletedScope(context, args);
          if (scopeError) return scopeError;
          const resolutionError = await requireBackendResolvedTask(
            context,
            args.task_id,
            taskResolver,
          );
          return resolutionError ?? taskTool.setCompleted(context.userId, args);
        },
      }),
      defineTool({
        name: "delete_task",
        kind: "write",
        description:
          "Exclui uma Task real somente após pedido afirmativo e resolução inequívoca pelo backend.",
        parameters: objectSchema({ task_id: { type: "string", format: "uuid" } }, ["task_id"]),
        schema: deleteTaskSchema,
        async execute(context, args) {
          if (!context.policy.destructiveAllowed) {
            return invalidResult(
              "delete_not_authorized",
              "A exclusão exige um pedido afirmativo e explícito para apagar a Task inteira.",
            );
          }
          const resolutionError = await requireBackendResolvedTask(
            context,
            args.task_id,
            taskResolver,
          );
          return resolutionError ?? taskTool.delete(context.userId, args);
        },
      }),
      defineTool({
        name: "search_vault",
        kind: "read",
        description:
          "Busca apenas metadados de entradas do Cofre do usuário autenticado. Não retorna senhas nem ciphertext.",
        parameters: objectSchema({ query: { type: "string", minLength: 1, maxLength: 120 } }, [
          "query",
        ]),
        schema: searchVaultSchema,
        execute(context, args) {
          const scopeError = validateVaultQueryScope(context, args);
          return scopeError
            ? Promise.resolve(scopeError)
            : vaultSearchTool.search(context.userId, args);
        },
      }),
    ];
    this.tools = new Map(registered.map((tool) => [tool.name, tool]));
  }

  definitions(allowedTools?: ReadonlySet<ToolName>): LLMToolDefinition[] {
    return [...this.tools.values()]
      .filter((tool) => !allowedTools || allowedTools.has(tool.name))
      .map((tool) => tool.definition);
  }

  async execute(context: ToolExecutionContext, call: LLMToolCall): Promise<ToolExecutionResult> {
    const tool = this.tools.get(call.function.name);
    if (!tool || !isKnownToolName(call.function.name)) {
      logger.warn("Tool desconhecida rejeitada", {
        route: "chat.tool-registry",
        userId: context.userId,
        tool: call.function.name,
        toolCallId: call.id,
        decision: "denied",
        reason: "unknown_tool",
        ...auditScopeFields("unknown_tool"),
        outcome: "failure",
      });
      return invalidResult("unknown_tool", "A ação solicitada não está disponível.");
    }

    if (!context.policy.allowedTools.has(tool.name)) {
      logger.warn("Tool não autorizada pela política do turno", {
        route: "chat.tool-registry",
        userId: context.userId,
        tool: tool.name,
        toolCallId: call.id,
        decision: "denied",
        reason: "tool_not_authorized",
        ...auditScopeFields("tool_not_authorized"),
        outcome: "failure",
      });
      return invalidResult("tool_not_authorized", "A mensagem original não autorizou essa ação.");
    }

    if (tool.kind === "write") {
      if (context.mutationAttempts >= context.policy.maxMutations) {
        logger.warn("Budget de mutações excedido", {
          route: "chat.tool-registry",
          userId: context.userId,
          tool: tool.name,
          toolCallId: call.id,
          decision: "denied",
          reason: "mutation_budget_exceeded",
          ...auditScopeFields("mutation_budget_exceeded"),
          outcome: "failure",
        });
        return invalidResult(
          "mutation_budget_exceeded",
          "O limite seguro de alterações para esta mensagem foi atingido.",
        );
      }
      context.mutationAttempts += 1;
    } else {
      if (context.readAttempts >= context.policy.maxReads) {
        logger.warn("Budget de leituras excedido", {
          route: "chat.tool-registry",
          userId: context.userId,
          tool: tool.name,
          toolCallId: call.id,
          decision: "denied",
          reason: "read_budget_exceeded",
          ...auditScopeFields("read_budget_exceeded"),
          outcome: "failure",
        });
        return invalidResult(
          "read_budget_exceeded",
          "O limite seguro de consultas para esta mensagem foi atingido.",
        );
      }
      context.readAttempts += 1;
    }

    let args: unknown;
    try {
      args = JSON.parse(call.function.arguments) as unknown;
    } catch {
      logger.warn("JSON inválido em argumentos de Tool", {
        route: "chat.tool-registry",
        userId: context.userId,
        tool: tool.name,
        toolCallId: call.id,
        decision: "authorized",
        reason: "invalid_json",
        ...auditScopeFields("invalid_json"),
        outcome: "failure",
      });
      return invalidResult("invalid_json", "Os argumentos da ação não são JSON válido.");
    }

    try {
      const result = await tool.execute(context, args);
      const reason = resultReason(result);
      logger.info("Tool processada", {
        route: "chat.tool-registry",
        userId: context.userId,
        tool: tool.name,
        toolCallId: call.id,
        decision: "authorized",
        reason,
        ...auditScopeFields(reason),
        outcome: result.ok ? "success" : "failure",
      });
      return result;
    } catch (error) {
      if (error instanceof NotFoundError) {
        logger.warn("Tool processada", {
          route: "chat.tool-registry",
          userId: context.userId,
          tool: tool.name,
          toolCallId: call.id,
          decision: "authorized",
          reason: "not_found",
          ...auditScopeFields("not_found"),
          outcome: "failure",
        });
        return invalidResult("not_found", "A tarefa não foi encontrada.");
      }
      if (error instanceof AppError) {
        logger.warn("Tool processada", {
          route: "chat.tool-registry",
          userId: context.userId,
          tool: tool.name,
          toolCallId: call.id,
          decision: "authorized",
          reason: error.code.toLowerCase(),
          ...auditScopeFields(error.code.toLowerCase()),
          outcome: "failure",
        });
        return invalidResult(error.code.toLowerCase(), error.message);
      }
      // Exceções de drivers podem conter valores da operação em message/details.
      // O log de auditoria não precisa desse payload e registra apenas campos seguros.
      logger.warn("Falha ao executar Tool", {
        route: "chat.tool-registry",
        userId: context.userId,
        tool: tool.name,
        toolCallId: call.id,
        decision: "authorized",
        reason: "tool_execution_failed",
        ...auditScopeFields("tool_execution_failed"),
        outcome: "failure",
      });
      return invalidResult("tool_execution_failed", "Não foi possível concluir a operação.");
    }
  }
}
