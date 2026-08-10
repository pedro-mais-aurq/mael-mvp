import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("arquitetura P3 — Tool Calling canônico", () => {
  it("remove o protocolo JSON manual do ChatService", () => {
    const service = source("../services/chat.service.ts");
    expect(service).toContain("this.orchestrator.run");
    expect(service).not.toContain("JSON.parse");
    expect(service).not.toContain("assistant_reply");
    expect(service).not.toContain("create_reminder");
    expect(service).not.toMatch(/switch\s*\(/);
  });

  it("centraliza o HTTP do LLM exclusivamente no provider OpenRouter", () => {
    const provider = source("../providers/llm.provider.ts");
    const orchestrator = source("./orchestrator.ts");
    expect(provider).toContain("https://openrouter.ai/api/v1/chat/completions");
    expect(provider).toContain("openai/gpt-oss-20b:free");
    expect(provider).toContain("fetch(GATEWAY_URL");
    expect(orchestrator).not.toContain("fetch(");
    expect(orchestrator).not.toContain("openrouter.ai");
  });

  it("mantém rate limit, limite da mensagem, histórico 12 e timezone no endpoint", () => {
    const functions = source("../chat.functions.ts");
    const service = source("../services/chat.service.ts");
    expect(functions).toContain("enforceRateLimit");
    expect(functions).toContain("max(4000)");
    expect(functions).toContain("resolveTimezone");
    expect(functions).toContain('select("name, timezone")');
    expect(service).toContain("const HISTORY_LIMIT = 12");
  });

  it("envia timezone do browser e invalida Tasks após qualquer mutação", () => {
    const route = source("../../routes/index.tsx");
    expect(route).toContain("Intl.DateTimeFormat().resolvedOptions().timeZone");
    expect(route).toContain("result.mutates_tasks");
    expect(route).toContain('queryKey: ["tasks"]');
  });

  it("mantém filtros de user_id na defesa em profundidade dos repositórios", () => {
    const tasks = source("../repositories/tasks.repository.ts");
    const vault = source("../repositories/vault.repository.ts");
    expect(tasks.match(/\.eq\("user_id", userId\)/g)?.length).toBeGreaterThanOrEqual(7);
    expect(vault.match(/\.eq\("user_id", userId\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(vault.match(/searchFixedColumns\(userId/g)?.length).toBeGreaterThanOrEqual(3);
    expect(vault).not.toContain(".or(");
  });

  it("compõe resolução canônica de mutações fora dos filtros do LLM", () => {
    const chatServer = source("../chat.server.ts");
    const resolver = source("./task-resolver.ts");
    const repository = source("../repositories/tasks.repository.ts");
    const registry = source("./tool-registry.ts");
    expect(chatServer).toContain("new TaskResolver(taskService)");
    expect(chatServer).toContain(
      "new ToolRegistry(taskTool, vaultSearchTool, taskResolver, githubTool)",
    );
    expect(resolver).toContain("listForMutationResolution(userId, status)");
    expect(repository).toContain("listForResolution");
    expect(registry).not.toContain("registerTaskCandidates");
  });
});
