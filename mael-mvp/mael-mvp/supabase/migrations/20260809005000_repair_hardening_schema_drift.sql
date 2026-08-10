-- Alpha 0.1 — reparo do schema drift da migration 20260805200000_hardening.
--
-- A migration original está registrada como aplicada no histórico remoto,
-- mas parte do schema correspondente não existe no banco.

CREATE INDEX IF NOT EXISTS idx_tasks_user_id
  ON public.tasks (user_id);

CREATE INDEX IF NOT EXISTS idx_tasks_due_date
  ON public.tasks (due_date)
  WHERE due_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_reminders_user_id
  ON public.reminders (user_id);

CREATE INDEX IF NOT EXISTS idx_reminders_remind_at_active
  ON public.reminders (remind_at)
  WHERE active = true;

ALTER TABLE public.reminders
  ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_reminders_due_unnotified
  ON public.reminders (remind_at)
  WHERE active = true
    AND notified_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_vault_entries_user_id
  ON public.vault_entries (user_id);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_id
  ON public.chat_sessions (user_id);

CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id
  ON public.chat_messages (session_id);

CREATE INDEX IF NOT EXISTS idx_chat_messages_user_id
  ON public.chat_messages (user_id);

CREATE TABLE IF NOT EXISTS public.rate_limit_events (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL
    REFERENCES auth.users(id)
    ON DELETE CASCADE,
  action TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_events_lookup
  ON public.rate_limit_events (user_id, action, created_at);

GRANT SELECT, INSERT
  ON public.rate_limit_events
  TO authenticated;

GRANT ALL
  ON public.rate_limit_events
  TO service_role;

ALTER TABLE public.rate_limit_events
  ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  CREATE POLICY "rate_limit_events_own"
    ON public.rate_limit_events
    FOR ALL
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;