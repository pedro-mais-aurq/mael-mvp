-- Alpha 0.1 — P1: Fundação de Dados e Compatibilidade.
--
-- Migration 100% aditiva. Nenhuma tabela é recriada, nenhuma coluna é
-- removida, nenhum dado é apagado. Prepara `profiles` e `tasks` para a
-- futura unificação de tasks/reminders (P2) sem alterar o comportamento
-- do MVP atual: `due_date`/`due_time` continuam sendo a fonte legada e
-- `reminders` continua sendo a fonte oficial dos lembretes durante a P1.
--
-- Importante: os campos novos nascem NULL para todas as linhas existentes.
-- Não há backfill de `due_date`/`due_time` para `due_at`, pois o MVP nunca
-- armazenou o timezone do usuário — converter agora inventaria informação
-- temporal que o sistema antigo não possui.

-- profiles.timezone — permanece NULL até que o timezone real do usuário
-- seja capturado em uma fase posterior. Nenhum default artificial (ex.:
-- 'UTC' ou 'America/Sao_Paulo') é aplicado a usuários existentes.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS timezone TEXT;

-- tasks.due_at / remind_at / notified_at — coexistem temporariamente com
-- due_date/due_time. Nenhuma tela ou service legado é obrigado a
-- preenchê-los nesta fase.
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS due_at TIMESTAMPTZ;

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS remind_at TIMESTAMPTZ;

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ;

-- Índices que preparam as consultas futuras (P2) sem afetar os planos de
-- execução atuais, já que devem ficar vazios até que a unificação comece
-- a popular estes campos.
CREATE INDEX IF NOT EXISTS idx_tasks_due_at
  ON public.tasks (due_at)
  WHERE due_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_remind_at_unnotified
  ON public.tasks (remind_at)
  WHERE remind_at IS NOT NULL
    AND notified_at IS NULL
    AND completed = false;

-- Índices legados (idx_tasks_due_date, idx_reminders_remind_at_active,
-- idx_reminders_due_unnotified) permanecem intactos — não são tocados por
-- esta migration.
--
-- RLS: `profiles` e `tasks` já possuem RLS habilitado e a policy
-- "auth.uid() = id / user_id" (ver 20260805193055_...sql). Colunas novas
-- em uma tabela existente herdam a policy da tabela automaticamente — não
-- é necessário (nem desejável) recriar policies aqui.
