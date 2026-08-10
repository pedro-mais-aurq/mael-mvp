-- Mael Alpha 0.1 — P5: GitHub App read-only.
-- Migration aditiva. Não altera Auth, Tasks, Chat, Cofre ou o legado de reminders.

CREATE TABLE public.github_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  installation_id BIGINT NOT NULL CHECK (installation_id > 0),
  github_account_id BIGINT NOT NULL CHECK (github_account_id > 0),
  github_account_login TEXT NOT NULL CHECK (char_length(github_account_login) BETWEEN 1 AND 100),
  github_account_type TEXT NOT NULL CHECK (github_account_type IN ('User', 'Organization')),
  repository_selection TEXT CHECK (
    repository_selection IS NULL OR repository_selection IN ('all', 'selected')
  ),
  permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disconnected')),
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT github_connections_user_installation_unique UNIQUE (user_id, installation_id)
);

CREATE INDEX idx_github_connections_user_status
  ON public.github_connections (user_id, status);

GRANT SELECT ON public.github_connections TO authenticated;
GRANT ALL ON public.github_connections TO service_role;
REVOKE INSERT, UPDATE, DELETE ON public.github_connections FROM authenticated;

ALTER TABLE public.github_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "github_connections_select_own"
  ON public.github_connections
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Material temporário do fluxo de instalação/OAuth. O browser não recebe acesso.
CREATE TABLE public.github_connection_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  state_hash TEXT NOT NULL UNIQUE CHECK (char_length(state_hash) = 64),
  purpose TEXT NOT NULL CHECK (purpose IN ('install', 'oauth_verify')),
  installation_id BIGINT CHECK (installation_id IS NULL OR installation_id > 0),
  pkce_verifier TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT github_connection_states_purpose_data_check CHECK (
    (purpose = 'install' AND installation_id IS NULL AND pkce_verifier IS NULL)
    OR
    (purpose = 'oauth_verify' AND installation_id IS NOT NULL AND pkce_verifier IS NOT NULL)
  )
);

CREATE INDEX idx_github_connection_states_expiry
  ON public.github_connection_states (expires_at)
  WHERE consumed_at IS NULL;

GRANT ALL ON public.github_connection_states TO service_role;
REVOKE ALL ON public.github_connection_states FROM authenticated, anon;

ALTER TABLE public.github_connection_states ENABLE ROW LEVEL SECURITY;

-- Nenhuma policy para authenticated/anon: somente o backend com service role
-- cria e consome states. O consumo usa UPDATE condicional (consumed_at IS NULL,
-- TTL, purpose e user_id), portanto callbacks concorrentes não aceitam replay.
