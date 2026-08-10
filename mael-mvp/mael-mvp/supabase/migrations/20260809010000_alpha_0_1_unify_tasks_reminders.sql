-- Alpha 0.1 — P2: unificação de tarefas e lembretes.
--
-- `public.tasks` passa a ser a fonte canônica dos dois conceitos. A tabela
-- `public.reminders` permanece fisicamente no banco apenas durante a janela
-- de transição e auditoria. Esta migration não remove tabelas nem colunas e
-- não converte os campos legados due_date/due_time para due_at.

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS legacy_reminder_id UUID;

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS reminder_enabled BOOLEAN NOT NULL DEFAULT true;

-- Um reminder legado pode originar no máximo uma task. O índice parcial
-- mantém tasks comuns (legacy_reminder_id NULL) fora da regra de unicidade.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_legacy_reminder_id_unique
  ON public.tasks (legacy_reminder_id)
  WHERE legacy_reminder_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_due_reminders
  ON public.tasks (remind_at)
  WHERE remind_at IS NOT NULL
    AND reminder_enabled = true
    AND notified_at IS NULL
    AND completed = false;

-- Backfill inicial. O vínculo explícito preserva IDs independentes entre os
-- domínios e torna uma reexecução segura. Datas TIMESTAMPTZ são copiadas sem
-- conversão de timezone.
INSERT INTO public.tasks (
  user_id,
  title,
  description,
  category,
  priority,
  due_date,
  due_time,
  due_at,
  remind_at,
  notified_at,
  reminder_enabled,
  legacy_reminder_id,
  completed,
  completed_at,
  created_at,
  updated_at
)
SELECT
  reminder.user_id,
  reminder.title,
  reminder.notes,
  'geral',
  'media',
  NULL,
  NULL,
  NULL,
  reminder.remind_at,
  reminder.notified_at,
  reminder.active,
  reminder.id,
  false,
  NULL,
  reminder.created_at,
  reminder.updated_at
FROM public.reminders AS reminder
WHERE NOT EXISTS (
  SELECT 1
  FROM public.tasks AS task
  WHERE task.legacy_reminder_id = reminder.id
)
ON CONFLICT (legacy_reminder_id) WHERE legacy_reminder_id IS NOT NULL
DO NOTHING;

-- Compatibilidade temporária para a janela migration P2 -> deploy P2.
-- Uma versão P1 ainda ativa pode inserir ou atualizar reminders; a trigger
-- replica somente reminders -> tasks e nunca cria sincronização inversa.
CREATE OR REPLACE FUNCTION public.sync_legacy_reminder_to_task()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.tasks
    WHERE legacy_reminder_id = OLD.id;
    RETURN OLD;
  END IF;

  INSERT INTO public.tasks (
    user_id,
    title,
    description,
    category,
    priority,
    due_date,
    due_time,
    due_at,
    remind_at,
    notified_at,
    reminder_enabled,
    legacy_reminder_id,
    completed,
    completed_at,
    created_at,
    updated_at
  )
  VALUES (
    NEW.user_id,
    NEW.title,
    NEW.notes,
    'geral',
    'media',
    NULL,
    NULL,
    NULL,
    NEW.remind_at,
    NEW.notified_at,
    NEW.active,
    NEW.id,
    false,
    NULL,
    NEW.created_at,
    NEW.updated_at
  )
  ON CONFLICT (legacy_reminder_id) WHERE legacy_reminder_id IS NOT NULL
  DO UPDATE SET
    user_id = EXCLUDED.user_id,
    title = EXCLUDED.title,
    description = EXCLUDED.description,
    remind_at = EXCLUDED.remind_at,
    notified_at = EXCLUDED.notified_at,
    reminder_enabled = EXCLUDED.reminder_enabled,
    created_at = EXCLUDED.created_at,
    updated_at = EXCLUDED.updated_at;

  RETURN NEW;
END;
$$;

-- A função permanece SECURITY INVOKER (default). Assim, chamadas feitas por
-- usuários autenticados continuam sujeitas às policies RLS de tasks.
REVOKE ALL ON FUNCTION public.sync_legacy_reminder_to_task() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_legacy_reminder_to_task() TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_legacy_reminder_to_task() TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'sync_legacy_reminder_to_task_trigger'
      AND tgrelid = 'public.reminders'::regclass
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER sync_legacy_reminder_to_task_trigger
      AFTER INSERT OR UPDATE OR DELETE ON public.reminders
      FOR EACH ROW
      EXECUTE FUNCTION public.sync_legacy_reminder_to_task();
  END IF;
END;
$$;

-- Remoção futura (não executar na P2): a trigger, sua função, os índices
-- legados e public.reminders devem ser removidos apenas após o período de
-- auditoria e a confirmação de que nenhuma versão P1 continua ativa.
