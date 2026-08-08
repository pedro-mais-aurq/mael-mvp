# Mael

Assistente pessoal (tarefas, lembretes e cofre de senhas) com chat orientado
por IA. Backend em TanStack Start (SSR + server functions) sobre Supabase
(Postgres + Auth + RLS), frontend em React/TypeScript.

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
  mensagem do usuário → ChatService → LLMProvider (OpenRouter)
    → JSON {intent, args, assistant_reply}
    → Tool (TaskTool | ReminderTool | VaultSearchTool)
    → Service → Repository → Supabase
```

Pontos importantes do design:

- **RLS em todas as tabelas de usuário** (`tasks`, `reminders`,
  `vault_entries`, `profiles`, `chat_sessions`, `chat_messages`,
  `rate_limit_events`), sempre com `auth.uid() = user_id`. As server
  functions usam um cliente Supabase criado com o token do próprio usuário
  (`auth-middleware.ts`) — nunca a `service_role`.
- **`service_role` só existe em `client.server.ts`**, um módulo `.server`
  que não é importado por nenhuma rota, `.functions.ts` ou Tool. Não há
  bypass de RLS no caminho de tarefas/lembretes/cofre.
- **Cofre zero-knowledge**: a senha mestra nunca sai do navegador. A chave
  de criptografia é derivada localmente via PBKDF2 (`vault-crypto.ts`) e o
  servidor só guarda ciphertext + um verificador (hash da chave, não da
  senha). A IA nunca recebe senha em texto puro — `VaultSearchTool` só
  retorna metadados (nome/serviço/usuário).

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
2. Aplique as migrations em `supabase/migrations/` (nesta ordem, elas já
   estão numeradas cronologicamente):
   ```sh
   npx supabase login
   npx supabase link --project-ref <seu-project-ref>
   npx supabase db push
   ```
   Alternativamente, cole o conteúdo de cada arquivo `.sql` no SQL Editor
   do painel Supabase, na ordem dos nomes de arquivo.
3. Configure **Authentication** → Email/senha habilitado (é o método usado
   por `src/routes/auth.tsx`).
4. Confirme que RLS está habilitado em todas as tabelas (as migrations já
   fazem isso) e que as policies existem — veja a seção "Migrations"
   abaixo.
5. Configure as variáveis de ambiente (seção anterior) com a URL e as
   chaves do projeto criado.

### Migrations

- `20260805193055_..._.sql`: schema inicial (`profiles`, `chat_sessions`,
  `chat_messages`, `tasks`, `reminders`, `vault_entries`), RLS e policies
  `auth.uid() = user_id` em todas.
- `20260805200000_hardening.sql`: índices de performance, coluna
  `reminders.notified_at` (usada pelo scheduler) e a tabela
  `rate_limit_events` (com RLS e policy própria). É **aditiva e
  idempotente** — segura para rodar mais de uma vez ou sobre um banco já
  em produção.

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
npx tsc --noEmit     # typecheck
npm run lint         # eslint
```

## Build

```sh
npm run build
```

## Deploy

O projeto usa TanStack Start com SSR/server functions reais (autenticação,
chat, tools) — **não é uma SPA estática**, então GitHub Pages não é uma
opção adequada.

A configuração de build (`@lovable.dev/vite-tanstack-config`, via Nitro) já
gera saída para **Cloudflare Workers** por padrão
(`.output/server/wrangler.json` é gerado automaticamente no build, preset
`cloudflare-module`). Esse é o alvo de deploy documentado aqui porque:

- é compatível com SSR/server functions do TanStack Start;
- é o preset que a própria configuração compartilhada do projeto já usa,
  sem precisar de infraestrutura adicional.

Para publicar:

```sh
npm run build
npx wrangler deploy   # a partir de .output/server, com wrangler.json gerado
```

Configure os mesmos segredos de `.env` como variáveis de ambiente/secrets
do Worker (`wrangler secret put SUPABASE_SERVICE_ROLE_KEY`, etc.) — nunca
no `wrangler.json` versionado.

GitHub continua sendo o repositório de código-fonte e o gatilho de CI
(`.github/workflows/ci.yml`): install → lint → typecheck → test → build a
cada push/PR em `main`.

## Limitações conhecidas do MVP

| Funcionalidade | Status |
| --- | --- |
| Tarefas (criar/listar/concluir/excluir) — interface e IA | **Implementado** |
| Lembretes (criar/listar/ativar/excluir) — interface e IA | **Implementado** (persistência) |
| Notificação de lembrete vencido (push/e-mail/SMS) | **Não implementado.** O `ReminderScheduler` e a lógica de "o que está vencido" existem e são testados, mas nenhum gatilho externo (cron/Edge Function) está conectado ainda, e o `NotificationProvider` padrão só grava log. Persistir o lembrete e notificar o usuário são coisas diferentes: hoje só a persistência é real. |
| Cofre — criar/visualizar entradas, criptografia zero-knowledge | **Implementado** |
| Cofre — pesquisa de senha pela IA | **Implementado** (metadados apenas; a senha nunca é revelada pela IA) |
| Cofre — criação de senha pela IA | **Não implementado.** Criar uma senha exige cifrar no cliente com a chave derivada da senha mestra; isso só é seguro através do fluxo do Cofre na interface. Não existe (e não foi criado) um caminho em que a IA recebe a senha em texto puro. |
| Isolamento entre usuários (RLS) | **Implementado** em todas as tabelas de usuário |
| Rate limiting do chat | **Implementado**, mas depende da migration `hardening.sql` estar aplicada no banco remoto; até lá, falha aberto (não bloqueia) |
