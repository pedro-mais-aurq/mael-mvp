import { describe, expect, it, vi } from "vitest";

import { GitHubApiError } from "../github/github-app.server";
import { GitHubTool } from "./github.tool";

const USER_ID = "00000000-0000-4000-8000-000000000001";

function toolWith(error: GitHubApiError) {
  return new GitHubTool({
    listRepositories: vi.fn().mockRejectedValue(error),
    getRepository: vi.fn().mockRejectedValue(error),
    listPullRequests: vi.fn().mockRejectedValue(error),
    listIssues: vi.fn().mockRejectedValue(error),
  });
}

describe("P6 — GitHub rate-limit classification", () => {
  it("classifica 429 como rate limited e expõe reset seguro", async () => {
    const result = await toolWith(
      new GitHubApiError(429, "list_installation_repositories", "1780000000"),
    ).listRepositories(USER_ID, {});

    expect(result.modelOutput).toMatchObject({
      error: {
        code: "github_rate_limited",
        rate_limit_reset: new Date(1780000000 * 1000).toISOString(),
      },
    });
  });

  it("classifica 403 com remaining=0 ou retry-after como rate limited", async () => {
    const remaining = await toolWith(
      new GitHubApiError(403, "list_issues", null, "0", null),
    ).listIssues(USER_ID, { owner: "acme", repo: "api" });
    const retryAfter = await toolWith(
      new GitHubApiError(403, "list_issues", null, null, "30"),
    ).listIssues(USER_ID, { owner: "acme", repo: "api" });

    expect(remaining.modelOutput).toMatchObject({ error: { code: "github_rate_limited" } });
    expect(retryAfter.modelOutput).toMatchObject({ error: { code: "github_rate_limited" } });
  });

  it("não confunde 403 sem prova de rate limit com throttling", async () => {
    const result = await toolWith(
      new GitHubApiError(403, "list_pull_requests", "1780000000", "42", null),
    ).listPullRequests(USER_ID, { owner: "acme", repo: "api" });

    expect(result.modelOutput).toMatchObject({
      error: { code: "github_permission_denied" },
    });
    expect(JSON.stringify(result.modelOutput)).not.toContain("rate_limit_reset");
  });
});
