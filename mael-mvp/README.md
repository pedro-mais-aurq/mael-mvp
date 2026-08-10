# Mael

Assistente pessoal (tarefas, lembretes e cofre de senhas) com chat orientado
por IA. Backend em TanStack Start (SSR + server functions) sobre Supabase
(Postgres + Auth + RLS), frontend em React/TypeScript.

Este pacote é um **candidato de release da Alpha 0.1**, não uma versão estável
de produção. O checklist operacional está em
[P6_RELEASE_CHECKLIST.md](./P6_RELEASE_CHECKLIST.md).

Este projeto foi originalmente criado com [Lovable](https://lovable.dev) e
continua sincronizado com o editor Lovable; o fluxo de desenvolvimento local
abaixo funciona normalmente em paralelo a isso.

## Arquitetura resumida

```
Interface (React/TanStack Router)
  → auth-middleware (valida o Bearer token do usuário)
  → server functions (*.functions.ts)
  → Service (regras de negócio, validação, defaults)
  → Repository (único lugar que fala com o Supabase/PostgREST)
  → Supabase (Postgres + RLS)

Chat:
  mensagem do usuário → ChatService → ChatOrchestrator
    → LLMProvider (OpenRouter Chat Completions + Tool Calling)
    → ToolRegistry (whitelist + JSON Schema + Zod)
    → TaskTool | VaultSearchTool | GitHubTool → Service → Repository/API
    → resultado real retorna ao LLM via mensagem role=tool
    → resposta final é persistida pelo ChatService
```

Pontos importantes do design:

- **RLS em todas as tabelas de usuário** (`tasks`, `reminders`,
  `vault_entries`, `profiles`, `chat_sessions`, `chat_messages`,
  `rate_limit_events`, `github_connections`), sempre com
  `auth.uid() = user_id`. As server
  functions usam um cliente Supabase criado com o token do próprio usuário
  (`auth-middleware.ts`) — nunca a `service_role`.
- **`service_role` fica somente no servidor**, em `client.server.ts`. O
  caminho de tarefas/lembretes/cofre continua usando o token do usuário e RLS.
  A P5 usa o cliente administrativo somente depois de `requireSupabaseAuth`
  para consumir states opacos e persistir uma instalação GitHub já verificada;
  a flow table não é exposta ao navegador.
- **Autenticação Google-only pelo Supabase**: `/auth` chama diretamente
  `supabase.auth.signInWithOAuth({ provider: "google" })`. Não há formulário,
  signup ou login por email/senha e o antigo Lovable Auth foi removido. Na troca
  de UUID ou no logout, o `QueryClient` cancela consultas em voo e elimina todo
  cache autenticado antes de renderizar outro usuário.
- **Cofre zero-knowledge**: a senha mestra nunca sai do navegador. A chave
  de criptografia é derivada localmente via PBKDF2 (`vault-crypto.ts`) e o
  servidor só guarda ciphertext + um verificador (hash da chave, não da
  senha). A IA nunca recebe senha em texto puro — `VaultSearchTool` só
  retorna metadados (nome/serviço/usuário).
- **Tasks são a fonte canônica do Chat**: os tools registrados são
  `create_task`, `list_tasks`, `update_task`, `set_task_completed`,
  `delete_task` e `search_vault`. Um lembrete é criado por
  `create_task.remind_at`; `ReminderTool` permanece somente como adapter
  legado e não é exposto ao LLM.
- **Autorização do Chat é determinística por turno**: o backend deriva a
  whitelist, as fontes de leitura obrigatórias e os budgets exclusivamente da
  mensagem original do usuário. Saídas do banco e respostas intermediárias do
  modelo são dados não confiáveis e não ampliam essa autorização.
- **Resolução e payloads de mutação são controlados pelo backend**: filtros
  `query`, `status` e `limit` escolhidos pelo modelo servem apenas para
  descoberta; antes de atualizar, concluir, reabrir ou excluir, o backend
  consulta o conjunto canônico de Tasks e bloqueia zero, múltiplos ou
  candidatos truncados. Campos e valores de `create_task`/`update_task` também
  precisam corresponder ao pedido original. Timestamps são calculados a partir
  da mensagem, do relógio do backend e do timezone do usuário; valores
  divergentes são rejeitados. Em lotes, cada alvo e cada UUID podem ser
  consumidos apenas uma vez durante o turno.
- **Datas sem horário não recebem horário inventado**: expressões como
  “amanhã” são removidas do título, mas a mutação pede esclarecimento enquanto
  não houver horário suficiente para preencher `due_at`/`remind_at` com
  segurança. Adicionar ou remover lembrete de uma Task existente sempre usa
  `update_task`; não cria nem exclui a Task.
- **Hardening temporal residual da P4**: “9 da noite”, “2 da tarde” e “depois
  de amanhã” são interpretados no timezone do usuário; essas expressões são
  removidas do título e novos lembretes no passado são rejeitados. Prazo e
  lembrete com horários distintos no mesmo pedido, e horários diferentes por
  item de lote, continuam reservados para evolução posterior porque exigem
  substituir o binding temporal único por bindings independentes.
- **Escopo de leitura é fechado**: “mostre minhas tarefas” lista Tasks abertas
  (`status=open`) por padrão, sem `query` nem limite reduzido. O status
  `completed` ou `all` só é usado quando o pedido o determina. Consultas por
  dia incluem `due_at` e Tasks legadas com `due_date` correspondente, sem
  fabricar um timestamp. Uma consulta ao Cofre sem serviço/entrada explícito
  pede esclarecimento e não executa uma busca arbitrária.
- **GitHub é integração, não autenticação**: o login continua Google-only no
  Supabase. A P5 usa um GitHub App read-only, prova que o usuário autenticado
  tem acesso à instalação e persiste somente metadados/`installation_id`.
  App private key, client secret, App JWT, OAuth user token e installation
  token nunca chegam ao frontend nem são gravados no banco.
- **GitHub Tools são estritamente de leitura**:
  `github_list_repositories`, `github_get_repository`,
  `github_list_pull_requests` e `github_list_issues`. A base da API é fixa,
  owner/repo/account são vinculados ao pedido original e dados do GitHub são
  tratados como conteúdo não confiável, sem ampliar a ToolPolicy do turno.
- **Listagens GitHub têm paginação limitada e semântica explícita**: o backend
  busca páginas progressivamente, deduplica repositories entre instalações e
  aplica o `limit` ao conjunto global. `truncated=true` significa que a lista é
  incompleta; o `count` retornado nunca deve ser interpretado como total real.

## Requisitos

- Node.js 22+
- Uma conta/projeto no [Supabase](https://supabase.com)
- (Opcional) uma chave da [OpenRouter](https://openrouter.ai) para o chat
  com IA funcionar com respostas reais (sem ela, o chat cai no modo de
  fallback e nunca cria tarefas/lembretes por IA)

## Instalação

```sh
git clone <url-deste-repositorio>
cd mael
npm install
```

> O projeto tem `package-lock.json` (npm) e `bun.lock` (bun) lado a lado.
> **npm é o fluxo oficial** — usado pela CI e documentado aqui. Se preferir
> bun localmente, tudo bem, mas não misture os dois lockfiles no mesmo PR.

## Variáveis de ambiente

Copie `.env.example` para `.env` e preencha:

```env
SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
OPENROUTER_API_KEY=
GITHUB_APP_ID=
GITHUB_APP_SLUG=
GITHUB_APP_CLIENT_ID=
GITHUB_APP_CLIENT_SECRET=
GITHUB_APP_PRIVATE_KEY=
```

- `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY`: usadas no servidor (server
  functions, auth middleware).
- `SUPABASE_SERVICE_ROLE_KEY`: só para operações administrativas de
  servidor em `client.server.ts`. **Nunca** exponha no cliente, em logs ou
  no git.
- `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY`: mesmos valores de
  URL/chave publicável, injetados no bundle do navegador em build-time.
- `OPENROUTER_API_KEY`: chave do LLM. A variável legada `OPEN_ROUTER_API`
  ainda é aceita como fallback, mas prefira o nome novo.
- `GITHUB_APP_ID`, `GITHUB_APP_SLUG` e `GITHUB_APP_CLIENT_ID`: identificação
  server-side do GitHub App.
- `GITHUB_APP_CLIENT_SECRET` e `GITHUB_APP_PRIVATE_KEY`: secrets server-side
  usados no fluxo de verificação e na assinatura RS256. Para PEM multiline em
  Vercel, cole o conteúdo completo; em `.env` local também é aceito o formato
  com quebras representadas por `\\n`. Nunca crie variantes `VITE_GITHUB_*`.

`.env` nunca deve ser commitado — já está no `.gitignore`.

**Se você recebeu este repositório com um `.env` contendo credenciais
reais**: essas credenciais precisam ser rotacionadas antes de qualquer
deploy em produção, especialmente `SUPABASE_SERVICE_ROLE_KEY` e a chave da
OpenRouter, e também a senha do banco Postgres, se exposta em algum
`SUPABASE_SENHA`/string de conexão local. Gere novas chaves no painel do
Supabase e da OpenRouter e atualize apenas o `.env` local/secrets do
ambiente de deploy.

## Supabase

1. Crie um projeto em [supabase.com](https://supabase.com).
2. Aplique as migrations em `supabase/migrations/` na ordem cronológica.
   A P2 possui uma etapa principal e outra de finalização que exigem deploy e
   validação entre elas; por isso, não rode um único `db push` se ambas ainda
   estiverem pendentes. Consulte [P2_ROLLOUT.md](./P2_ROLLOUT.md) antes de
   aplicar a P2:
   ```sh
   npx supabase login
   npx supabase link --project-ref <seu-project-ref>
   npx supabase db push
   ```
   Alternativamente, cole o conteúdo de cada arquivo `.sql` no SQL Editor
   do painel Supabase, na ordem dos nomes de arquivo.
   Para a P5, primeiro confirme que todas as migrations anteriores já constam
   no histórico remoto e rode `npx supabase db push --dry-run`: o plano deve
   mostrar somente
   `20260810010000_alpha_0_1_github_app.sql`. Faça o `db push` real apenas
   depois de revisar esse plano e de concluir o rollout P4.
3. Configure o provider Google e as URLs de OAuth conforme a seção
   [Google OAuth (P4)](#google-oauth-p4). Não desative o provider Email antes
   de validar a preservação dos usuários existentes.
4. Confirme que RLS está habilitado em todas as tabelas (as migrations já
   fazem isso) e que as policies existem — veja a seção "Migrations"
   abaixo.
5. Configure as variáveis de ambiente (seção anterior) com a URL e as
   chaves do projeto criado.

### Google OAuth (P4)

O código não precisa de Client ID/Secret Google no `.env`. As credenciais ficam
somente no Google Cloud e no provider Google do Supabase; nunca crie
`VITE_GOOGLE_CLIENT_SECRET`.

1. No Supabase, abra **Authentication → Providers / Sign In → Google** e copie
   a URL de callback exibida para esse projeto. Não invente nem reutilize a URL
   de outro ambiente.
2. No Google Cloud, crie/configure o OAuth Client. Adicione as origens reais em
   **Authorized JavaScript origins** e a callback copiada do Supabase em
   **Authorized redirect URIs**.
3. Volte ao Supabase, habilite Google e informe o Client ID/Secret no provider.
4. Em **Authentication → URL Configuration**, configure a Site URL de produção
   e use URLs completas na **Redirect Allow List**, por exemplo
   `https://SEU_DOMINIO/auth` e, com a porta realmente impressa por
   `npm run dev`, `http://localhost:5173/auth`. Previews devem ser liberados
   somente quando forem realmente usados; não cadastre apenas `/auth`.
5. Mantenha **Allow new users to sign up** habilitado se novos usuários Google
   puderem criar conta. Isso é diferente de permitir signup por email.

Há duas URLs diferentes: a **Supabase Redirect URL** acima é a rota `/auth`
do Mael para a qual o Supabase devolve o navegador; a **Google OAuth callback
do Supabase** é a URL exibida pelo provider Google no Dashboard e deve ser
copiada exatamente para **Authorized redirect URIs** no Google Cloud. Não use
a rota do Mael como callback do Google nem invente essa URL.

#### Rollout seguro de identidade

1. Publique o código P4 com Google configurado, mas mantenha Email disponível
   temporariamente no Dashboard.
2. Teste um usuário Google novo: login, Profile ausente, criação de Task, Chat,
   configuração do Cofre, logout e novo login.
3. Para um usuário antigo de email, anote previamente `auth.users.id` e valide
   o login Google com o mesmo email verificado.
4. Confirme que o UUID após Google é exatamente o anterior e que Tasks, Chat,
   Cofre e Profile continuam acessíveis.
5. Teste `usuário A → logout → usuário B` no mesmo navegador e confirme que
   nenhum dado de A aparece durante a troca.
6. Se o UUID mudar, pare o rollout: não altere `user_id`, não relaxe RLS, não
   delete contas e não transfira o Cofre automaticamente. A conta exige uma
   estratégia explícita de identity linking/migração.
7. Se o email antigo for diferente do email da conta Google, não presuma
   identity linking: não faça `UPDATE` massivo de `user_id` e não migre dados
   automaticamente. Defina e teste uma estratégia explícita antes de qualquer
   alteração de identidade.
8. Somente após esses testes desabilite o provider Email no Supabase. Essa é
   uma ação manual de pós-validação; não desabilite signup global.

O provider Email só pode ser desativado depois de validar: Google novo; Google
para usuário antigo; mesmo UUID; Tasks, Chat e Cofre presentes; e troca
`usuário A → logout → usuário B` sem cache cruzado. Se qualquer UUID diferir,
mantenha Email habilitado.

### GitHub App (P5)

GitHub não é provider de login do Mael. O usuário entra com Google/Supabase e,
em `/integracoes`, conecta uma instalação separada de GitHub App. O fluxo usa
state aleatório armazenado apenas como SHA-256, TTL de 15 minutos, consumo
atômico e PKCE S256. O OAuth user token só prova acesso à instalação e é
descartado; depois disso o servidor usa App JWT e installation tokens
temporários em memória.

#### Registro manual do App

1. No GitHub, abra **Settings → Developer settings → GitHub Apps → New GitHub
   App** e escolha a conta pessoal ou organização responsável.
2. Preencha **GitHub App name** e use a URL real do Mael em **Homepage URL**.
3. Em **Callback URL**, cadastre exatamente
   `https://SEU_DOMINIO/integracoes/github/callback`.
4. Em **Setup URL**, cadastre exatamente
   `https://SEU_DOMINIO/integracoes/github/setup`. O Mael usa essa etapa e só
   então solicita autorização explícita do usuário com PKCE; não é necessário
   habilitar **Request user authorization (OAuth) during installation**.
5. Desabilite **Webhook active**. A P5 não possui endpoint nem webhook secret.
6. Em **Repository permissions**, conceda somente **Metadata: Read** (quando a
   UI o mostrar como implícito/obrigatório), **Issues: Read** e **Pull
   requests: Read**. Mantenha Contents e todas as permissões de escrita sem
   acesso.
7. Em **Where can this GitHub App be installed?**, use **Any account** para
   usuários externos. **Only on this account** é adequado apenas a um rollout
   privado inicial e limita instalações a essa conta.
8. Crie o App, use **Generate a private key** e armazene o PEM completo somente
   como `GITHUB_APP_PRIVATE_KEY` server-side. Copie App ID, slug, Client ID e
   gere o Client Secret necessário ao user authorization flow; nunca versione
   ou coloque esses valores no Cofre, no browser ou em variáveis `VITE_*`.

Para desenvolvimento, `npm run dev` usa por padrão
`http://localhost:5173`; confirme a URL/porta exibida pelo Vite e cadastre as
URLs completas equivalentes `/integracoes/github/setup` e
`/integracoes/github/callback` antes do teste local. Se a porta estiver
ocupada, use a porta real impressa — não presuma `5173`. Produção, Preview e
Development precisam de callback URLs compatíveis com o respectivo ambiente;
não compartilhe cegamente a configuração entre eles.

Após aplicar a migration P5, valide em `/integracoes`: instalar em repositórios
selecionados, concluir a autorização GitHub, listar a instalação, consultar
repos/PRs/issues pelo Chat, revalidar e desconectar localmente. “Desconectar do
Mael” remove o vínculo local, mas não desinstala o App no GitHub; “Gerenciar no
GitHub” abre a página oficial de instalações.

### Migrations

- `20260805193055_..._.sql`: schema inicial (`profiles`, `chat_sessions`,
  `chat_messages`, `tasks`, `reminders`, `vault_entries`), RLS e policies
  `auth.uid() = user_id` em todas.
- `20260805200000_hardening.sql`: índices de performance, coluna
  `reminders.notified_at` (usada pelo scheduler) e a tabela
  `rate_limit_events` (com RLS e policy própria). É **aditiva e
  idempotente** — segura para rodar mais de uma vez ou sobre um banco já
  em produção.
- `20260809010000_alpha_0_1_unify_tasks_reminders.sql`: migration principal
  da P2, com backfill para `tasks` e ponte temporária `reminders → tasks`.
- `20260809020000_alpha_0_1_finalize_task_reminder_unification.sql`: remove
  somente a trigger e a função temporárias. Deve ser aplicada apenas depois do
  deploy e da validação do código P2, conforme [P2_ROLLOUT.md](./P2_ROLLOUT.md).
- `20260810010000_alpha_0_1_github_app.sql`: migration aditiva P5; cria
  `github_connections` com SELECT RLS do próprio usuário e a flow table
  server-only `github_connection_states`. Não cria colunas de token ou secret.
  O procedimento seguro está em [P5_ROLLOUT.md](./P5_ROLLOUT.md).

Se o app em produção mostrar
`Could not find the table 'public.rate_limit_events' in the schema cache`,
significa que a migration `20260805200000_hardening.sql` ainda não foi
aplicada ao banco remoto (ou o schema cache do PostgREST não foi
recarregado — rode `NOTIFY pgrst, 'reload schema';` ou aguarde alguns
segundos após o `db push`). O rate limit é projetado para **falhar
aberto** nesse caso (não bloqueia o usuário), mas o objetivo de produção é
ter a tabela aplicada.

## Desenvolvimento local

```sh
npm run dev
```

## Testes

```sh
npm run test        # vitest run
npm run typecheck   # tsc --noEmit
npm run lint         # eslint
```

## Build

```sh
npm run build
```

## Deploy

O projeto usa TanStack Start com SSR/server functions reais (autenticação,
chat e tools), portanto **não é uma SPA estática** e GitHub Pages não é um
alvo adequado.

### Vercel (recomendado)

O projeto está preparado para deploy na **Vercel**. O
`@lovable.dev/vite-tanstack-config` está em versão compatível com a detecção
da plataforma e `vite.config.ts` fixa explicitamente o preset Nitro
`vercel`. A Vercel executa `npm run build` e publica o SSR/server functions
como Vercel Functions.

1. Importe este repositório na Vercel.
2. Mantenha **Framework Preset: TanStack Start** (detecção automática).
3. Use **Build Command: `npm run build`**.
4. Cadastre as variáveis abaixo em **Project → Settings → Environment Variables**
   para Production, Preview e Development conforme necessário:

```text
SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY
SUPABASE_SERVICE_ROLE_KEY
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
OPENROUTER_API_KEY
GITHUB_APP_ID
GITHUB_APP_SLUG
GITHUB_APP_CLIENT_ID
GITHUB_APP_CLIENT_SECRET
GITHUB_APP_PRIVATE_KEY
```

`VITE_SUPABASE_URL` deve receber o mesmo valor de `SUPABASE_URL`, e
`VITE_SUPABASE_PUBLISHABLE_KEY` deve receber o mesmo valor de
`SUPABASE_PUBLISHABLE_KEY`. As variáveis `VITE_*` são públicas e entram no
bundle do navegador. **Nunca** use `SUPABASE_SERVICE_ROLE_KEY` ou
`OPENROUTER_API_KEY` como variável `VITE_*`. Todas as cinco variáveis
`GITHUB_APP_*` são server-only; cadastre-as separadamente em Production,
Preview e Development somente quando as URLs daquele ambiente estiverem
registradas no GitHub App. Nunca use prefixo `VITE_` para elas.

Não é necessário `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, Wrangler ou
um workflow próprio de deploy. Com a integração Git da Vercel, pushes na branch
de produção geram novos deployments automaticamente.

GitHub continua sendo o repositório de código-fonte e executa o CI
(`.github/workflows/ci.yml`): install → lint → typecheck → test → build em
pushes/PRs para `main`.

## Limitações conhecidas do MVP

| Funcionalidade                                                 | Status                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tarefas (criar/listar/concluir/excluir) — interface e IA       | **Implementado**                                                                                                                                                                                                                                                                                                              |
| Lembretes (criar/listar/ativar/excluir) — interface e IA       | **Implementado** (persistência)                                                                                                                                                                                                                                                                                               |
| Notificação de lembrete vencido (push/e-mail/SMS)              | **Não implementado.** O `ReminderScheduler` e a lógica de "o que está vencido" existem e são testados, mas nenhum gatilho externo (cron/Edge Function) está conectado ainda, e o `NotificationProvider` padrão só grava log. Persistir o lembrete e notificar o usuário são coisas diferentes: hoje só a persistência é real. |
| Cofre — criar/visualizar entradas, criptografia zero-knowledge | **Implementado**                                                                                                                                                                                                                                                                                                              |
| Cofre — consulta de metadados pela IA                          | **Implementado**; a senha nunca é enviada ao modelo nem revelada pela IA                                                                                                                                                                                                                                                      |
| Cofre — criação de senha pela IA                               | **Não implementado.** Criar uma senha exige cifrar no cliente com a chave derivada da senha mestra; isso só é seguro através do fluxo do Cofre na interface. Não existe (e não foi criado) um caminho em que a IA recebe a senha em texto puro.                                                                               |
| Isolamento entre usuários (RLS)                                | **Implementado** em todas as tabelas de usuário                                                                                                                                                                                                                                                                               |
| Rate limiting do chat                                          | **Implementado**, mas depende da migration `hardening.sql` estar aplicada no banco remoto; até lá, falha aberto (não bloqueia)                                                                                                                                                                                                |
| Autenticação                                                   | **Google-only via Supabase.** Email/senha foi removido da aplicação; a desativação do provider Email no Dashboard ocorre manualmente após o rollout validar UUID e dados.                                                                                                                                                     |
| Limpeza do cache React Query no logout/troca de usuário        | **Implementado.** Consultas em voo são canceladas e o cache autenticado é removido antes de logout ou mudança de UUID.                                                                                                                                                                                                        |
| GitHub App — conexão e metadados read-only                     | **Implementado.** Múltiplas instalações, revalidação, desconexão local e leitura de repositories/PRs/issues; depende do registro manual do App, migration P5 e secrets server-side. Não há login GitHub, Contents, webhooks ou mutações.                                                                                      |
| GitHub — uninstall/suspend/repository-selection em tempo real  | **Não implementado.** Webhooks e reconciliação automática ficam para release posterior; a P5 oferece revalidação manual e trata 404 da instalação como desconectada.                                                                                                                                                          |
| GitHub — escrita, arquivos e bodies completos                  | **Não implementado por design.** A integração é read-only e retorna apenas metadados mínimos; não cria issue, comentário, merge, commit ou release.                                                                                                                                                                             |
| Bindings temporais independentes                               | **Limitado.** Pedidos como “prazo amanhã às 10 e lembrete às 9” ou horários diferentes por item de lote exigem bindings independentes e pedem esclarecimento.                                                                                                                                                                  |
| Compatibilidade de schema P1/P2                                | **Preservada deliberadamente.** A tabela `reminders`, `tasks.due_date` e `tasks.due_time` permanecem como legado; Tasks são a fonte canônica e `/lembretes` redireciona para `/tarefas`.                                                                                                                                          |
