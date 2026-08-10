import { NotFoundError, ValidationError } from "../core/exceptions";
import { logger } from "../core/logger";
import {
  GitHubApiError,
  GitHubOperationalError,
  type GitHubAppClient,
} from "../github/github-app.server";
import { createGitHubPkce, createGitHubState, hashGitHubState } from "../github/state.server";
import type {
  GitHubConnection,
  GitHubConnectionPurpose,
  GitHubConnectionState,
  GitHubInstallation,
} from "../github/types";

const STATE_TTL_MS = 15 * 60 * 1000;

export interface GitHubConnectionStore {
  listByUser(userId: string): Promise<GitHubConnection[]>;
  listActiveByUser(userId: string): Promise<GitHubConnection[]>;
  findById(userId: string, id: string): Promise<GitHubConnection | null>;
  createState(input: {
    userId: string;
    stateHash: string;
    purpose: GitHubConnectionPurpose;
    installationId?: number | null;
    pkceVerifier?: string | null;
    expiresAt: string;
  }): Promise<void>;
  consumeState(input: {
    userId: string;
    stateHash: string;
    purpose: GitHubConnectionPurpose;
    now: string;
  }): Promise<GitHubConnectionState | null>;
  cleanupExpiredStates(now: string): Promise<void>;
  upsertVerifiedConnection(
    userId: string,
    installation: GitHubInstallation,
    now: string,
  ): Promise<GitHubConnection>;
  markDisconnected(userId: string, id: string, now: string): Promise<void>;
  touchVerifiedAt(userId: string, id: string, now: string): Promise<void>;
}

function expiresAt(now: Date): string {
  return new Date(now.getTime() + STATE_TTL_MS).toISOString();
}

function validInstallation(value: GitHubInstallation | undefined): value is GitHubInstallation {
  return Boolean(
    value &&
    Number.isSafeInteger(value.id) &&
    value.id > 0 &&
    Number.isSafeInteger(value.account?.id) &&
    value.account.id > 0 &&
    /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,99})$/.test(value.account.login) &&
    (value.account.type === "User" || value.account.type === "Organization") &&
    (value.repository_selection === "all" ||
      value.repository_selection === "selected" ||
      value.repository_selection === null) &&
    value.permissions &&
    typeof value.permissions === "object",
  );
}

export class GitHubConnectionService {
  constructor(
    private readonly store: GitHubConnectionStore,
    private readonly github: GitHubAppClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  listConnections(userId: string): Promise<GitHubConnection[]> {
    return this.store.listByUser(userId);
  }

  async beginConnection(userId: string): Promise<{ url: string }> {
    const now = this.now();
    try {
      await this.store.cleanupExpiredStates(now.toISOString());
    } catch (error) {
      logger.warn("Cleanup oportunista de GitHub states indisponível", {
        route: "github.connection.begin",
        userId,
        error: error instanceof Error ? error.name : "cleanup_failed",
      });
    }
    const state = createGitHubState();
    await this.store.createState({
      userId,
      stateHash: state.hash,
      purpose: "install",
      expiresAt: expiresAt(now),
    });
    return { url: this.github.installationUrl(state.raw) };
  }

  async prepareVerification(input: {
    userId: string;
    rawState: string;
    installationId: number;
    setupAction: string | null;
    redirectUri: string;
  }): Promise<{ url: string }> {
    if (!Number.isSafeInteger(input.installationId) || input.installationId <= 0) {
      throw new ValidationError("Não foi possível validar a instalação do GitHub.");
    }
    if (input.setupAction && input.setupAction !== "install" && input.setupAction !== "update") {
      throw new ValidationError("A conexão do GitHub foi cancelada ou é inválida.");
    }
    const now = this.now();
    const consumed = await this.store.consumeState({
      userId: input.userId,
      stateHash: hashGitHubState(input.rawState),
      purpose: "install",
      now: now.toISOString(),
    });
    if (!consumed) {
      throw new GitHubOperationalError(
        "A solicitação de conexão expirou ou já foi utilizada.",
        "github_state_invalid",
      );
    }

    const oauthState = createGitHubState();
    const pkce = createGitHubPkce();
    await this.store.createState({
      userId: input.userId,
      stateHash: oauthState.hash,
      purpose: "oauth_verify",
      installationId: input.installationId,
      pkceVerifier: pkce.verifier,
      expiresAt: expiresAt(now),
    });
    return {
      url: this.github.userAuthorizationUrl({
        state: oauthState.raw,
        redirectUri: input.redirectUri,
        codeChallenge: pkce.challenge,
      }),
    };
  }

  async completeConnection(input: {
    userId: string;
    rawState: string;
    code: string;
    redirectUri: string;
  }): Promise<GitHubConnection> {
    const now = this.now();
    const consumed = await this.store.consumeState({
      userId: input.userId,
      stateHash: hashGitHubState(input.rawState),
      purpose: "oauth_verify",
      now: now.toISOString(),
    });
    if (!consumed?.installationId || !consumed.pkceVerifier) {
      throw new GitHubOperationalError(
        "A autorização do GitHub expirou ou já foi utilizada.",
        "github_oauth_state_invalid",
      );
    }

    const userAccessToken = await this.github.exchangeUserCode({
      code: input.code,
      redirectUri: input.redirectUri,
      codeVerifier: consumed.pkceVerifier,
    });
    const identity = await this.github.getAuthenticatedUser(userAccessToken);
    if (!Number.isSafeInteger(identity.id) || identity.id <= 0 || !identity.login) {
      throw new GitHubOperationalError(
        "Não foi possível validar sua identidade no GitHub.",
        "github_identity_invalid",
      );
    }
    const installations = await this.github.listAccessibleInstallations(userAccessToken);
    const installation = installations.find((item) => item.id === consumed.installationId);
    if (!validInstallation(installation)) {
      throw new GitHubOperationalError(
        "A conta GitHub autorizada não possui acesso à instalação selecionada.",
        "github_installation_not_accessible",
      );
    }

    // userAccessToken é deliberadamente descartado ao sair deste escopo.
    return this.store.upsertVerifiedConnection(input.userId, installation, now.toISOString());
  }

  async disconnect(userId: string, connectionId: string): Promise<void> {
    const connection = await this.store.findById(userId, connectionId);
    if (!connection) throw new NotFoundError("Conexão GitHub não encontrada.");
    await this.store.markDisconnected(userId, connectionId, this.now().toISOString());
  }

  async revalidate(userId: string, connectionId: string): Promise<void> {
    const connection = await this.store.findById(userId, connectionId);
    if (!connection) throw new NotFoundError("Conexão GitHub não encontrada.");
    try {
      await this.github.installationRequest<{ total_count?: number }>(
        connection.installationId,
        "/installation/repositories?per_page=1",
        "revalidate_installation",
      );
      await this.store.touchVerifiedAt(userId, connection.id, this.now().toISOString());
    } catch (error) {
      if (error instanceof GitHubApiError && error.status === 404) {
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
