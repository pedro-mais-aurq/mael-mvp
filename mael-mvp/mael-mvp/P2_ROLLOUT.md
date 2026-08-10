# Mael Alpha 0.1 — Rollout e rollback da P2

Este documento faz parte da correção/validação da P2. Ele define o ciclo de
vida da ponte temporária `reminders → tasks` e evita que a tabela legada seja
tratada como uma segunda fonte permanente.

## Estado dos dados

- `public.tasks` é a fonte canônica após o deploy P2.
- `public.reminders` é um snapshot/legado pré-P2 para auditoria e recuperação
  controlada. Ela não é uma réplica viva do estado pós-P2.
- Não existe e não deve ser criado dual-write `tasks → reminders`.
- Reminders históricos com `notified_at` continuam migrados com
  `completed = false`. Eles podem aparecer como Tasks pendentes até uma decisão
  futura de produto.

## Risco temporário da trigger

A migration principal cria a trigger
`sync_legacy_reminder_to_task_trigger` para proteger a janela entre aplicar a
migration e publicar o código P2. Enquanto ela estiver ativa:

- INSERT/UPDATE em `reminders` pode criar ou sobrescrever campos da Task ligada;
- DELETE em `reminders` apaga a Task cujo `legacy_reminder_id` corresponde ao
  reminder excluído.

Por isso, a janela de coexistência deve ser curta e a migration de finalização
é obrigatória depois da validação do deploy.

## Atenção ao `supabase db push`

As migrations principal e de finalização não podem ser aplicadas juntas antes
do deploy P2. Se ambas estiverem pendentes, `supabase db push` tentará executar
as duas na ordem e encerrará a ponte cedo demais.

Use um destes fluxos seguros:

1. Entregas separadas: publique primeiro a migration principal e o código P2;
   somente após validar, publique a migration de finalização.
2. Aplicação seletiva: execute a migration principal pelo SQL Editor/staging,
   faça o deploy e a validação, e só então execute a migration de finalização.

Nunca aplique a migration de finalização antes de confirmar que nenhum runtime
P1 continua atendendo usuários.

## Ordem oficial de rollout

1. Fazer backup e usar primeiro um projeto Supabase local ou staging.
2. Aplicar `20260809010000_alpha_0_1_unify_tasks_reminders.sql`.
3. Validar backfill, idempotência e a trigger temporária.
4. Publicar o código P2.
5. Validar tarefas, lembretes, chat, cofre e autenticação.
6. Confirmar que nenhum runtime P1 continua ativo.
7. Aplicar `20260809020000_alpha_0_1_finalize_task_reminder_unification.sql`.
8. Confirmar que alterações em `reminders` não alteram mais `tasks`.

## Dataset mínimo no ambiente descartável

Antes da migration principal, crie três reminders para um usuário exclusivamente
de teste:

| Reminder | title | notes | active | notified_at |
| --- | --- | --- | --- | --- |
| A | Consulta | Dentista | true | NULL |
| B | Pagamento | opcional | false | NULL |
| C | Evento antigo | opcional | true | timestamp válido |

Depois da migration principal, cada reminder deve possuir exatamente uma Task
ligada por `legacy_reminder_id`, preservando `user_id`, título, descrição,
`remind_at`, `reminder_enabled`, `notified_at`, `created_at` e `updated_at`.

Reaplique o mecanismo somente em banco descartável. A contagem deve permanecer
em três Tasks migradas. Teste ainda INSERT, UPDATE e DELETE em `reminders`
enquanto a trigger estiver ativa; o DELETE é destrutivo e deve remover a Task
ligada durante essa janela.

Depois da migration de finalização, altere um reminder do dataset e confirme
que a Task correspondente não muda.

## Queries somente de leitura

```sql
SELECT count(*)
FROM public.reminders;

SELECT count(*)
FROM public.tasks
WHERE legacy_reminder_id IS NOT NULL;

SELECT r.id
FROM public.reminders r
LEFT JOIN public.tasks t
  ON t.legacy_reminder_id = r.id
WHERE t.id IS NULL;

SELECT legacy_reminder_id, count(*)
FROM public.tasks
WHERE legacy_reminder_id IS NOT NULL
GROUP BY legacy_reminder_id
HAVING count(*) > 1;
```

As duas últimas consultas devem retornar zero linhas imediatamente após o
backfill.

## Rollback

Rollback pós-P2 não é simplesmente republicar o código P1. Depois que usuários
alterarem `tasks`:

- Tasks removidas podem reaparecer como reminders antigos ao voltar à P1;
- `reminder_enabled` pode divergir de `reminders.active`;
- título, descrição, horário e `notified_at` podem divergir;
- mudanças pós-P2 não são copiadas de volta para `reminders`.

Um rollback deve restaurar backup/checkpoint conhecido ou executar um plano de
reconciliação explicitamente revisado. Nunca reative dual-write permanente para
tentar transformar `reminders` em espelho.

## Checklist visual pós-deploy

- `/tarefas` abre e lista Tasks comuns, com prazo e com lembrete;
- criar Task nas quatro combinações temporais funciona;
- silenciar/reativar lembrete preserva a Task;
- remover lembrete preserva a Task e limpa os campos de notificação;
- concluir/reabrir e excluir Task funcionam;
- `/lembretes` redireciona para `/tarefas`;
- Chat cria Task e reminder;
- Cofre e autenticação continuam funcionando.
