import { describe, expect, it, vi } from "vitest";

import { GitHubApiError, type GitHubAppClient } from "../github/github-app.server";
import type { GitHubConnection } from "../github/types";
import { GitHubService } from "./github.service";

const USER_ID = "00000000-0000-4000-8000-000000000001";

const connection: GitHubConnection = {
  id: "10000000-0000-4000-8000-000000000001",
  userId: USER_ID,
  installationId: 987,
  accountId: 123,
  accountLogin: "acme",
  accountType: "Organization",
  repositorySelection: "selected",
  permissions: { metadata: "read", issues: "read", pull_requests: "read" },
  status: "active",
  connectedAt: "2026-08-10T12:00:00Z",
  lastVerifiedAt: "2026-08-10T12:00:00Z",
  createdAt: "2026-08-10T12:00:00Z",
  updatedAt: "2026-08-10T12:00:00Z",
};

function harness() {
  const store = {
    listActiveByUser: vi.fn(async (userId: string) => (userId === USER_ID ? [connection] : [])),
    markDisconnected: vi.fn(async () => undefined),
  };
  const installationRequest = vi.fn();
  const service = new GitHubService(
    store,
    { installationRequest } as unknown as GitHubAppClient,
    () => new Date("2026-08-10T12:00:00Z"),
  );
  return { store, installationRequest, service };
}

const repository = {
  id: 101,
  owner: { login: "acme" },
  name: "api",
  full_name: "acme/api",
  private: true,
  description: "API interna",
  default_branch: "main",
  html_url: "https://github.com/acme/api",
  updated_at: "2026-08-10T11:00:00Z",
  language: "TypeScript",
  open_issues_count: 4,
};

describe("P5 — GitHubService read-only", () => {
  it("lista somente metadados dos repos permitidos pela instalação", async () => {
    const h = harness();
    h.installationRequest.mockResolvedValueOnce({ total_count: 1, repositories: [repository] });

    const result = await h.service.listRepositories(USER_ID, { account: "acme", limit: 20 });

    expect(result).toEqual({
      items: [
        {
          owner: "acme",
          name: "api",
          full_name: "acme/api",
          private: true,
          description: "API interna",
          default_branch: "main",
          html_url: "https://github.com/acme/api",
          updated_at: "2026-08-10T11:00:00Z",
        },
      ],
      truncated: false,
    });
    expect(h.installationRequest).toHaveBeenCalledWith(
      987,
      "/installation/repositories?per_page=100&page=1",
      "list_installation_repositories",
    );
  });

  it("obtém detalhes, PRs e issues do owner/repo autorizado", async () => {
    const h = harness();
    h.installationRequest
      .mockResolvedValueOnce(repository)
      .mockResolvedValueOnce([
        {
          number: 3,
          title: "Melhorar API",
          state: "open",
          draft: false,
          user: { login: "pedro" },
          created_at: "2026-08-09T10:00:00Z",
          updated_at: "2026-08-10T10:00:00Z",
          html_url: "https://github.com/acme/api/pull/3",
          body: "não deve ser retornado",
        },
      ])
      .mockResolvedValueOnce([
        {
          number: 4,
          title: "Issue real",
          state: "open",
          user: { login: "pedro" },
          labels: [{ name: "bug" }],
          created_at: "2026-08-09T10:00:00Z",
          updated_at: "2026-08-10T10:00:00Z",
          html_url: "https://github.com/acme/api/issues/4",
          body: "não deve ser retornado",
        },
        {
          number: 5,
          title: "PR duplicada no endpoint issues",
          state: "open",
          pull_request: { url: "internal" },
        },
      ]);

    const detail = await h.service.getRepository(USER_ID, "acme", "api");
    const prs = await h.service.listPullRequests(USER_ID, {
      owner: "acme",
      repo: "api",
      state: "open",
    });
    const issues = await h.service.listIssues(USER_ID, {
      owner: "acme",
      repo: "api",
      state: "open",
    });

    expect(detail).toMatchObject({ full_name: "acme/api", language: "TypeScript" });
    expect(prs.items).toHaveLength(1);
    expect(JSON.stringify(prs.items)).not.toContain("body");
    expect(issues.items).toHaveLength(1);
    expect(issues.items[0]).toMatchObject({ number: 4, labels: ["bug"] });
    expect(JSON.stringify(issues.items)).not.toContain("body");
    expect(JSON.stringify(issues.items)).not.toContain("PR duplicada");
  });

  it("não consulta repo fora da conta instalada nem escolhe instalação ambígua", async () => {
    const h = harness();
    await expect(h.service.getRepository(USER_ID, "outra-org", "api")).rejects.toMatchObject({
      code: "github_repository_not_authorized",
    });
    expect(h.installationRequest).not.toHaveBeenCalled();

    h.store.listActiveByUser.mockResolvedValueOnce([
      connection,
      { ...connection, id: crypto.randomUUID() },
    ]);
    await expect(h.service.listRepositories(USER_ID, { account: "acme" })).rejects.toMatchObject({
      code: "github_installation_ambiguous",
    });
  });
});

function repositories(count: number, owner = "acme", start = 1) {
  return Array.from({ length: count }, (_, index) => ({
    ...repository,
    id: start + index,
    owner: { login: owner },
    name: `repo-${start + index}`,
    full_name: `${owner}/repo-${start + index}`,
    html_url: `https://github.com/${owner}/repo-${start + index}`,
  }));
}

function issues(count: number, start = 1) {
  return Array.from({ length: count }, (_, index) => ({
    number: start + index,
    title: `Issue ${start + index}`,
    state: "open",
    user: { login: "pedro" },
    labels: [{ name: "bug" }],
    created_at: "2026-08-09T10:00:00Z",
    updated_at: "2026-08-10T10:00:00Z",
    html_url: `https://github.com/acme/api/issues/${start + index}`,
  }));
}

describe("P6 — paginação e truncation GitHub", () => {
  it("retorna 20 de 21 repositories e sinaliza truncation", async () => {
    const h = harness();
    h.installationRequest.mockResolvedValueOnce({
      total_count: 21,
      repositories: repositories(21),
    });

    const result = await h.service.listRepositories(USER_ID, { limit: 20 });

    expect(result.items).toHaveLength(20);
    expect(result.truncated).toBe(true);
  });

  it("retorna 15 de 15 repositories sem truncation", async () => {
    const h = harness();
    h.installationRequest.mockResolvedValueOnce({
      total_count: 15,
      repositories: repositories(15),
    });

    const result = await h.service.listRepositories(USER_ID, { limit: 20 });

    expect(result.items).toHaveLength(15);
    expect(result.truncated).toBe(false);
  });

  it("aplica limit global e deduplica por repository id entre instalações", async () => {
    const h = harness();
    const otherConnection = {
      ...connection,
      id: "20000000-0000-4000-8000-000000000001",
      installationId: 654,
      accountId: 456,
      accountLogin: "beta",
    };
    h.store.listActiveByUser.mockResolvedValueOnce([connection, otherConnection]);
    h.installationRequest
      .mockResolvedValueOnce({ total_count: 15, repositories: repositories(15) })
      .mockResolvedValueOnce({
        total_count: 7,
        repositories: [
          { ...repositories(1, "beta", 1)[0], id: 1 },
          ...repositories(6, "beta", 100),
        ],
      });

    const result = await h.service.listRepositories(USER_ID, { limit: 20 });

    expect(result.items).toHaveLength(20);
    expect(result.items.filter((item) => item.name === "repo-1")).toHaveLength(1);
    expect(result.truncated).toBe(true);
  });

  it("marca truncation quando o page cap impede provar o fim", async () => {
    const h = harness();
    h.installationRequest.mockResolvedValue({
      total_count: 600,
      repositories: repositories(100),
    });

    const result = await h.service.listRepositories(USER_ID, {
      query: "nao-existe",
      limit: 20,
    });

    expect(result).toEqual({ items: [], truncated: true });
    expect(h.installationRequest).toHaveBeenCalledTimes(5);
  });

  it("retorna 20 de 21 pull requests e 15 de 15 sem falso truncation", async () => {
    const h = harness();
    const pulls = (count: number) => issues(count).map((issue) => ({ ...issue, draft: false }));
    h.installationRequest.mockResolvedValueOnce(pulls(21));

    const many = await h.service.listPullRequests(USER_ID, {
      owner: "acme",
      repo: "api",
      limit: 20,
    });
    expect(many.items).toHaveLength(20);
    expect(many.truncated).toBe(true);

    h.installationRequest.mockResolvedValueOnce(pulls(15));
    const exact = await h.service.listPullRequests(USER_ID, {
      owner: "acme",
      repo: "api",
      limit: 20,
    });
    expect(exact.items).toHaveLength(15);
    expect(exact.truncated).toBe(false);
  });

  it("pagina issues reais além de PRs misturadas pelo endpoint", async () => {
    const h = harness();
    const pullRows = issues(100).map((issue) => ({
      ...issue,
      pull_request: { url: "internal" },
    }));
    h.installationRequest.mockResolvedValueOnce(pullRows).mockResolvedValueOnce(issues(21, 101));

    const result = await h.service.listIssues(USER_ID, {
      owner: "acme",
      repo: "api",
      limit: 20,
    });

    expect(result.items).toHaveLength(20);
    expect(result.items[0]?.number).toBe(101);
    expect(result.truncated).toBe(true);
    expect(h.installationRequest).toHaveBeenNthCalledWith(
      2,
      987,
      "/repos/acme/api/issues?state=open&per_page=100&page=2",
      "list_issues",
    );
  });

  it("retorna 15 de 15 issues e sinaliza cap inconclusivo", async () => {
    const exact = harness();
    exact.installationRequest.mockResolvedValueOnce(issues(15));
    await expect(
      exact.service.listIssues(USER_ID, { owner: "acme", repo: "api", limit: 20 }),
    ).resolves.toMatchObject({ truncated: false, items: expect.any(Array) });

    const capped = harness();
    capped.installationRequest.mockResolvedValue(
      issues(100).map((issue) => ({ ...issue, pull_request: { url: "internal" } })),
    );
    const incomplete = await capped.service.listIssues(USER_ID, {
      owner: "acme",
      repo: "api",
      limit: 20,
    });
    expect(incomplete).toEqual({ items: [], truncated: true });
    expect(capped.installationRequest).toHaveBeenCalledTimes(5);
  });

  it("marca vínculo local desconectado quando a instalação foi revogada", async () => {
    const h = harness();
    h.installationRequest.mockRejectedValueOnce(
      new GitHubApiError(404, "create_installation_token"),
    );

    await expect(h.service.listRepositories(USER_ID, { limit: 20 })).rejects.toMatchObject({
      code: "github_installation_revoked",
    });
    expect(h.store.markDisconnected).toHaveBeenCalledWith(
      USER_ID,
      connection.id,
      "2026-08-10T12:00:00.000Z",
    );
  });
});
