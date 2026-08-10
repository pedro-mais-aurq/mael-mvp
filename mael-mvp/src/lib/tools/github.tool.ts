import { GitHubApiError, GitHubOperationalError } from "../github/github-app.server";
import type { ToolExecutionResult } from "../chat/tool-types";
import type { JsonValue } from "../mael-types";
import type { GitHubService } from "../services/github.service";

function failure(error: unknown): ToolExecutionResult {
  let code = "github_unavailable";
  let message = "Não consegui consultar seu GitHub agora.";
  let rateLimitReset: string | null = null;

  if (error instanceof GitHubOperationalError) {
    code = error.code;
    message = error.message;
  } else if (error instanceof GitHubApiError) {
    const rateLimited =
      error.status === 429 ||
      (error.status === 403 &&
        (error.rateLimitRemaining?.trim() === "0" || Boolean(error.retryAfter?.trim())));
    if (rateLimited) {
      code = "github_rate_limited";
      message = "O GitHub limitou temporariamente as consultas. Tente novamente mais tarde.";
      if (/^\d{9,12}$/.test(error.rateLimitReset ?? "")) {
        const reset = new Date(Number(error.rateLimitReset) * 1000);
        if (Number.isFinite(reset.getTime())) rateLimitReset = reset.toISOString();
      }
    } else if (error.status === 403) {
      code = "github_permission_denied";
      message = "A instalação GitHub não autorizou essa consulta.";
    } else if (error.status === 404) {
      code = "github_resource_not_found";
      message = "O recurso não existe ou não está autorizado para esta instalação.";
    }
  }

  return {
    ok: false,
    modelOutput: {
      ok: false,
      error: { code, message, ...(rateLimitReset ? { rate_limit_reset: rateLimitReset } : {}) },
    },
    persistedOutput: null,
    fallbackReply: message,
    mutatesTasks: false,
  };
}

export class GitHubTool {
  constructor(
    private readonly service: Pick<
      GitHubService,
      "listRepositories" | "getRepository" | "listPullRequests" | "listIssues"
    >,
  ) {}

  async listRepositories(
    userId: string,
    input: { account?: string | undefined; query?: string | undefined; limit?: number | undefined },
  ): Promise<ToolExecutionResult> {
    try {
      const result = await this.service.listRepositories(userId, input);
      return {
        ok: true,
        modelOutput: {
          ok: true,
          repositories: result.items,
          truncated: result.truncated,
        } as unknown as JsonValue,
        persistedOutput: {
          kind: "github_repository_list",
          count: result.items.length,
          truncated: result.truncated,
        },
        fallbackReply:
          result.items.length === 0
            ? "Não encontrei repositórios autorizados com esses filtros."
            : `Consultei ${result.items.length} repositório${result.items.length === 1 ? "" : "s"} no GitHub.`,
        mutatesTasks: false,
      };
    } catch (error) {
      return failure(error);
    }
  }

  async getRepository(
    userId: string,
    input: { owner: string; repo: string },
  ): Promise<ToolExecutionResult> {
    try {
      const repository = await this.service.getRepository(userId, input.owner, input.repo);
      return {
        ok: true,
        modelOutput: { ok: true, repository } as unknown as JsonValue,
        persistedOutput: { kind: "github_repository", count: 1, truncated: false },
        fallbackReply: `Consultei o repositório ${repository.full_name}.`,
        mutatesTasks: false,
      };
    } catch (error) {
      return failure(error);
    }
  }

  async listPullRequests(
    userId: string,
    input: {
      owner: string;
      repo: string;
      state?: "open" | "closed" | "all" | undefined;
      limit?: number | undefined;
    },
  ): Promise<ToolExecutionResult> {
    try {
      const result = await this.service.listPullRequests(userId, input);
      return {
        ok: true,
        modelOutput: {
          ok: true,
          pull_requests: result.items,
          truncated: result.truncated,
        } as unknown as JsonValue,
        persistedOutput: {
          kind: "github_pull_requests",
          count: result.items.length,
          truncated: result.truncated,
        },
        fallbackReply: `Consultei ${result.items.length} pull request${result.items.length === 1 ? "" : "s"}.`,
        mutatesTasks: false,
      };
    } catch (error) {
      return failure(error);
    }
  }

  async listIssues(
    userId: string,
    input: {
      owner: string;
      repo: string;
      state?: "open" | "closed" | "all" | undefined;
      limit?: number | undefined;
    },
  ): Promise<ToolExecutionResult> {
    try {
      const result = await this.service.listIssues(userId, input);
      return {
        ok: true,
        modelOutput: {
          ok: true,
          issues: result.items,
          truncated: result.truncated,
        } as unknown as JsonValue,
        persistedOutput: {
          kind: "github_issues",
          count: result.items.length,
          truncated: result.truncated,
        },
        fallbackReply: `Consultei ${result.items.length} issue${result.items.length === 1 ? "" : "s"}.`,
        mutatesTasks: false,
      };
    } catch (error) {
      return failure(error);
    }
  }
}
