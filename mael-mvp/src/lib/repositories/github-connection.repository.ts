import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/integrations/supabase/types";
import type {
  GitHubAccountType,
  GitHubConnection,
  GitHubConnectionPurpose,
  GitHubConnectionState,
  GitHubInstallation,
} from "../github/types";

const CONNECTION_COLUMNS =
  "id, user_id, installation_id, github_account_id, github_account_login, github_account_type, repository_selection, permissions, status, connected_at, last_verified_at, created_at, updated_at";
const STATE_COLUMNS =
  "id, user_id, purpose, installation_id, pkce_verifier, expires_at, consumed_at";

type Client = SupabaseClient<Database>;

function connectionFrom(row: Record<string, unknown>): GitHubConnection {
  return {
    id: row["id"] as string,
    userId: row["user_id"] as string,
    installationId: row["installation_id"] as number,
    accountId: row["github_account_id"] as number,
    accountLogin: row["github_account_login"] as string,
    accountType: row["github_account_type"] as GitHubAccountType,
    repositorySelection: (row["repository_selection"] as "all" | "selected" | null) ?? null,
    permissions: (row["permissions"] as Record<string, string>) ?? {},
    status: row["status"] === "disconnected" ? "disconnected" : "active",
    connectedAt: row["connected_at"] as string,
    lastVerifiedAt: (row["last_verified_at"] as string | null) ?? null,
    createdAt: row["created_at"] as string,
    updatedAt: row["updated_at"] as string,
  };
}

function stateFrom(row: Record<string, unknown>): GitHubConnectionState {
  return {
    id: row["id"] as string,
    userId: row["user_id"] as string,
    purpose: row["purpose"] as GitHubConnectionPurpose,
    installationId: (row["installation_id"] as number | null) ?? null,
    pkceVerifier: (row["pkce_verifier"] as string | null) ?? null,
    expiresAt: row["expires_at"] as string,
    consumedAt: (row["consumed_at"] as string | null) ?? null,
  };
}

export class GitHubConnectionRepository {
  constructor(
    private readonly userClient: Client,
    private readonly adminClient: Client,
  ) {}

  async listByUser(userId: string): Promise<GitHubConnection[]> {
    const { data, error } = await this.userClient
      .from("github_connections")
      .select(CONNECTION_COLUMNS)
      .eq("user_id", userId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return (data ?? []).map((row) => connectionFrom(row as Record<string, unknown>));
  }

  async listActiveByUser(userId: string): Promise<GitHubConnection[]> {
    const rows = await this.listByUser(userId);
    return rows.filter((row) => row.status === "active");
  }

  async findById(userId: string, id: string): Promise<GitHubConnection | null> {
    const { data, error } = await this.userClient
      .from("github_connections")
      .select(CONNECTION_COLUMNS)
      .eq("id", id)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    return data ? connectionFrom(data as Record<string, unknown>) : null;
  }

  async createState(input: {
    userId: string;
    stateHash: string;
    purpose: GitHubConnectionPurpose;
    installationId?: number | null;
    pkceVerifier?: string | null;
    expiresAt: string;
  }): Promise<void> {
    const { error } = await this.adminClient.from("github_connection_states").insert({
      user_id: input.userId,
      state_hash: input.stateHash,
      purpose: input.purpose,
      installation_id: input.installationId ?? null,
      pkce_verifier: input.pkceVerifier ?? null,
      expires_at: input.expiresAt,
    });
    if (error) throw error;
  }

  async consumeState(input: {
    userId: string;
    stateHash: string;
    purpose: GitHubConnectionPurpose;
    now: string;
  }): Promise<GitHubConnectionState | null> {
    const { data, error } = await this.adminClient
      .from("github_connection_states")
      .update({ consumed_at: input.now })
      .eq("state_hash", input.stateHash)
      .eq("user_id", input.userId)
      .eq("purpose", input.purpose)
      .is("consumed_at", null)
      .gt("expires_at", input.now)
      .select(STATE_COLUMNS)
      .maybeSingle();
    if (error) throw error;
    return data ? stateFrom(data as Record<string, unknown>) : null;
  }

  async cleanupExpiredStates(now: string): Promise<void> {
    const { error } = await this.adminClient
      .from("github_connection_states")
      .delete()
      .lt("expires_at", now);
    if (error) throw error;
  }

  async upsertVerifiedConnection(
    userId: string,
    installation: GitHubInstallation,
    now: string,
  ): Promise<GitHubConnection> {
    const { data, error } = await this.adminClient
      .from("github_connections")
      .upsert(
        {
          user_id: userId,
          installation_id: installation.id,
          github_account_id: installation.account.id,
          github_account_login: installation.account.login,
          github_account_type: installation.account.type,
          repository_selection: installation.repository_selection,
          permissions: installation.permissions as Json,
          status: "active",
          connected_at: now,
          last_verified_at: now,
          updated_at: now,
        },
        { onConflict: "user_id,installation_id" },
      )
      .select(CONNECTION_COLUMNS)
      .single();
    if (error) throw error;
    return connectionFrom(data as Record<string, unknown>);
  }

  async markDisconnected(userId: string, id: string, now: string): Promise<void> {
    const { error } = await this.adminClient
      .from("github_connections")
      .update({ status: "disconnected", updated_at: now })
      .eq("id", id)
      .eq("user_id", userId);
    if (error) throw error;
  }

  async touchVerifiedAt(userId: string, id: string, now: string): Promise<void> {
    const { error } = await this.adminClient
      .from("github_connections")
      .update({ status: "active", last_verified_at: now, updated_at: now })
      .eq("id", id)
      .eq("user_id", userId);
    if (error) throw error;
  }
}
