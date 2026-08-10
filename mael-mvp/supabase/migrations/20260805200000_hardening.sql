-- Etapa 3/9/15/16 — consolidação do backend do Mael.
-- Migration 100% aditiva: nenhuma tabela é removida ou recriada, nenhum
-- dado existente é apagado. Segura para rodar sobre um banco em produção.

-- Índices (Etapa 3 "Banco") — as tabelas tinham FKs para user_id sem índice
-- dedicado; toda query do app filtra por user_id, então isso impacta direto
-- o plano de execução conforme o volume de linhas cresce.
CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON public.tasks (user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON public.tasks (due_date) WHERE due_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_reminders_user_id ON public.reminders (user_id);
CREATE INDEX IF NOT EXISTS idx_reminders_remind_at_active ON public.reminders (remind_at) WHERE active = true;

CREATE INDEX IF NOT EXISTS idx_vault_entries_user_id ON public.vault_entries (user_id);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_id ON public.chat_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id ON public.chat_messages (session_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_user_id ON public.chat_messages (user_id);

-- Etapa 9 (Scheduler) — coluna para o ReminderScheduler saber quais
-- lembretes vencidos já foram notificados. Nullable, default NULL: não
-- afeta nenhuma linha existente nem o contrato da API (o campo não é
-- exposto pelos endpoints atuais).
ALTER TABLE public.reminders ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_reminders_due_unnotified
  ON public.reminders (remind_at)
  WHERE active = true AND notified_at IS NULL;

-- Etapa 15 (Rate Limit) — tabela de apoio para `core/rate-limit.ts`.
-- Enquanto esta migration não roda em produção, `enforceRateLimit` detecta
-- a ausência da tabela e falha aberto (não bloqueia ninguém) — ver
-- src/lib/core/rate-limit.ts.
CREATE TABLE IF NOT EXISTS public.rate_limit_events (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rate_limit_events_lookup
  ON public.rate_limit_events (user_id, action, created_at);

GRANT SELECT, INSERT ON public.rate_limit_events TO authenticated;
GRANT ALL ON public.rate_limit_events TO service_role;
ALTER TABLE public.rate_limit_events ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "rate_limit_events_own" ON public.rate_limit_events
    FOR ALL TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Housekeeping opcional: eventos de rate limit não precisam viver para
-- sempre. Uma limpeza periódica pode ser feita via pg_cron:
--   SELECT cron.schedule('rate_limit_cleanup', '0 * * * *',
--     $$DELETE FROM public.rate_limit_events WHERE created_at < now() - interval '1 day'$$);
-- Não agendado automaticamente aqui porque a extensão pg_cron precisa ser
-- habilitada explicitamente pelo projeto Supabase.
