import { createPrivateKey, sign as signBytes } from "node:crypto";

import { AppError } from "../core/exceptions";
import type { GitHubInstallation, GitHubUserIdentity } from "./types";

export const GITHUB_API_BASE_URL = "https://api.github.com";
export const GITHUB_WEB_BASE_URL = "https://github.com";
export const GITHUB_API_VERSION = "2026-03-10";
const REQUEST_TIMEOUT_MS = 10_000;

export interface GitHubAppConfig {
  appId: string;
  slug: string;
  clientId: string;
  clientSecret: string;
  privateKey: string;
}

export class GitHubOperationalError extends AppError {
  constructor(message: string, code: string) {
    super(message, code);
    this.name = "GitHubOperationalError";
  }
}

export class GitHubApiError extends Error {
  constructor(
    readonly status: number,
    readonly operation: string,
    readonly rateLimitReset: string | null = null,
    readonly rateLimitRemaining: string | null = null,
    readonly retryAfter: string | null = null,
  ) {
    super(`GitHub request failed (${operation}, ${status}).`);
    this.name = "GitHubApiError";
  }
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value)
    throw new GitHubOperationalError(
      "GitHub ainda não está configurado neste ambiente.",
      "github_not_configured",
    );
  return value;
}

export function loadGitHubAppConfig(): GitHubAppConfig {
  const appId = requiredEnvironment("GITHUB_APP_ID");
  if (!/^\d+$/.test(appId)) {
    throw new GitHubOperationalError(
      "GitHub ainda não está configurado neste ambiente.",
      "github_not_configured",
    );
  }
  const slug = requiredEnvironment("GITHUB_APP_SLUG");
  if (!/^[a-z0-9](?:[a-z0-9-]{0,99})$/.test(slug)) {
    throw new GitHubOperationalError(
      "GitHub ainda não está configurado neste ambiente.",
      "github_not_configured",
    );
  }
  return {
    appId,
    slug,
    clientId: requiredEnvironment("GITHUB_APP_CLIENT_ID"),
    clientSecret: requiredEnvironment("GITHUB_APP_CLIENT_SECRET"),
    privateKey: requiredEnvironment("GITHUB_APP_PRIVATE_KEY").replace(/\\n/g, "\n"),
  };
}

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function createGitHubAppJwt(
  config: Pick<GitHubAppConfig, "clientId" | "privateKey">,
  now = new Date(),
): string {
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const header = encodeJson({ alg: "RS256", typ: "JWT" });
  const payload = encodeJson({
    iat: nowSeconds - 60,
    exp: nowSeconds + 9 * 60,
    iss: config.clientId,
  });
  const unsigned = `${header}.${payload}`;
  const key = createPrivateKey(config.privateKey);
  const signature = signBytes("RSA-SHA256", Buffer.from(unsigned, "utf8"), key).toString(
    "base64url",
  );
  return `${unsigned}.${signature}`;
}

interface InstallationTokenCacheEntry {
  token: string;
  expiresAt: number;
}

export class GitHubAppClient {
  private readonly installationTokens = new Map<number, InstallationTokenCacheEntry>();

  constructor(
    readonly config: GitHubAppConfig,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  installationUrl(state: string): string {
    const url = new URL(`/apps/${this.config.slug}/installations/new`, GITHUB_WEB_BASE_URL);
    url.searchParams.set("state", state);
    return url.toString();
  }

  userAuthorizationUrl(input: {
    state: string;
    redirectUri: string;
    codeChallenge: string;
  }): string {
    const url = new URL("/login/oauth/authorize", GITHUB_WEB_BASE_URL);
    url.searchParams.set("client_id", this.config.clientId);
    url.searchParams.set("redirect_uri", input.redirectUri);
    url.searchParams.set("state", input.state);
    url.searchParams.set("code_challenge", input.codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    return url.toString();
  }

  async exchangeUserCode(input: {
    code: string;
    redirectUri: string;
    codeVerifier: string;
  }): Promise<string> {
    const payload = await this.requestJson<{ access_token?: unknown; error?: unknown }>(
      new URL("/login/oauth/access_token", GITHUB_WEB_BASE_URL),
      {
        operation: "oauth_exchange",
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
          code: input.code,
          redirect_uri: input.redirectUri,
          code_verifier: input.codeVerifier,
        }),
      },
    );
    if (typeof payload.access_token !== "string" || !payload.access_token) {
      throw new GitHubApiError(401, "oauth_exchange");
    }
    return payload.access_token;
  }

  getAuthenticatedUser(userAccessToken: string): Promise<GitHubUserIdentity> {
    return this.githubApi<GitHubUserIdentity>("/user", {
      operation: "get_authenticated_user",
      token: userAccessToken,
    });
  }

  async listAccessibleInstallations(userAccessToken: string): Promise<GitHubInstallation[]> {
    const installations: GitHubInstallation[] = [];
    for (let page = 1; page <= 10; page += 1) {
      const result = await this.githubApi<{ installations?: GitHubInstallation[] }>(
        `/user/installations?per_page=100&page=${page}`,
        { operation: "list_user_installations", token: userAccessToken },
      );
      const batch = Array.isArray(result.installations) ? result.installations : [];
      installations.push(...batch);
      if (batch.length < 100) break;
    }
    return installations;
  }

  async getInstallationAccessToken(installationId: number): Promise<string> {
    const cached = this.installationTokens.get(installationId);
    if (cached && cached.expiresAt - this.now().getTime() > 60_000) return cached.token;

    const appJwt = createGitHubAppJwt(this.config, this.now());
    const result = await this.githubApi<{ token?: unknown; expires_at?: unknown }>(
      `/app/installations/${installationId}/access_tokens`,
      {
        operation: "create_installation_token",
        method: "POST",
        token: appJwt,
        body: JSON.stringify({
          permissions: {
            metadata: "read",
            issues: "read",
            pull_requests: "read",
          },
        }),
      },
    );
    if (typeof result.token !== "string" || !result.token) {
      throw new GitHubApiError(502, "create_installation_token");
    }
    const expiresAt =
      typeof result.expires_at === "string" ? Date.parse(result.expires_at) : Number.NaN;
    if (Number.isFinite(expiresAt)) {
      this.installationTokens.set(installationId, { token: result.token, expiresAt });
    }
    return result.token;
  }

  async installationRequest<T>(
    installationId: number,
    path: string,
    operation: string,
  ): Promise<T> {
    this.githubApiUrl(path);
    const token = await this.getInstallationAccessToken(installationId);
    return this.githubApi<T>(path, { operation, token });
  }

  private githubApiUrl(path: string): URL {
    if (!path.startsWith("/") || path.startsWith("//")) {
      throw new Error("GitHub API path must be a root-relative path.");
    }
    const url = new URL(path, GITHUB_API_BASE_URL);
    if (url.origin !== new URL(GITHUB_API_BASE_URL).origin) {
      throw new Error("GitHub API origin must be fixed.");
    }
    return url;
  }

  private githubApi<T>(
    path: string,
    input: { operation: string; token: string; method?: "GET" | "POST"; body?: string },
  ): Promise<T> {
    return this.requestJson<T>(this.githubApiUrl(path), {
      operation: input.operation,
      method: input.method ?? "GET",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${input.token}`,
        "Content-Type": "application/json",
        "User-Agent": "Mael-GitHub-App",
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
      },
      body: input.body,
    });
  }

  private async requestJson<T>(
    url: URL,
    input: {
      operation: string;
      method: "GET" | "POST";
      headers: Record<string, string>;
      body?: string | undefined;
    },
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await this.fetchImpl(url, {
        method: input.method,
        headers: input.headers,
        ...(input.body !== undefined ? { body: input.body } : {}),
        redirect: "error",
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new GitHubApiError(
          response.status,
          input.operation,
          response.headers.get("x-ratelimit-reset"),
          response.headers.get("x-ratelimit-remaining"),
          response.headers.get("retry-after"),
        );
      }
      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof GitHubApiError) throw error;
      throw new GitHubApiError(0, input.operation);
    } finally {
      clearTimeout(timeout);
    }
  }
}
