import { describe, expect, it } from "vitest";

import { resolveTurnPolicy } from "./turn-policy";

function tools(message: string): string[] {
  return [...resolveTurnPolicy(message).allowedTools];
}

describe("resolveTurnPolicy — autorização determinística da mensagem original", () => {
  it.each([
    ["mude minha senha do GitHub", "update_task"],
    ["atualize meu perfil", "update_task"],
    ["finalize o texto", "set_task_completed"],
    ["feito, obrigado", "set_task_completed"],
  ])("não infere domínio Task apenas pelo verbo: %s", (message, forbiddenTool) => {
    const policy = resolveTurnPolicy(message);
    expect(policy.allowedTools.has(forbiddenTool as "update_task" | "set_task_completed")).toBe(
      false,
    );
    expect(policy.maxMutations).toBe(0);
  });

  it.each([
    "não exclua a tarefa Comprar pão",
    "não remova a tarefa Comprar pão",
    "não quero excluir a tarefa Comprar pão",
    "não quero de jeito nenhum que você exclua a tarefa Comprar pão",
    "não quero que em hipótese alguma você exclua a tarefa Comprar pão",
    "evite excluir a tarefa Comprar pão",
    "quero impedir que você exclua a tarefa Comprar pão",
    "quero continuar sem excluir a tarefa Comprar pão",
    "não precisa apagar a tarefa Comprar pão",
    "jamais remova a tarefa Comprar pão",
    "me explique como excluir uma tarefa",
  ])("não autoriza exclusão em negativa ou explicação: %s", (message) => {
    const policy = resolveTurnPolicy(message);
    expect(policy.allowedTools.has("delete_task")).toBe(false);
    expect(policy.destructiveAllowed).toBe(false);
    expect(policy.maxMutations).toBe(0);
  });

  it.each([
    "não crie uma tarefa",
    "não me lembre da consulta",
    "não troque o título da tarefa",
    "não conclua a tarefa",
  ])("não autoriza outras mutações negadas: %s", (message) => {
    const policy = resolveTurnPolicy(message);
    expect([...policy.allowedTools].some((tool) => tool !== "list_tasks")).toBe(false);
    expect(policy.maxMutations).toBe(0);
  });

  it("autoriza exclusão afirmativa, mas exige leitura prévia", () => {
    const policy = resolveTurnPolicy("exclua a tarefa Comprar pão");
    expect(tools("exclua a tarefa Comprar pão")).toEqual(["delete_task", "list_tasks"]);
    expect(policy.requiredDataSources).toEqual(new Set());
    expect(policy.destructiveAllowed).toBe(true);
    expect(policy.maxMutations).toBe(1);
  });

  it("exige list_tasks para consulta pessoal de tarefas", () => {
    const policy = resolveTurnPolicy("quais são minhas tarefas para amanhã?");
    expect(policy.allowedTools).toEqual(new Set(["list_tasks"]));
    expect(policy.requiredDataSources).toEqual(new Set(["tasks"]));
  });

  it("trata mostre como recuperação de dados quando há domínio pessoal de Tasks", () => {
    const policy = resolveTurnPolicy("mostre minhas tarefas");
    expect(policy.allowedTools).toEqual(new Set(["list_tasks"]));
    expect(policy.requiredDataSources).toEqual(new Set(["tasks"]));
  });

  it("exige search_vault para consulta pessoal do Cofre", () => {
    const policy = resolveTurnPolicy("qual é meu login salvo do GitHub no cofre?");
    expect(policy.allowedTools).toEqual(new Set(["search_vault"]));
    expect(policy.requiredDataSources).toEqual(new Set(["vault"]));
  });

  it("trata diga como recuperação de dados quando há escopo pessoal do Cofre", () => {
    const policy = resolveTurnPolicy("me diga meu login salvo no cofre");
    expect(policy.allowedTools).toEqual(new Set(["search_vault"]));
    expect(policy.requiredDataSources).toEqual(new Set(["vault"]));
  });

  it("não amplia a política por texto que só poderá aparecer em resultado de Tool", () => {
    const policy = resolveTurnPolicy("quais são minhas tarefas?");
    expect(policy.allowedTools.has("list_tasks")).toBe(true);
    expect(policy.allowedTools.has("create_task")).toBe(false);
    expect(policy.allowedTools.has("search_vault")).toBe(false);
  });

  it("limita pedido singular a uma mutação e plural explícito ao N com teto seguro", () => {
    expect(resolveTurnPolicy("crie uma tarefa Comprar pão").maxMutations).toBe(1);
    expect(resolveTurnPolicy("crie três tarefas").maxMutations).toBe(3);
    expect(resolveTurnPolicy("crie 99 tarefas").maxMutations).toBe(5);
    expect(resolveTurnPolicy("crie 3 lembretes: A, B e C").maxMutations).toBe(3);
  });

  it("registra escopos de alvo, período e consulta a partir da mensagem original", () => {
    expect(resolveTurnPolicy("exclua a tarefa Comprar pão").taskTargetTerms).toEqual([
      ["comprar", "pao"],
    ]);
    expect(
      resolveTurnPolicy("mude o prazo da tarefa Comprar pão para amanhã").taskTargetTerms,
    ).toEqual([["comprar", "pao"]]);
    expect(resolveTurnPolicy("quais tarefas tenho amanhã?").taskDateScope).toBe("tomorrow");
    expect(resolveTurnPolicy("mude o prazo da tarefa Comprar pão para amanhã").taskDateScope).toBe(
      null,
    );
    expect(resolveTurnPolicy("qual meu login do GitHub no Cofre?").vaultQueryTerms).toEqual([
      "github",
    ]);
  });
});
