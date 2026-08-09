-- Alpha 0.1 — P2: finalização da ponte temporária reminders -> tasks.
--
-- APLICAR SOMENTE DEPOIS de:
--   1. aplicar a migration principal 20260809010000;
--   2. validar o backfill;
--   3. publicar e validar o código P2;
--   4. confirmar que nenhum runtime P1 continua ativo.
--
-- Esta migration encerra o período de coexistência. `public.reminders`
-- permanece como snapshot/legado de auditoria, mas deixa de poder alterar a
-- fonte canônica `public.tasks`.

DROP TRIGGER IF EXISTS sync_legacy_reminder_to_task_trigger
  ON public.reminders;

DROP FUNCTION IF EXISTS public.sync_legacy_reminder_to_task();

-- Deliberadamente preservados:
--   public.reminders
--   public.tasks.legacy_reminder_id
--   public.tasks.due_date
--   public.tasks.due_time
