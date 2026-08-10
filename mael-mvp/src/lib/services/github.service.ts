import {
  GitHubApiError,
  GitHubOperationalError,
  type GitHubAppClient,
} from "../github/github-app.server";
import type {
  GitHubConnection,
  GitHubIssueSummary,
  GitHubPullRequestSummary,
  GitHubRepositoryDetail,
  GitHubRepositorySummary,
  LimitedResult,
} from "../github/types";

const MAX_CONNECTIONS_PER_REQUEST = 10;
const MAX_RESULT_LIMIT = 30;
const GITHUB_PAGE_SIZE = 100;
const MAX_GITHUB_PAGES = 5;
const GITHUB_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const GITHUB_REPOSITORY = /^[A-Za-z0-9._-]{1,100}$/;

export interface GitHubDataStore {
  listActiveByUser(userId: string): Promise<GitHubConnection[]>;
  markDisconnected(userId: string, id: string, now: string): Promise<void>;
}

interface RawRepository {
  id?: unknown;
  name?: unknown;
  full_name?: unknown;
  private?: unknown;
  description?: unknown;
  default_branch?: unknown;
  html_url?: unknown;
  updated_at?: unknown;
  language?: unknown;
  open_issues_count?: unknown;
  owner?: { login?: unknown };
}

function repositoryIdentity(raw: RawRepository, repository: GitHubRepositorySummary): string {
  return typeof raw.id === "number" && Number.isSafeInteger(raw.id) && raw.id > 0
    ? `id:${raw.id}`
    : `name:${repository.full_name.toLocaleLowerCase("en-US")}`;
}

interface RawPullRequest {
  number?: unknown;
  title?: unknown;
  state?: unknown;
  draft?: unknown;
  html_url?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
  user?: { login?: unknown } | null;
}

interface RawIssue {
  number?: unknown;
  title?: unknown;
  state?: unknown;
  html_url?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
  user?: { login?: unknown } | null;
  labels?: unknown;
  pull_request?: unknown;
}

function safeText(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function safeNullableText(value: unknown, max: number): string | null {
  return typeof value === "string" ? value.slice(0, max) : null;
}

function safeHtmlUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "github.com" ? url.toString() : "";
  } catch {
    return "";
  }
}

function repositorySummary(raw: RawRepository): GitHubRepositorySummary {
  return {
    owner: safeText(raw.owner?.login, 100),
    name: safeText(raw.name, 100),
    full_name: safeText(raw.full_name, 201),
    private: raw.private === true,
    description: safeNullableText(raw.description, 500),
    default_branch: safeText(raw.default_branch, 255),
    html_url: safeHtmlUrl(raw.html_url),
    updated_at: safeText(raw.updated_at, 40),
  };
}

function safeLimit(limit: number | undefined): number {
  return Math.min(Math.max(Math.trunc(limit ?? 20), 1), MAX_RESULT_LIMIT);
}

export class GitHubService {
  constructor(
    private readonly store: GitHubDataStore,
    private readonly github: GitHubAppClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async listRepositories(
    userId: string,
    input: { account?: string | undefined; query?: string | undefined; limit?: number | undefined },
  ): Promise<LimitedResult<GitHubRepositorySummary>> {
    const connections = await this.resolveConnections(userId, input.account);
    const limit = safeLimit(input.limit);
    const query = input.query?.trim().toLocaleLowerCase("en-US") ?? "";
    const matches = new Map<string, GitHubRepositorySummary>();
    let incomplete = false;

    connectionLoop: for (const connection of connections) {
      for (let page = 1; page <= MAX_GITHUB_PAGES; page += 1) {
        const result = await this.requestConnection<{
          total_count?: unknown;
          repositories?: RawRepository[];
        }>(
          userId,
          connection,
          `/installation/repositories?per_page=${GITHUB_PAGE_SIZE}&page=${page}`,
          "list_installation_repositories",
        );
        const repositories = Array.isArray(result.repositories) ? result.repositories : [];
        const totalCount =
          typeof result.total_count === "number" && result.total_count >= 0
            ? result.total_count
            : null;

        for (const raw of repositories) {
          const repository = repositorySummary(raw);
          if (!repository.full_name || !repository.owner || !repository.name) continue;
          if (
            query &&
            !`${repository.full_name} ${repository.description ?? ""}`
              .toLocaleLowerCase("en-US")
              .includes(query)
          ) {
            continue;
          }
          matches.set(repositoryIdentity(raw, repository), repository);
          if (matches.size > limit) {
            incomplete = true;
            break connectionLoop;
          }
        }

        const reachedEnd =
          repositories.length < GITHUB_PAGE_SIZE ||
          (totalCount !== null && page * GITHUB_PAGE_SIZE >= totalCount);
        if (reachedEnd) break;
        if (page === MAX_GITHUB_PAGES) incomplete = true;
      }
    }

    const sorted = [...matches.values()].sort((left, right) =>
      left.full_name.localeCompare(right.full_name, "en-US"),
    );
    return {
      items: sorted.slice(0, limit),
      truncated: incomplete || sorted.length > limit,
    };
  }

  async getRepository(
    userId: string,
    owner: string,
    repo: string,
  ): Promise<GitHubRepositoryDetail> {
    const connection = await this.resolveRepositoryConnection(userId, owner, repo);
    const raw = await this.requestConnection<RawRepository>(
      userId,
      connection,
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
      "get_repository",
    );
    const summary = repositorySummary(raw);
    return {
      ...summary,
      language: safeNullableText(raw.language, 100),
      open_issues_count:
        typeof raw.open_issues_count === "number" ? Math.max(0, raw.open_issues_count) : 0,
    };
  }

  async listPullRequests(
    userId: string,
    input: {
      owner: string;
      repo: string;
      state?: "open" | "closed" | "all" | undefined;
      limit?: number | undefined;
    },
  ): Promise<LimitedResult<GitHubPullRequestSummary>> {
    const connection = await this.resolveRepositoryConnection(userId, input.owner, input.repo);
    const limit = safeLimit(input.limit);
    const state = input.state ?? "open";
    const collected: RawPullRequest[] = [];
    let incomplete = false;
    const perPage = Math.min(GITHUB_PAGE_SIZE, limit + 1);
    for (let page = 1; page <= MAX_GITHUB_PAGES; page += 1) {
      const rows = await this.requestConnection<RawPullRequest[]>(
        userId,
        connection,
        `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/pulls?state=${state}&per_page=${perPage}&page=${page}`,
        "list_pull_requests",
      );
      const batch = Array.isArray(rows) ? rows : [];
      collected.push(...batch);
      if (collected.length > limit) {
        incomplete = true;
        break;
      }
      if (batch.length < perPage) break;
      if (page === MAX_GITHUB_PAGES) incomplete = true;
    }
    const items: GitHubPullRequestSummary[] = collected.slice(0, limit).map((raw) => ({
      number: typeof raw.number === "number" ? raw.number : 0,
      title: safeText(raw.title, 300),
      state: raw.state === "closed" ? ("closed" as const) : ("open" as const),
      draft: raw.draft === true,
      author_login: safeNullableText(raw.user?.login, 100),
      created_at: safeText(raw.created_at, 40),
      updated_at: safeText(raw.updated_at, 40),
      html_url: safeHtmlUrl(raw.html_url),
    }));
    return { items, truncated: incomplete || collected.length > limit };
  }

  async listIssues(
    userId: string,
    input: {
      owner: string;
      repo: string;
      state?: "open" | "closed" | "all" | undefined;
      limit?: number | undefined;
    },
  ): Promise<LimitedResult<GitHubIssueSummary>> {
    const connection = await this.resolveRepositoryConnection(userId, input.owner, input.repo);
    const limit = safeLimit(input.limit);
    const state = input.state ?? "open";
    const actualIssues: RawIssue[] = [];
    let incomplete = false;
    for (let page = 1; page <= MAX_GITHUB_PAGES; page += 1) {
      const rows = await this.requestConnection<RawIssue[]>(
        userId,
        connection,
        `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/issues?state=${state}&per_page=${GITHUB_PAGE_SIZE}&page=${page}`,
        "list_issues",
      );
      const batch = Array.isArray(rows) ? rows : [];
      for (const raw of batch) {
        if (!raw.pull_request) actualIssues.push(raw);
        if (actualIssues.length > limit) {
          incomplete = true;
          break;
        }
      }
      if (actualIssues.length > limit) break;
      if (batch.length < GITHUB_PAGE_SIZE) break;
      if (page === MAX_GITHUB_PAGES) incomplete = true;
    }
    const items: GitHubIssueSummary[] = actualIssues.slice(0, limit).map((raw) => ({
      number: typeof raw.number === "number" ? raw.number : 0,
      title: safeText(raw.title, 300),
      state: raw.state === "closed" ? ("closed" as const) : ("open" as const),
      author_login: safeNullableText(raw.user?.login, 100),
      labels: (Array.isArray(raw.labels) ? raw.labels : [])
        .map((label) =>
          typeof label === "string"
            ? label
            : safeText((label as { name?: unknown } | null)?.name, 50),
        )
        .filter(Boolean)
        .slice(0, 10),
      created_at: safeText(raw.created_at, 40),
      updated_at: safeText(raw.updated_at, 40),
      html_url: safeHtmlUrl(raw.html_url),
    }));
    return { items, truncated: incomplete || actualIssues.length > limit };
  }

  private async resolveConnections(userId: string, account?: string): Promise<GitHubConnection[]> {
    let connections = await this.store.listActiveByUser(userId);
    if (connections.length === 0) {
      throw new GitHubOperationalError(
        "Seu GitHub ainda não está conectado ao Mael.",
        "github_not_connected",
      );
    }
    if (account) {
      connections = connections.filter(
        (connection) => connection.accountLogin.toLowerCase() === account.toLowerCase(),
      );
      if (connections.length === 0) {
        throw new GitHubOperationalError(
          "Não encontrei uma conexão GitHub para essa conta.",
          "github_account_not_connected",
        );
      }
      if (connections.length > 1) {
        throw new GitHubOperationalError(
          "Há mais de uma instalação para essa conta. Especifique a instalação desejada.",
          "github_installation_ambiguous",
        );
      }
    }
    if (connections.length > MAX_CONNECTIONS_PER_REQUEST) {
      throw new GitHubOperationalError(
        "Há muitas instalações conectadas. Especifique a conta GitHub.",
        "github_installation_ambiguous",
      );
    }
    return connections;
  }

  private async resolveRepositoryConnection(
    userId: string,
    owner: string,
    repo: string,
  ): Promise<GitHubConnection> {
    if (!GITHUB_LOGIN.test(owner) || !GITHUB_REPOSITORY.test(repo)) {
      throw new GitHubOperationalError("Repositório GitHub inválido.", "github_repository_invalid");
    }
    const connections = (await this.resolveConnections(userId)).filter(
      (connection) => connection.accountLogin.toLowerCase() === owner.toLowerCase(),
    );
    if (connections.length === 0) {
      throw new GitHubOperationalError(
        "Esse repositório não pertence às instalações GitHub conectadas.",
        "github_repository_not_authorized",
      );
    }
    if (connections.length > 1) {
      throw new GitHubOperationalError(
        "Há mais de uma instalação compatível. Especifique a conta desejada.",
        "github_installation_ambiguous",
      );
    }
    return connections[0]!;
  }

  private async requestConnection<T>(
    userId: string,
    connection: GitHubConnection,
    path: string,
    operation: string,
  ): Promise<T> {
    try {
      return await this.github.installationRequest<T>(connection.installationId, path, operation);
    } catch (error) {
      if (
        error instanceof GitHubApiError &&
        error.status === 404 &&
        error.operation === "create_installation_token"
      ) {
        await this.store.markDisconnected(userId, connection.id, this.now().toISOString());
        throw new GitHubOperationalError(
          "A instalação GitHub não está mais disponível.",
          "github_installation_revoked",
        );
      }
      throw error;
    }
  }
}
