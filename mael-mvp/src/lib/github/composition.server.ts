import type { SupabaseClient } from "@supabase/supabase-js";

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";
import { GitHubConnectionRepository } from "../repositories/github-connection.repository";
import { GitHubConnectionService } from "../services/github-connection.service";
import { GitHubService } from "../services/github.service";
import { GitHubAppClient, loadGitHubAppConfig } from "./github-app.server";

export function buildGitHubServices(userClient: SupabaseClient<Database>) {
  const repository = new GitHubConnectionRepository(userClient, supabaseAdmin);
  const client = new GitHubAppClient(loadGitHubAppConfig());
  return {
    connectionService: new GitHubConnectionService(repository, client),
    githubService: new GitHubService(repository, client),
  };
}
