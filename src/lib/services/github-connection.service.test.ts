import { describe, expect, it, vi } from "vitest";

import type { GitHubAppClient } from "../github/github-app.server";
import { GitHubConnectionService, type GitHubConnectionStore } from "./github-connection.service";
import type {
  GitHubConnection,
  GitHubConnectionPurpose,
  GitHubConnectionState,
  GitHubInstallation,
} from "../github/types";

const USER_A = "00000000-0000-4000-8000-000000000001";
const USER_B = "00000000-0000-4000-8000-000000000002";

interface StoredState extends GitHubConnectionState {
  hash: string;
}

class MemoryStore implements GitHubConnectionStore {
  states: StoredState[] = [];
  connections: GitHubConnection[] = [];
  upserts = 0;

  async listByUser(userId: string) {
    return this.connections.filter((item) => item.userId === userId);
  }

  async listActiveByUser(userId: string) {
    return (await this.listByUser(userId)).filter((item) => item.status === "active");
  }

  async findById(userId: string, id: string) {
    return this.connections.find((item) => item.userId === userId && item.id === id) ?? null;
  }

  async createState(input: {
    userId: string;
    stateHash: string;
    purpose: GitHubConnectionPurpose;
    installationId?: number | null;
    pkceVerifier?: string | null;
    expiresAt: string;
  }) {
    this.states.push({
      id: crypto.randomUUID(),
      userId: input.userId,
      purpose: input.purpose,
      installationId: input.installationId ?? null,
      pkceVerifier: input.pkceVerifier ?? null,
      expiresAt: input.expiresAt,
      consumedAt: null,
      hash: input.stateHash,
    });
  }

  async consumeState(input: {
    userId: string;
    stateHash: string;
    purpose: GitHubConnectionPurpose;
    now: string;
  }) {
    const row = this.states.find(
      (item) =>
        item.hash === input.stateHash &&
        item.userId === input.userId &&
        item.purpose === input.purpose &&
        item.consumedAt === null &&
        item.expiresAt > input.now,
    );
    if (!row) return null;
    row.consumedAt = input.now;
    return row;
  }

  async cleanupExpiredStates(now: string) {
    this.states = this.states.filter((item) => item.expiresAt >= now);
  }

  async upsertVerifiedConnection(userId: string, installation: GitHubInstallation, now: string) {
    this.upserts += 1;
    const connection: GitHubConnection = {
      id: crypto.randomUUID(),
      userId,
      installationId: installation.id,
      accountId: installation.account.id,
      accountLogin: installation.account.login,
      accountType: installation.account.type,
      repositorySelection: installation.repository_selection,
      permissions: installation.permissions,
      status: "active",
      connectedAt: now,
      lastVerifiedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    this.connections.push(connection);
    return connection;
  }

  async markDisconnected(userId: string, id: string, now: string) {
    const row = await this.findById(userId, id);
    if (row) {
      row.status = "disconnected";
      row.updatedAt = now;
    }
  }

  async touchVerifiedAt(userId: string, id: string, now: string) {
    const row = await this.findById(userId, id);
    if (row) {
      row.status = "active";
      row.lastVerifiedAt = now;
    }
  }
}

const installation: GitHubInstallation = {
  id: 987,
  account: { id: 123, login: "pedro-company", type: "Organization" },
  repository_selection: "selected",
  permissions: { metadata: "read", issues: "read", pull_requests: "read" },
};

function harness() {
  const store = new MemoryStore();
  let now = new Date("2026-08-10T12:00:00.000Z");
  const github = {
    installationUrl: (state: string) =>
      `https://github.com/apps/mael-test/installations/new?state=${state}`,
    userAuthorizationUrl: ({ state }: { state: string }) =>
      `https://github.com/login/oauth/authorize?state=${state}`,
    exchangeUserCode: vi.fn(async () => "temporary-user-token"),
    getAuthenticatedUser: vi.fn(async () => ({ id: 77, login: "pedro" })),
    listAccessibleInstallations: vi.fn(async () => [installation]),
    installationRequest: vi.fn(async () => ({ total_count: 1 })),
  };
  const service = new GitHubConnectionService(
    store,
    github as unknown as GitHubAppClient,
    () => now,
  );
  return {
    store,
    github,
    service,
    advance(minutes: number) {
      now = new Date(now.getTime() + minutes * 60_000);
    },
  };
}

async function beginAndPrepare(
  h: ReturnType<typeof harness>,
  userId = USER_A,
): Promise<{ installState: string; oauthState: string }> {
  const begin = await h.service.beginConnection(userId);
  const installState = new URL(begin.url).searchParams.get("state")!;
  const prepared = await h.service.prepareVerification({
    userId,
    rawState: installState,
    installationId: installation.id,
    setupAction: "install",
    redirectUri: "https://mael.example/integracoes/github/callback",
  });
  return {
    installState,
    oauthState: new URL(prepared.url).searchParams.get("state")!,
  };
}

describe("P5 — connection flow", () => {
  it("rejeita state inválido, expirado e replay", async () => {
    const invalid = harness();
    await expect(
      invalid.service.prepareVerification({
        userId: USER_A,
        rawState: "state-inexistente-com-entropia-suficiente",
        installationId: 987,
        setupAction: "install",
        redirectUri: "https://mael.example/integracoes/github/callback",
      }),
    ).rejects.toMatchObject({ code: "github_state_invalid" });

    const expired = harness();
    const begin = await expired.service.beginConnection(USER_A);
    expired.advance(16);
    await expect(
      expired.service.prepareVerification({
        userId: USER_A,
        rawState: new URL(begin.url).searchParams.get("state")!,
        installationId: 987,
        setupAction: "install",
        redirectUri: "https://mael.example/integracoes/github/callback",
      }),
    ).rejects.toMatchObject({ code: "github_state_invalid" });

    const replay = harness();
    const states = await beginAndPrepare(replay);
    await expect(
      replay.service.prepareVerification({
        userId: USER_A,
        rawState: states.installState,
        installationId: 987,
        setupAction: "install",
        redirectUri: "https://mael.example/integracoes/github/callback",
      }),
    ).rejects.toMatchObject({ code: "github_state_invalid" });
  });

  it("rejeita state de User A no callback autenticado como User B", async () => {
    const h = harness();
    const begin = await h.service.beginConnection(USER_A);
    await expect(
      h.service.prepareVerification({
        userId: USER_B,
        rawState: new URL(begin.url).searchParams.get("state")!,
        installationId: 987,
        setupAction: "install",
        redirectUri: "https://mael.example/integracoes/github/callback",
      }),
    ).rejects.toMatchObject({ code: "github_state_invalid" });
  });

  it("não persiste installation_id forjado ausente em /user/installations", async () => {
    const h = harness();
    const states = await beginAndPrepare(h);
    h.github.listAccessibleInstallations.mockResolvedValueOnce([{ ...installation, id: 111 }]);

    await expect(
      h.service.completeConnection({
        userId: USER_A,
        rawState: states.oauthState,
        code: "temporary-code",
        redirectUri: "https://mael.example/integracoes/github/callback",
      }),
    ).rejects.toMatchObject({ code: "github_installation_not_accessible" });
    expect(h.store.upserts).toBe(0);
  });

  it("falha de exchange ou /user nunca cria conexão", async () => {
    const exchange = harness();
    const first = await beginAndPrepare(exchange);
    exchange.github.exchangeUserCode.mockRejectedValueOnce(new Error("exchange failed"));
    await expect(
      exchange.service.completeConnection({
        userId: USER_A,
        rawState: first.oauthState,
        code: "bad-code",
        redirectUri: "https://mael.example/integracoes/github/callback",
      }),
    ).rejects.toThrow();
    expect(exchange.store.upserts).toBe(0);

    const identity = harness();
    const second = await beginAndPrepare(identity);
    identity.github.getAuthenticatedUser.mockRejectedValueOnce(new Error("user failed"));
    await expect(
      identity.service.completeConnection({
        userId: USER_A,
        rawState: second.oauthState,
        code: "code",
        redirectUri: "https://mael.example/integracoes/github/callback",
      }),
    ).rejects.toThrow();
    expect(identity.store.upserts).toBe(0);
  });

  it("somente verificação completa faz upsert e OAuth state é single-use", async () => {
    const h = harness();
    const states = await beginAndPrepare(h);
    const connection = await h.service.completeConnection({
      userId: USER_A,
      rawState: states.oauthState,
      code: "temporary-code",
      redirectUri: "https://mael.example/integracoes/github/callback",
    });

    expect(connection).toMatchObject({
      userId: USER_A,
      installationId: 987,
      accountLogin: "pedro-company",
      repositorySelection: "selected",
    });
    expect(h.store.upserts).toBe(1);
    expect(h.github.exchangeUserCode).toHaveBeenCalledWith(
      expect.objectContaining({ codeVerifier: expect.any(String) }),
    );

    await expect(
      h.service.completeConnection({
        userId: USER_A,
        rawState: states.oauthState,
        code: "temporary-code",
        redirectUri: "https://mael.example/integracoes/github/callback",
      }),
    ).rejects.toMatchObject({ code: "github_oauth_state_invalid" });
    expect(h.store.upserts).toBe(1);
  });
});
