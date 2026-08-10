import type { Priority } from "../mael-types";
import {
  requireTemporalValue,
  resolveTemporalValue,
  type TemporalBindingContext,
  type TemporalValueBinding,
} from "./temporal-binding";

export const TOOL_NAMES = [
  "create_task",
  "list_tasks",
  "update_task",
  "set_task_completed",
  "delete_task",
  "search_vault",
  "github_list_repositories",
  "github_get_repository",
  "github_list_pull_requests",
  "github_list_issues",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];
export type DataSource = "tasks" | "vault" | "github";
export type TaskDateScope = "today" | "tomorrow";
export type TaskResolutionStatus = "open" | "completed" | "all";
export type TaskMutationField =
  "title" | "description" | "category" | "priority" | "due_at" | "remind_at" | "reminder_enabled";
export type CreateTaskField = Exclude<TaskMutationField, "reminder_enabled">;
export type ReminderMutationAction = "set" | "clear" | "enable" | "disable";

export interface TaskMutationScope {
  allowedFields: ReadonlySet<TaskMutationField>;
  expectedCompleted: boolean | null;
  expectedPriority: Priority | null;
  expectedTitle: string | null;
  expectedCategory: string | null;
  expectedReminderAction: ReminderMutationAction | null;
}

export interface TemporalScope {
  dueAt: TemporalValueBinding;
  remindAt: TemporalValueBinding;
}

export interface CreateTaskScope {
  requestedTitles: ReadonlyArray<string>;
  allowedFields: ReadonlySet<CreateTaskField>;
  batchResolvable: boolean;
}

export interface TaskReadScope {
  general: boolean;
  expectedStatus: TaskResolutionStatus;
  expectedHasReminder: boolean | null;
}

export interface GitHubReadScope {
  generalRepositories: boolean;
  account: string | null;
  owner: string | null;
  repo: string | null;
  state: "open" | "closed" | "all";
}

export interface ToolAuthorizationPolicy {
  allowedTools: ReadonlySet<ToolName>;
  requiredDataSources: ReadonlySet<DataSource>;
  maxMutations: number;
  maxReads: number;
  destructiveAllowed: boolean;
  taskTargetTerms: ReadonlyArray<ReadonlyArray<string>>;
  taskResolutionStatus: TaskResolutionStatus;
  taskDateScope: TaskDateScope | null;
  taskMutationScope: TaskMutationScope;
  temporalScope: TemporalScope;
  createTaskScope: CreateTaskScope | null;
  taskReadScope: TaskReadScope | null;
  vaultQueryTerms: ReadonlyArray<string>;
  vaultTargetMissing: boolean;
  githubScope: GitHubReadScope | null;
}

const WRITE_TOOLS = new Set<ToolName>([
  "create_task",
  "update_task",
  "set_task_completed",
  "delete_task",
]);

const EXPLANATION_OR_HYPOTHESIS =
  /\b(?:como|explique|explica|ensine|oriente|tutorial|exemplo|passo a passo|forma de|hipotetic|poderia|seria|posso|o que acontece|o que ocorreria)\b/;
const MUTATION_DENIAL = /\b(?:nao|nunca|jamais|evite|evitar|impeca|impedir|previna|prevenir)\b/;
const DESTRUCTIVE_DENIAL = /\bsem\s+(?:excluir|apagar|deletar|remover)\b/;

const CREATE_ACTION =
  /\b(?:crie|criar|adicione|adicionar|anote|anota|anotar|agende|agendar|cadastre|cadastrar|me lembra|me lembre|me lembrar)\b/;
const UPDATE_ACTION =
  /\b(?:altere|alterar|atualize|atualizar|edite|editar|mude|mudar|renomeie|renomear|troque|trocar|adie|adiar|reprograme|reprogramar)\b/;
const COMPLETE_ACTION =
  /\b(?:conclua|concluir|concluida|concluido|finalize|finalizar|terminei|feito|feita|reabra|reabrir|desmarque)\b/;
const REOPEN_ACTION = /\b(?:reabra|reabrir|desmarque)\b/;
const DELETE_ACTION = /\b(?:exclua|excluir|apague|apagar|delete|deletar|remova|remover)\b/;
const REMINDER_REMOVE_ACTION =
  /\b(?:remova|remover|exclua|excluir|apague|apagar|delete|deletar)\b[^.?!]{0,80}\blembretes?\b|\blembretes?\b[^.?!]{0,80}\b(?:remova|remover|exclua|excluir|apague|apagar)\b/;
const REMINDER_DISABLE_ACTION = /\b(?:silencie|silenciar|desative|desativar)\b/;
const REMINDER_ENABLE_ACTION = /\b(?:reative|reativar|ative|ativar)\b/;

const TASK_DOMAIN_SOURCE =
  "(?:tarefa|tarefas|task|tasks|pendencia|pendencias|afazer|afazeres|compromisso|compromissos|agenda|lembrete|lembretes)";
const TASK_DOMAIN = new RegExp(`\\b${TASK_DOMAIN_SOURCE}\\b`);
const TASK_PERSONAL_QUERY =
  /\b(?:minha|minhas|meu|meus|tenho|diga|dizer|liste|listar|mostre|mostrar|procure|procurar|busque|buscar|encontre|encontrar|quantas|quantos)\b/;
const TASK_PLURAL_QUERY =
  /\bquais\b(?:\s+[a-z0-9]+){0,5}\s+\b(?:tarefas|tasks|pendencias|compromissos|lembretes)\b/;
const SCHEDULE_QUERY = /\bo que (?:eu )?tenho\b(?:\s+[a-z0-9]+){0,4}\s+\b(?:hoje|amanha|semana)\b/;

const VAULT_DOMAIN =
  /\b(?:cofre|senha|senhas|credencial|credenciais|login|logins|acesso salvo|acessos salvos)\b/;
const VAULT_PERSONAL_QUERY =
  /\b(?:qual|quais|minha|minhas|meu|meus|tenho|diga|dizer|salva|salvas|salvo|salvos|procure|procurar|busque|buscar|mostre|mostrar|encontre|encontrar|consulte|consultar)\b/;

const GITHUB_REPOSITORY_DOMAIN = /\b(?:repositorio|repositorios|repo|repos)\b/;
const GITHUB_SPECIFIC_REPOSITORY_DOMAIN = /\b(?:repositorio|repo)\b/;
const GITHUB_PROJECT_DOMAIN =
  /\b(?:projeto|projetos)\b[^.?!]{0,30}\bgithub\b|\bgithub\b[^.?!]{0,30}\b(?:projeto|projetos)\b/;
const GITHUB_PULL_REQUEST_DOMAIN = /\b(?:pull request|pull requests|pr|prs)\b/;
const GITHUB_ISSUE_DOMAIN = /\b(?:issue|issues)\b/;
const GITHUB_READ_ACTION =
  /\b(?:qual|quais|liste|listar|mostre|mostrar|detalhes|informacoes|aberta|abertas|aberto|abertos|fechada|fechadas|fechado|fechados|existem|tenho|meus|minhas)\b/;

const COUNT_WORDS: Readonly<Record<string, number>> = {
  um: 1,
  uma: 1,
  dois: 2,
  duas: 2,
  tres: 3,
  quatro: 4,
  cinco: 5,
};

const TASK_TARGET_STOP_WORDS = new Set([
  "a",
  "as",
  "o",
  "os",
  "de",
  "da",
  "das",
  "do",
  "dos",
  "uma",
  "um",
  "inteira",
  "inteiro",
  "chamada",
  "chamado",
]);

const VAULT_SCOPE_STOP_WORDS = new Set([
  "a",
  "as",
  "o",
  "os",
  "de",
  "da",
  "das",
  "do",
  "dos",
  "e",
  "em",
  "me",
  "meu",
  "meus",
  "minha",
  "minhas",
  "no",
  "na",
  "nos",
  "nas",
  "qual",
  "quais",
  "diga",
  "dizer",
  "mostre",
  "mostrar",
  "procure",
  "procurar",
  "busque",
  "buscar",
  "encontre",
  "encontrar",
  "consulte",
  "consultar",
  "mude",
  "mudar",
  "altere",
  "alterar",
  "atualize",
  "atualizar",
  "edite",
  "editar",
  "troque",
  "trocar",
  "renomeie",
  "renomear",
  "cofre",
  "senha",
  "senhas",
  "login",
  "logins",
  "credencial",
  "credenciais",
  "conta",
  "contas",
  "entrada",
  "entradas",
  "servico",
  "servicos",
  "site",
  "app",
  "aplicativo",
  "acesso",
  "acessos",
  "salva",
  "salvas",
  "salvo",
  "salvos",
  "por",
  "favor",
  "gentileza",
  "pf",
  "please",
  "quero",
  "queria",
  "preciso",
  "gostaria",
]);

export function normalizePolicyText(value: string): string {
  return replaceControlCharacters(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function replaceControlCharacters(value: string): string {
  return Array.from(value, (character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127 ? " " : character;
  }).join("");
}

function isAffirmativeMutation(message: string, action: RegExp): boolean {
  return (
    action.test(message) &&
    !EXPLANATION_OR_HYPOTHESIS.test(message) &&
    !MUTATION_DENIAL.test(message)
  );
}

function explicitMutationCount(message: string): number | null {
  const match = message.match(
    /\b(\d+|um|uma|dois|duas|tres|quatro|cinco)\s+(?:novas?\s+)?(?:tarefas?|tasks?|lembretes?|alteracoes?|mudancas?|acoes?|itens?)\b/,
  );
  if (!match?.[1]) return null;
  const parsed = /^\d+$/.test(match[1]) ? Number(match[1]) : COUNT_WORDS[match[1]];
  if (!parsed || !Number.isFinite(parsed)) return null;
  return Math.min(Math.max(parsed, 1), 5);
}

function normalizeScopeText(value: string): string {
  return replaceControlCharacters(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9,:;/-]+/g, " ")
    .trim();
}

function stripCourtesy(value: string): string {
  return value
    .replace(/[\s,;:]+(?:por\s+favor|por\s+gentileza|pf|please)\s*$/, "")
    .replace(/[\s,;:]+$/, "")
    .trim();
}

function stripTemporalTail(value: string): string {
  return value
    .replace(
      /\s+(?:(?:para|em)\s+)?(?:hoje|amanha|depois\s+de\s+amanha)(?:\s+(?:as\s+)?\d{1,2}(?::\d{2})?(?:\s*h(?:\d{2})?(?:oras?)?|\s+da\s+(?:manha|tarde|noite))?)?\s*$/,
      "",
    )
    .replace(
      /\s+(?:(?:para|em)\s+)?(?:\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}(?:[/-]\d{4})?)(?:\s+(?:as\s+)?\d{1,2}(?::\d{2})?(?:\s*h(?:\d{2})?(?:oras?)?|\s+da\s+(?:manha|tarde|noite))?)?\s*$/,
      "",
    )
    .trim();
}

function taskTargetTerms(originalMessage: string): ReadonlyArray<ReadonlyArray<string>> {
  const message = normalizeScopeText(originalMessage);
  const normalized = normalizePolicyText(originalMessage);
  const targetSource =
    UPDATE_ACTION.test(normalized) || /\bprioridade\b/.test(normalized)
      ? message.replace(/\s+(?:para|por)\s+.+$/, "").trim()
      : message;
  const domain = new RegExp(`\\b${TASK_DOMAIN_SOURCE}\\b`, "g");
  const matches = [...targetSource.matchAll(domain)];
  const last = matches.at(-1);
  let tail = stripCourtesy(
    (last?.index === undefined
      ? targetSource.replace(
          /^\s*(?:conclua|concluir|finalize|finalizar|reabra|reabrir|desmarque|adie|adiar|reprograme|reprogramar)\s+/,
          "",
        )
      : targetSource.slice(last.index + last[0].length)
    )
      .replace(/^[\s,:;-]+/, "")
      .trim(),
  );
  tail = stripTemporalTail(tail);
  tail = stripCourtesy(tail);
  if (!tail) return Object.freeze([]);

  const plural =
    (last
      ? /\b(?:tarefas|tasks|pendencias|afazeres|compromissos|lembretes)\b/.test(last[0])
      : false) || /\s+e\s+|[,;]/.test(tail);
  const segments = plural ? tail.split(/\s*(?:,|;)\s*|\s+e\s+/) : [tail];
  const targets = segments
    .map((segment) => normalizePolicyText(stripCourtesy(segment)))
    .map((segment) =>
      segment
        .split(/\s+/)
        .filter(Boolean)
        .filter((term) => !TASK_TARGET_STOP_WORDS.has(term)),
    )
    .filter((terms) => terms.length > 0)
    .map((terms) => Object.freeze(terms));
  return Object.freeze(targets);
}

function expectedVaultQueryTerms(message: string): ReadonlyArray<string> {
  const terms = normalizePolicyText(message)
    .split(/\s+/)
    .filter(Boolean)
    .filter((term) => !VAULT_SCOPE_STOP_WORDS.has(term));
  return Object.freeze([...new Set(terms)]);
}

function priorityFrom(message: string): Priority | null {
  const match = message.match(
    /\bprioridade\b[^.?!]{0,60}\b(?:para|como|em)?\s*(baixa|media|alta)\b/,
  );
  return (match?.[1] as Priority | undefined) ?? null;
}

function expectedRenamedTitle(originalMessage: string): string | null {
  const message = normalizeScopeText(originalMessage);
  const match = message.match(
    /\b(?:renomeie|renomear|troque|trocar|mude|mudar|altere|alterar)\b[^.?!]{0,160}\b(?:para|por)\s+(.+)$/,
  );
  if (!match?.[1]) return null;
  const candidate = stripCourtesy(match[1]);
  return candidate ? normalizePolicyText(candidate) : null;
}

function expectedCategory(originalMessage: string): string | null {
  const message = normalizeScopeText(originalMessage);
  const match = message.match(
    /\bcategoria\b[^.?!]{0,160}\b(?:para|como|em)\s+(.+)$|\bcategoria\s+([^,.?!]+)$/,
  );
  const candidate = stripCourtesy(match?.[1] ?? match?.[2] ?? "");
  return candidate ? normalizePolicyText(candidate) : null;
}

function mutationScope(message: string, originalMessage: string): TaskMutationScope {
  const allowedFields = new Set<TaskMutationField>();
  let expectedReminderAction: ReminderMutationAction | null = null;

  if (/\b(?:prioridade)\b/.test(message)) allowedFields.add("priority");
  if (/\b(?:titulo|renomeie|renomear)\b/.test(message)) allowedFields.add("title");
  if (/\b(?:descricao|detalhes|nota)\b/.test(message)) allowedFields.add("description");
  if (/\b(?:categoria)\b/.test(message)) allowedFields.add("category");
  if (/\b(?:prazo|vencimento|data|adie|adiar|reprograme|reprogramar)\b/.test(message)) {
    allowedFields.add("due_at");
  }

  if (/\blembretes?\b/.test(message)) {
    if (REMINDER_REMOVE_ACTION.test(message)) {
      allowedFields.add("remind_at");
      allowedFields.add("reminder_enabled");
      expectedReminderAction = "clear";
    } else if (REMINDER_DISABLE_ACTION.test(message)) {
      allowedFields.add("reminder_enabled");
      expectedReminderAction = "disable";
    } else if (REMINDER_ENABLE_ACTION.test(message)) {
      allowedFields.add("reminder_enabled");
      expectedReminderAction = "enable";
    } else if (/\b(?:mude|altere|atualize|edite|reprograme|adicione|crie)\b/.test(message)) {
      allowedFields.add("remind_at");
      expectedReminderAction = "set";
    }
  }

  return {
    allowedFields,
    expectedCompleted: COMPLETE_ACTION.test(message) ? !REOPEN_ACTION.test(message) : null,
    expectedPriority: priorityFrom(message),
    expectedTitle: allowedFields.has("title") ? expectedRenamedTitle(originalMessage) : null,
    expectedCategory: allowedFields.has("category") ? expectedCategory(originalMessage) : null,
    expectedReminderAction,
  };
}

function createAllowedFields(
  message: string,
  reminderCommand: boolean,
  hasTemporalValue: boolean,
): ReadonlySet<CreateTaskField> {
  const fields = new Set<CreateTaskField>(["title"]);
  const reminderCreation =
    reminderCommand || (CREATE_ACTION.test(message) && /\blembretes?\b/.test(message));
  if (/\bdescricao|detalhes|nota\b/.test(message)) fields.add("description");
  if (/\bcategoria\b/.test(message)) fields.add("category");
  if (/\bprioridade\b/.test(message)) fields.add("priority");
  if (
    /\b(?:prazo|vencimento|data)\b/.test(message) ||
    (!reminderCreation && (hasTemporalValue || /\b(?:hoje|amanha)\b/.test(message)))
  ) {
    fields.add("due_at");
  }
  if (reminderCreation) fields.add("remind_at");
  return fields;
}

function createTitles(
  originalMessage: string,
  count: number,
): { titles: ReadonlyArray<string>; batchResolvable: boolean } {
  const message = normalizeScopeText(originalMessage);
  if (count > 1) {
    const separatorIndex = message.indexOf(":");
    if (separatorIndex < 0) return { titles: Object.freeze([]), batchResolvable: false };
    const tail = stripCourtesy(message.slice(separatorIndex + 1)).replace(
      /(?:\s+com\s+|[\s,;]+)(?:prioridade|prazo|vencimento|lembrete|categoria|descricao)\b.+$/,
      "",
    );
    const titles = tail
      .split(/\s*(?:,|;)\s*|\s+e\s+/)
      .map((title) => normalizePolicyText(stripCourtesy(title)))
      .filter(Boolean);
    return {
      titles: Object.freeze(titles),
      batchResolvable: titles.length === count && new Set(titles).size === count,
    };
  }

  const reminderMatch = message.match(/\bme\s+lembr(?:a|e|ar)\s+de\s+(.+)$/);
  const domain = new RegExp(`\\b${TASK_DOMAIN_SOURCE}\\b`, "g");
  const matches = [...message.matchAll(domain)];
  const first = matches.at(0);
  let tail =
    reminderMatch?.[1] ??
    (first?.index === undefined
      ? message.replace(
          /^\s*(?:crie|criar|adicione|adicionar|anote|anota|anotar|agende|agendar|cadastre|cadastrar)\s+(?:(?:uma?|o|a)\s+)?/,
          "",
        )
      : message.slice(first.index + first[0].length));
  tail = stripCourtesy(tail.replace(/^[\s,:;-]+/, ""));
  tail = stripTemporalTail(
    tail
      .replace(
        /(?:\s+com\s+|[\s,;]+)(?:prioridade|prazo|vencimento|lembrete|categoria|descricao)\b.+$/,
        "",
      )
      .trim(),
  );
  const title = normalizePolicyText(stripCourtesy(tail));
  return {
    titles: title ? Object.freeze([title]) : Object.freeze([]),
    batchResolvable: Boolean(title),
  };
}

function taskReadStatus(message: string): TaskResolutionStatus {
  if (/\b(?:concluidas|concluidos|finalizadas|finalizados|feitas|feitos)\b/.test(message)) {
    return "completed";
  }
  if (/\b(?:todas|todos)\b/.test(message)) return "all";
  return "open";
}

function githubRepositoryTarget(originalMessage: string): { owner: string; repo: string } | null {
  const match = normalizeScopeText(originalMessage).match(
    /\b([a-z0-9](?:[a-z0-9-]{0,38}))\/([a-z0-9._-]{1,100})\b/,
  );
  return match?.[1] && match[2] ? { owner: match[1], repo: match[2] } : null;
}

function githubAccountTarget(message: string): string | null {
  const match = message.match(
    /\b(?:(?:organizacao|org|conta)\s+|(?:repositorios|repos)\s+(?:da|do|de)\s+)([a-z0-9](?:[a-z0-9-]{0,38}))\b/,
  );
  return match?.[1] ?? null;
}

function githubRequestedState(message: string): "open" | "closed" | "all" {
  if (/\b(?:fechada|fechadas|fechado|fechados)\b/.test(message)) return "closed";
  if (/\b(?:todas|todos)\b/.test(message)) return "all";
  return "open";
}

export function isWriteTool(name: string): name is ToolName {
  return WRITE_TOOLS.has(name as ToolName);
}

export function isKnownToolName(name: string): name is ToolName {
  return (TOOL_NAMES as readonly string[]).includes(name);
}

export function resolveTurnPolicy(
  originalMessage: string,
  temporalContext?: TemporalBindingContext,
): ToolAuthorizationPolicy {
  const message = normalizePolicyText(originalMessage);
  const allowedTools = new Set<ToolName>();
  const requiredDataSources = new Set<DataSource>();
  const explanatory = EXPLANATION_OR_HYPOTHESIS.test(message);

  const hasTaskDomain = TASK_DOMAIN.test(message);
  const reminderCommand = /\bme lembr(?:a|e|ar)\b/.test(message);
  const temporalValue = resolveTemporalValue(originalMessage, temporalContext);
  const existingTaskReminder =
    /\b(?:adicione|adicionar|crie|criar)\b[^.?!]{0,80}\blembretes?\b[^.?!]{0,80}\b(?:a|na|para)\s+(?:a\s+)?(?:tarefa|task|pendencia|compromisso)\b/.test(
      message,
    );
  const implicitTemporalTaskCreate =
    temporalValue.kind !== "none" && isAffirmativeMutation(message, CREATE_ACTION);
  const createAllowed =
    !existingTaskReminder &&
    isAffirmativeMutation(message, CREATE_ACTION) &&
    (hasTaskDomain || reminderCommand || implicitTemporalTaskCreate);
  const reminderUpdate =
    hasTaskDomain &&
    /\blembretes?\b/.test(message) &&
    isAffirmativeMutation(
      message,
      new RegExp(
        `${UPDATE_ACTION.source}|${REMINDER_REMOVE_ACTION.source}|${REMINDER_DISABLE_ACTION.source}|${REMINDER_ENABLE_ACTION.source}`,
      ),
    );
  const updateAllowed =
    (isAffirmativeMutation(message, UPDATE_ACTION) &&
      (hasTaskDomain || /\b(?:adie|adiar|reprograme|reprogramar)\b/.test(message))) ||
    reminderUpdate ||
    existingTaskReminder;
  const implicitCompletionBatch =
    /\b(?:conclua|reabra|desmarque)\b[^.?!]{1,160}\s+e\s+[^.?!]{1,160}/.test(message);
  const completionAllowed =
    isAffirmativeMutation(message, COMPLETE_ACTION) && (hasTaskDomain || implicitCompletionBatch);
  const deleteAllowed =
    isAffirmativeMutation(message, DELETE_ACTION) &&
    hasTaskDomain &&
    !DESTRUCTIVE_DENIAL.test(message) &&
    !/\blembretes?\b/.test(message);

  if (createAllowed) allowedTools.add("create_task");
  if (updateAllowed) allowedTools.add("update_task");
  if (completionAllowed) allowedTools.add("set_task_completed");
  if (deleteAllowed) allowedTools.add("delete_task");

  const taskQueryRequested =
    !explanatory &&
    ((TASK_DOMAIN.test(message) && TASK_PERSONAL_QUERY.test(message)) ||
      TASK_PLURAL_QUERY.test(message) ||
      SCHEDULE_QUERY.test(message));
  const taskMutationRequested = updateAllowed || completionAllowed || deleteAllowed;
  if (taskQueryRequested || taskMutationRequested) allowedTools.add("list_tasks");
  if (taskQueryRequested) requiredDataSources.add("tasks");

  const vaultReadRequired =
    !explanatory && VAULT_DOMAIN.test(message) && VAULT_PERSONAL_QUERY.test(message);
  const vaultTerms = vaultReadRequired ? expectedVaultQueryTerms(originalMessage) : [];
  if (vaultReadRequired) {
    allowedTools.add("search_vault");
    requiredDataSources.add("vault");
  }

  const githubTarget = githubRepositoryTarget(originalMessage);
  const githubResource =
    GITHUB_REPOSITORY_DOMAIN.test(message) ||
    GITHUB_PROJECT_DOMAIN.test(message) ||
    GITHUB_PULL_REQUEST_DOMAIN.test(message) ||
    GITHUB_ISSUE_DOMAIN.test(message) ||
    githubTarget !== null;
  const githubReadRequired =
    !explanatory &&
    !createAllowed &&
    !taskMutationRequested &&
    !vaultReadRequired &&
    githubResource &&
    (GITHUB_READ_ACTION.test(message) || githubTarget !== null);
  let githubScope: GitHubReadScope | null = null;
  if (githubReadRequired) {
    const account = githubAccountTarget(message);
    const state = githubRequestedState(message);
    if (GITHUB_PULL_REQUEST_DOMAIN.test(message)) {
      allowedTools.add("github_list_pull_requests");
    } else if (GITHUB_ISSUE_DOMAIN.test(message)) {
      allowedTools.add("github_list_issues");
    } else if (githubTarget || GITHUB_SPECIFIC_REPOSITORY_DOMAIN.test(message)) {
      allowedTools.add("github_get_repository");
    } else {
      allowedTools.add("github_list_repositories");
    }
    requiredDataSources.add("github");
    githubScope = {
      generalRepositories: !githubTarget && !account,
      account,
      owner: githubTarget?.owner ?? null,
      repo: githubTarget?.repo ?? null,
      state,
    };
  }

  const targetTerms = taskMutationRequested ? taskTargetTerms(originalMessage) : [];
  const hasWrite = [...allowedTools].some(isWriteTool);
  const inferredTargetCount = taskMutationRequested ? Math.min(targetTerms.length, 5) : 0;
  const maxMutations = hasWrite
    ? (explicitMutationCount(message) ?? (inferredTargetCount > 0 ? inferredTargetCount : 1))
    : 0;
  const taskDateScope =
    taskQueryRequested && !hasWrite
      ? /\bamanha\b/.test(message)
        ? "tomorrow"
        : /\bhoje\b/.test(message)
          ? "today"
          : null
      : null;
  const completionStatus: TaskResolutionStatus = completionAllowed
    ? REOPEN_ACTION.test(message)
      ? "completed"
      : "open"
    : "all";
  const createTitleScope = createAllowed ? createTitles(originalMessage, maxMutations) : null;
  const queryStatus = taskReadStatus(message);
  const taskMutationScope = mutationScope(message, originalMessage);
  const reminderCreation = reminderCommand || (createAllowed && /\blembretes?\b/.test(message));
  const temporalScope: TemporalScope = {
    dueAt:
      (createAllowed && !reminderCreation && temporalValue.kind !== "none") ||
      (updateAllowed && taskMutationScope.allowedFields.has("due_at"))
        ? requireTemporalValue(temporalValue)
        : Object.freeze({ kind: "none" }),
    remindAt:
      (createAllowed && reminderCreation) ||
      (updateAllowed && taskMutationScope.expectedReminderAction === "set")
        ? requireTemporalValue(temporalValue)
        : Object.freeze({ kind: "none" }),
  };

  return {
    allowedTools,
    requiredDataSources,
    maxMutations,
    maxReads: [...allowedTools].some((tool) => !isWriteTool(tool)) ? 4 : 0,
    destructiveAllowed: deleteAllowed,
    taskTargetTerms: targetTerms,
    taskResolutionStatus: completionStatus,
    taskDateScope,
    taskMutationScope,
    temporalScope,
    createTaskScope: createTitleScope
      ? {
          requestedTitles: createTitleScope.titles,
          allowedFields: createAllowedFields(
            message,
            reminderCommand,
            temporalValue.kind !== "none",
          ),
          batchResolvable: createTitleScope.batchResolvable,
        }
      : null,
    taskReadScope: taskQueryRequested
      ? {
          general: taskDateScope === null,
          expectedStatus: queryStatus,
          expectedHasReminder: /\bsem\s+lembretes?\b/.test(message)
            ? false
            : /\blembretes?\b/.test(message)
              ? true
              : null,
        }
      : null,
    vaultQueryTerms: vaultTerms,
    vaultTargetMissing: vaultReadRequired && vaultTerms.length === 0,
    githubScope,
  };
}
