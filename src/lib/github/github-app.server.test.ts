import { createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  GITHUB_API_BASE_URL,
  GITHUB_API_VERSION,
  GitHubAppClient,
  GitHubApiError,
  createGitHubAppJwt,
  type GitHubAppConfig,
} from "./github-app.server";

function testConfig(): GitHubAppConfig {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return {
    appId: "123",
    slug: "mael-test",
    clientId: "Iv1.test-client",
    clientSecret: "fixture-not-a-production-secret",
    privateKey: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
  };
}

function decodeSegment(segment: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as Record<string, unknown>;
}

describe("P5 — GitHub App client", () => {
  it("assina App JWT RS256 com clock skew, issuer e expiração curta", () => {
    const config = testConfig();
    const now = new Date("2026-08-10T12:00:00.000Z");
    const jwt = createGitHubAppJwt(config, now);
    const [headerPart, payloadPart, signaturePart] = jwt.split(".");
    const header = decodeSegment(headerPart!);
    const payload = decodeSegment(payloadPart!);
    const publicKey = createPublicKey(config.privateKey);

    expect(header).toMatchObject({ alg: "RS256", typ: "JWT" });
    expect(payload["iss"]).toBe(config.clientId);
    expect(payload["iat"]).toBe(Math.floor(now.getTime() / 1000) - 60);
    expect(payload["exp"]).toBe(Math.floor(now.getTime() / 1000) + 540);
    expect((payload["exp"] as number) - Math.floor(now.getTime() / 1000)).toBeLessThanOrEqual(600);
    expect(
      verify(
        "RSA-SHA256",
        Buffer.from(`${headerPart}.${payloadPart}`),
        publicKey,
        Buffer.from(signaturePart!, "base64url"),
      ),
    ).toBe(true);
  });

  it("troca App JWT por token opaco no endpoint fixo e reutiliza somente memória", async () => {
    const config = testConfig();
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString();
      expect(url).toBe(`${GITHUB_API_BASE_URL}/app/installations/987/access_tokens`);
      expect(new Headers(init?.headers).get("x-github-api-version")).toBe(GITHUB_API_VERSION);
      expect(new Headers(init?.headers).get("authorization")).toMatch(/^Bearer /);
      expect(JSON.parse(String(init?.body))).toEqual({
        permissions: { metadata: "read", issues: "read", pull_requests: "read" },
      });
      return new Response(
        JSON.stringify({
          token: "opaque-variable-token-format",
          expires_at: "2026-08-10T13:00:00Z",
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      );
    });
    const client = new GitHubAppClient(
      config,
      fetchMock as typeof fetch,
      () => new Date("2026-08-10T12:00:00Z"),
    );

    await expect(client.getInstallationAccessToken(987)).resolves.toBe(
      "opaque-variable-token-format",
    );
    await expect(client.getInstallationAccessToken(987)).resolves.toBe(
      "opaque-variable-token-format",
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("usa somente hosts fixos para instalação, OAuth e API", async () => {
    const config = testConfig();
    const fetchMock = vi.fn();
    const client = new GitHubAppClient(config, fetchMock as unknown as typeof fetch);
    expect(client.installationUrl("state-value")).toMatch(
      /^https:\/\/github\.com\/apps\/mael-test\/installations\/new\?state=/,
    );
    expect(
      client.userAuthorizationUrl({
        state: "state-value",
        redirectUri: "https://mael.example/integracoes/github/callback",
        codeChallenge: "challenge",
      }),
    ).toMatch(/^https:\/\/github\.com\/login\/oauth\/authorize\?/);
    await expect(
      client.installationRequest(123, "//attacker.example/steal", "invalid_origin"),
    ).rejects.toThrow("root-relative");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("preserva somente metadados seguros de rate limit em respostas de erro", async () => {
    const client = new GitHubAppClient(
      testConfig(),
      vi.fn(
        async () =>
          new Response(JSON.stringify({ message: "rate limited" }), {
            status: 403,
            headers: {
              "x-ratelimit-remaining": "0",
              "x-ratelimit-reset": "1780000000",
              "retry-after": "60",
            },
          }),
      ) as unknown as typeof fetch,
    );

    const error = await client
      .exchangeUserCode({
        code: "fixture-code",
        redirectUri: "https://mael.example/integracoes/github/callback",
        codeVerifier: "fixture-verifier",
      })
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(GitHubApiError);
    expect(error).toMatchObject({
      status: 403,
      rateLimitRemaining: "0",
      rateLimitReset: "1780000000",
      retryAfter: "60",
    });
    expect(JSON.stringify(error)).not.toContain("fixture-code");
  });
});
