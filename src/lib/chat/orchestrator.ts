import { logger } from "../core/logger";
import type { JsonValue } from "../mael-types";
import type {
  LLMCompletionResult,
  LLMMessage,
  LLMProvider,
  LLMToolCall,
} from "../providers/llm.provider";
import { buildChatSystemPrompt } from "./prompt";
import type { ToolExecutionContext, ToolExecutionResult } from "./tool-types";
import type { ToolRegistry } from "./tool-registry";
import {
  isWriteTool,
  resolveTurnPolicy,
  type DataSource,
  type ToolAuthorizationPolicy,
} from "./turn-policy";

const MAX_LLM_ROUNDS = 5;
const MAX_TOOL_CALLS = 8;
const EMPTY_REPLY = "Não consegui formular uma resposta agora. Pode tentar novamente?";
const PROVIDER_REPLY = "Não consegui acessar o modelo agora. Pode tentar novamente?";
const INCOMPATIBLE_REPLY = "Não consegui concluir a resposta com segurança. Tente novamente.";

export interface ChatOrchestratorInput {
  userId: string;
  /** Mantido por compatibilidade, mas nunca interpolado no system prompt. */
  userName: string;
  userMessage: string;
  timezone: string;
  now: Date;
  history: Array<{ role: "user" | "assistant"; content: string }>;
}

export interface ChatOrchestratorResult {
  reply: string;
  primaryTool: string | null;
  toolOutput: JsonValue | null;
  executedTools: string[];
  mutatesTasks: boolean;
}

interface ExecutionRecord {
  tool: string;
  result: ToolExecutionResult;
}

function serializeModelOutput(result: ToolExecutionResult): string {
  try {
    return [
      "TOOL_DATA_START",
      JSON.stringify({ untrustedToolData: true, data: result.modelOutput }),
      "TOOL_DATA_END",
    ].join("\n");
  } catch {
    return [
      "TOOL_DATA_START",
      JSON.stringify({
        untrustedToolData: true,
        data: {
          ok: false,
          error: { code: "serialization_failed", message: "Resultado indisponível." },
        },
      }),
      "TOOL_DATA_END",
    ].join("\n");
  }
}

function persistedOutput(records: ExecutionRecord[]): JsonValue | null {
  const safe = records
    .filter((record) => record.result.ok && record.result.persistedOutput !== null)
    .map((record) => ({ tool: record.tool, output: record.result.persistedOutput! }));
  if (safe.length === 0) return null;
  if (safe.length === 1) return safe[0]!.output;
  return { kind: "tool_results", results: safe };
}

function choosePrimaryTool(records: ExecutionRecord[]): string | null {
  const successful = records.filter((record) => record.result.ok);
  return successful.find((record) => isWriteTool(record.tool))?.tool ?? successful[0]?.tool ?? null;
}

function mutationOutcomeFallback(records: ExecutionRecord[]): string | null {
  const writes = records.filter((record) => isWriteTool(record.tool));
  const failed = writes.filter((record) => !record.result.ok);
  if (failed.length === 0) return null;

  const successful = writes.filter((record) => record.result.ok);
  if (successful.length === 0) {
    return failed.at(-1)?.result.fallbackReply ?? "Não consegui concluir a alteração.";
  }

  const successes = successful.map((record) => record.result.fallbackReply).join(" ");
  const failures = failed.map((record) => record.result.fallbackReply).join(" ");
  return `Operação parcialmente concluída. ${successes} Porém: ${failures}`;
}

function fallbackFrom(records: ExecutionRecord[], fallback: string): string {
  const mutationOutcome = mutationOutcomeFallback(records);
  if (mutationOutcome) return mutationOutcome;
  const successfulMutation = [...records]
    .reverse()
    .find((record) => record.result.ok && isWriteTool(record.tool));
  if (successfulMutation) return successfulMutation.result.fallbackReply;
  return records.at(-1)?.result.fallbackReply || fallback;
}

function sourceForTool(tool: string): DataSource | null {
  if (tool === "list_tasks") return "tasks";
  if (tool === "search_vault") return "vault";
  return null;
}

function missingRequiredSources(
  policy: ToolAuthorizationPolicy,
  records: ExecutionRecord[],
): DataSource[] {
  const successfulSources = new Set<DataSource>();
  for (const record of records) {
    if (!record.result.ok) continue;
    const source = sourceForTool(record.tool);
    if (source) successfulSources.add(source);
  }
  return [...policy.requiredDataSources].filter((source) => !successfulSources.has(source));
}

function requiredSourceFallback(
  policy: ToolAuthorizationPolicy,
  missing: DataSource[],
): string | null {
  if (missing.length === 0) return null;
  if (missing.includes("vault") && policy.vaultTargetMissing) {
    return "Qual serviço ou entrada do Cofre você quer consultar?";
  }
  if (missing.includes("tasks") && missing.includes("vault")) {
    return "Não consegui consultar suas tarefas nem o Cofre agora. Tente novamente.";
  }
  if (missing.includes("tasks")) {
    return "Não consegui consultar suas tarefas agora. Tente novamente.";
  }
  return "Não consegui consultar o Cofre agora. Tente novamente.";
}

function isCompletionCompatible(completion: LLMCompletionResult): boolean {
  if (completion.toolCalls.length > 0) return completion.finishReason === "tool_calls";
  return completion.finishReason === "stop";
}

export class ChatOrchestrator {
  constructor(
    private readonly llm: LLMProvider,
    private readonly registry: ToolRegistry,
  ) {}

  async run(input: ChatOrchestratorInput): Promise<ChatOrchestratorResult> {
    const policy = resolveTurnPolicy(input.userMessage, {
      now: input.now,
      timezone: input.timezone,
    });
    logger.info("Política do turno calculada", {
      route: "chat.orchestrator",
      userId: input.userId,
      allowedTools: [...policy.allowedTools],
      requiredDataSources: [...policy.requiredDataSources],
      maxMutations: policy.maxMutations,
      maxReads: policy.maxReads,
    });

    const messages: LLMMessage[] = [
      {
        role: "system",
        content: buildChatSystemPrompt({
          timezone: input.timezone,
          now: input.now,
        }),
      },
      ...input.history,
    ];
    const context: ToolExecutionContext = {
      userId: input.userId,
      userMessage: input.userMessage,
      now: input.now,
      timezone: input.timezone,
      policy,
      backendTaskResolution: null,
      backendTaskResolutionPromise: null,
      createdTaskTitles: new Set(),
      consumedTaskTargetKeys: new Set(),
      consumedTaskIds: new Set(),
      mutationAttempts: 0,
      readAttempts: 0,
    };
    const executedById = new Map<string, ExecutionRecord>();
    const records: ExecutionRecord[] = [];
    let totalToolCalls = 0;

    for (let round = 0; round < MAX_LLM_ROUNDS; round += 1) {
      let completion;
      try {
        completion = await this.llm.complete({
          messages,
          tools: this.registry.definitions(policy.allowedTools),
          temperature: 0.4,
        });
      } catch (error) {
        logger.error("Falha no LLMProvider durante orquestração", error, {
          route: "chat.orchestrator",
          userId: input.userId,
          round,
        });
        return this.finalize(policy, records, fallbackFrom(records, PROVIDER_REPLY));
      }

      if (!completion) {
        return this.finalize(policy, records, fallbackFrom(records, PROVIDER_REPLY));
      }

      if (!isCompletionCompatible(completion)) {
        logger.warn("Resposta do Provider rejeitada por finish_reason incompatível", {
          route: "chat.orchestrator",
          userId: input.userId,
          round,
          finishReason: completion.finishReason,
          hasToolCalls: completion.toolCalls.length > 0,
        });
        return this.finalize(policy, records, fallbackFrom(records, INCOMPATIBLE_REPLY));
      }

      if (completion.toolCalls.length === 0) {
        const reply = completion.content?.trim();
        return this.finalize(policy, records, reply || fallbackFrom(records, EMPTY_REPLY));
      }

      messages.push({
        role: "assistant",
        content: completion.content,
        tool_calls: completion.toolCalls,
      });

      for (const call of completion.toolCalls) {
        totalToolCalls += 1;
        if (totalToolCalls > MAX_TOOL_CALLS) {
          logger.warn("Limite de Tool Calls atingido", {
            route: "chat.orchestrator",
            userId: input.userId,
            limit: MAX_TOOL_CALLS,
          });
          return this.finalize(policy, records, fallbackFrom(records, EMPTY_REPLY));
        }

        const record = await this.executeOnce(call, context, executedById, records);
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: serializeModelOutput(record.result),
        });
      }
    }

    logger.warn("Limite de rodadas do ChatOrchestrator atingido", {
      route: "chat.orchestrator",
      userId: input.userId,
      limit: MAX_LLM_ROUNDS,
    });
    return this.finalize(policy, records, fallbackFrom(records, EMPTY_REPLY));
  }

  private async executeOnce(
    call: LLMToolCall,
    context: ToolExecutionContext,
    executedById: Map<string, ExecutionRecord>,
    records: ExecutionRecord[],
  ): Promise<ExecutionRecord> {
    const previous = executedById.get(call.id);
    if (previous) {
      logger.warn("Tool Call duplicada ignorada", {
        route: "chat.orchestrator",
        userId: context.userId,
        tool: call.function.name,
        toolCallId: call.id,
        decision: "denied",
        reason: "duplicate_tool_call_id",
        outcome: "failure",
      });
      return previous;
    }

    const record = {
      tool: call.function.name,
      result: await this.registry.execute(context, call),
    };
    executedById.set(call.id, record);
    records.push(record);
    return record;
  }

  private finalize(
    policy: ToolAuthorizationPolicy,
    records: ExecutionRecord[],
    candidateReply: string,
  ): ChatOrchestratorResult {
    const sourceFallback = requiredSourceFallback(policy, missingRequiredSources(policy, records));
    const mutationFallback = mutationOutcomeFallback(records);
    return this.result(records, sourceFallback ?? mutationFallback ?? candidateReply);
  }

  private result(records: ExecutionRecord[], reply: string): ChatOrchestratorResult {
    return {
      reply,
      primaryTool: choosePrimaryTool(records),
      toolOutput: persistedOutput(records),
      executedTools: records.filter((record) => record.result.ok).map((record) => record.tool),
      mutatesTasks: records.some((record) => record.result.ok && isWriteTool(record.tool)),
    };
  }
}
