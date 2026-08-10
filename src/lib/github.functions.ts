import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { AppError, handleServiceError } from "./core/exceptions";
import { enforceRateLimit } from "./core/rate-limit";
import type { GitHubConnection } from "./github/types";

export interface GitHubConnectionDTO {
  id: string;
  account_login: string;
  account_type: "User" | "Organization";
  repository_selection: "all" | "selected" | null;
  status: "active" | "disconnected";
  connected_at: string;
  last_verified_at: string | null;
  manage_url: string;
}

function publicConnection(connection: GitHubConnection): GitHubConnectionDTO {
  return {
    id: connection.id,
    account_login: connection.accountLogin,
    account_type: connection.accountType,
    repository_selection: connection.repositorySelection,
    status: connection.status,
    connected_at: connection.connectedAt,
    last_verified_at: connection.lastVerifiedAt,
    manage_url: `https://github.com/settings/installations/${connection.installationId}`,
  };
}

function githubCallbackUrl(): string {
  const request = getRequest();
  if (!request?.url) {
    throw new AppError(
      "Não foi possível determinar a URL de callback do GitHub.",
      "github_callback_unavailable",
    );
  }
  return new URL("/integracoes/github/callback", new URL(request.url).origin).toString();
}

async function services(supabase: SupabaseClient<Database>) {
  const { buildGitHubServices } = await import("./github/composition.server");
  return buildGitHubServices(supabase);
}

export const listGitHubConnections = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<GitHubConnectionDTO[]> => {
    const supabase = context.supabase as unknown as SupabaseClient<Database>;
    try {
      const { connectionService } = await services(supabase);
      const connections = await connectionService.listConnections(context.userId);
      return connections.map(publicConnection);
    } catch (error) {
      throw handleServiceError(error, {
        route: "github.listConnections",
        userId: context.userId,
      });
    }
  });

export const beginGitHubConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ url: string }> => {
    const supabase = context.supabase as unknown as SupabaseClient<Database>;
    try {
      await enforceRateLimit(supabase, context.userId, {
        action: "github_begin_connection",
        limit: 10,
        windowSeconds: 900,
      });
      const { connectionService } = await services(supabase);
      return await connectionService.beginConnection(context.userId);
    } catch (error) {
      throw handleServiceError(error, {
        route: "github.beginConnection",
        userId: context.userId,
      });
    }
  });

export const prepareGitHubVerification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data) =>
    z
      .object({
        state: z.string().min(20).max(512),
        installation_id: z.coerce.number().int().positive().safe(),
        setup_action: z.string().max(40).nullish(),
      })
      .strict()
      .parse(data),
  )
  .handler(async ({ data, context }): Promise<{ url: string }> => {
    const supabase = context.supabase as unknown as SupabaseClient<Database>;
    try {
      const { connectionService } = await services(supabase);
      return await connectionService.prepareVerification({
        userId: context.userId,
        rawState: data.state,
        installationId: data.installation_id,
        setupAction: data.setup_action ?? null,
        redirectUri: githubCallbackUrl(),
      });
    } catch (error) {
      throw handleServiceError(error, {
        route: "github.prepareVerification",
        userId: context.userId,
      });
    }
  });

export const completeGitHubConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data) =>
    z
      .object({
        state: z.string().min(20).max(512),
        code: z.string().min(1).max(1024),
      })
      .strict()
      .parse(data),
  )
  .handler(async ({ data, context }): Promise<{ connection: GitHubConnectionDTO }> => {
    const supabase = context.supabase as unknown as SupabaseClient<Database>;
    try {
      const { connectionService } = await services(supabase);
      const connection = await connectionService.completeConnection({
        userId: context.userId,
        rawState: data.state,
        code: data.code,
        redirectUri: githubCallbackUrl(),
      });
      return { connection: publicConnection(connection) };
    } catch (error) {
      throw handleServiceError(error, {
        route: "github.completeConnection",
        userId: context.userId,
      });
    }
  });

export const disconnectGitHubConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data) => z.object({ connection_id: z.string().uuid() }).strict().parse(data))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const supabase = context.supabase as unknown as SupabaseClient<Database>;
    try {
      const { connectionService } = await services(supabase);
      await connectionService.disconnect(context.userId, data.connection_id);
      return { ok: true };
    } catch (error) {
      throw handleServiceError(error, {
        route: "github.disconnectConnection",
        userId: context.userId,
      });
    }
  });

export const revalidateGitHubConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data) => z.object({ connection_id: z.string().uuid() }).strict().parse(data))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const supabase = context.supabase as unknown as SupabaseClient<Database>;
    try {
      await enforceRateLimit(supabase, context.userId, {
        action: "github_revalidate_connection",
        limit: 20,
        windowSeconds: 900,
      });
      const { connectionService } = await services(supabase);
      await connectionService.revalidate(context.userId, data.connection_id);
      return { ok: true };
    } catch (error) {
      throw handleServiceError(error, {
        route: "github.revalidateConnection",
        userId: context.userId,
      });
    }
  });
