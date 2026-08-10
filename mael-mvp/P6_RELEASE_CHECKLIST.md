# P6 — Checklist do candidato Alpha 0.1

Este checklist contém ações manuais por ambiente. Marque cada item somente
após validar o deployment real; o código não executa configuração externa nem
`supabase db push` automaticamente.

## Gates automatizados

- [ ] `npm ci`
- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run lint` sem erros
- [ ] `npm run build`

## Google

- [ ] Google Provider configurado no Supabase.
- [ ] Callback exibida pelo Supabase cadastrada no Google Cloud.
- [ ] Site URL e Redirect Allow List usam URLs completas e reais.
- [ ] Login local e login de produção funcionam.
- [ ] Usuário Google novo acessa Tasks, Chat e Cofre.
- [ ] Usuário antigo entra com o mesmo UUID e preserva Tasks, Chat e Cofre.
- [ ] Logout A → login B não revela cache ou dados de A.
- [ ] Somente após tudo acima, provider Email é desativado manualmente.

Se o UUID antigo mudar: interrompa o rollout, não desative Email e não migre
`user_id` automaticamente.

## GitHub

- [ ] GitHub App criada com Metadata, Issues e Pull Requests em read-only.
- [ ] Nenhuma permissão de escrita; webhook desabilitado.
- [ ] Homepage, Setup URL e Callback URL correspondem ao ambiente real.
- [ ] Todas as `GITHUB_APP_*` estão server-side; private key não está no bundle.
- [ ] Migration P5 aplicada depois de dry-run revisado.
- [ ] Conta pessoal e organização conectam.
- [ ] Seleção “only selected repositories” é respeitada.
- [ ] Repo privado selecionado aparece; repo não selecionado não aparece.
- [ ] List repositories, get repository, list PRs e list Issues funcionam.
- [ ] Desconectar, revalidar/reconectar e uninstall externo são tratados.

## Supabase

- [ ] Histórico remoto comparado com `supabase/migrations/`.
- [ ] `npx supabase migration list` revisado no ambiente vinculado.
- [ ] `npx supabase db push --dry-run` mostra somente migrations esperadas.
- [ ] Nenhum `DROP TABLE reminders`, `DROP COLUMN due_date` ou
  `DROP COLUMN due_time` está planejado.
- [ ] RLS e policies `auth.uid() = user_id` validadas nas tabelas de usuário.
- [ ] A migration de finalização P2 removeu a trigger/função temporária sem
  remover o snapshot legado.

## Vercel

- [ ] Build Command é `npm run build` e o preset SSR/TanStack está ativo.
- [ ] Variáveis Supabase, OpenRouter e GitHub estão configuradas por ambiente.
- [ ] Nenhuma secret usa prefixo `VITE_`.
- [ ] URLs Google/GitHub de Production e Preview correspondem ao domínio real.
- [ ] Logs de Functions não contêm tokens, cookies, keys ou ciphertext.

## Smoke test pós-deploy

- [ ] `/auth` abre e Google entra sem loop de callback.
- [ ] `/` carrega; Tasks listam, criam e concluem.
- [ ] Chat responde e Tool create/list Task usa dados reais.
- [ ] Cofre abre e não envia senha/ciphertext ao modelo.
- [ ] `/lembretes` redireciona para `/tarefas`.
- [ ] `/integracoes` abre; GitHub conecta e lista repos/PRs/issues.
- [ ] Resultados truncados são descritos como incompletos.
- [ ] Logout funciona e o teste A → B não cruza Tasks, Vault ou GitHub.
- [ ] Console não mostra erro, rejection, OAuth/refetch/Tool loop ou 401/403
  inesperado.
- [ ] Network não entrega service role, private key, client secret, App JWT,
  installation token ou user access token ao navegador.

## Limitações conhecidas

- GitHub é estritamente read-only, sem webhooks e sem reconciliação em tempo
  real de seleção de repositories.
- Bindings temporais independentes para prazo/lembrete ou itens de lote ainda
  exigem esclarecimento.
- `reminders`, `due_date` e `due_time` permanecem como legado compatível; Tasks
  são a fonte canônica.
- Scheduler não possui cron/locking de produção e o provider de notificação
  padrão não entrega push, email ou SMS.
