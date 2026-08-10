import { createHash, randomBytes } from "node:crypto";

const STATE_BYTES = 32;
const PKCE_BYTES = 32;

function base64Url(value: Buffer): string {
  return value.toString("base64url");
}

export function hashGitHubState(rawState: string): string {
  return createHash("sha256").update(rawState, "utf8").digest("hex");
}

export function createGitHubState(): { raw: string; hash: string } {
  const raw = base64Url(randomBytes(STATE_BYTES));
  return { raw, hash: hashGitHubState(raw) };
}

export function createGitHubPkce(): { verifier: string; challenge: string } {
  const verifier = base64Url(randomBytes(PKCE_BYTES));
  const challenge = base64Url(createHash("sha256").update(verifier, "utf8").digest());
  return { verifier, challenge };
}
