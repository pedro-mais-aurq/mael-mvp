# P5 — Rollout GitHub App read-only

A P5 é aditiva, mas o rollout depende da validação manual da P4 e de uma
configuração externa coerente entre Supabase, GitHub e Vercel. GitHub continua
sendo integração; Google/Supabase continua sendo a única autenticação.

## Pré-requisito P4

Antes de liberar GitHub em produção:

1. confirme que `/auth?error=...` e `/auth#error=...` mostram erro seguro;
2. mantenha URLs completas na Redirect Allow List do Supabase, como
   `https://SEU_DOMINIO/auth`;
3. diferencie essa URL da callback Google fornecida pelo próprio Supabase;
4. valide login Google novo e login de usuário antigo com o mesmo email;
5. confirme que o UUID foi preservado e que Tasks, Chat e Cofre permanecem;
6. teste `usuário A → logout → usuário B` sem dados em cache;
7. se o UUID mudar, ou se os emails antigo e Google forem diferentes, pare:
   não desative Email, não migre `user_id` e não execute UPDATE massivo;
8. desative o provider Email manualmente apenas quando todos os itens acima
   estiverem verdes.

## Migration Supabase

1. Linke o projeto correto e confirme o histórico das migrations P1–P4.
2. Rode apenas a simulação:

   ```sh
   npx supabase db push --dry-run
   ```

3. O plano adicional deve conter somente
   `20260810010000_alpha_0_1_github_app.sql`. Se outra migration aparecer,
   interrompa o rollout e reconcilie o histórico.
4. Revise que a migration apenas cria `github_connections` e
   `github_connection_states`; ela não altera Tasks, reminders, Cofre, Chat ou
   Auth.
5. Só depois da revisão aplique:

   ```sh
   npx supabase db push
   ```

6. Confirme RLS em `github_connections`, SELECT próprio por
   `auth.uid() = user_id`, ausência de INSERT/UPDATE/DELETE para
   `authenticated` e ausência de acesso browser à flow table.

## Registro do GitHub App

1. Acesse **Settings → Developer settings → GitHub Apps → New GitHub App**.
2. Defina nome e Homepage URL reais.
3. Use `https://SEU_DOMINIO/integracoes/github/setup` como Setup URL.
4. Use `https://SEU_DOMINIO/integracoes/github/callback` como Callback URL.
5. Deixe Webhook desabilitado.
6. Conceda somente Metadata: Read, Issues: Read e Pull requests: Read.
7. Não conceda Contents nem qualquer permissão de escrita.
8. Use Any account para usuários externos, ou Only on this account apenas no
   rollout privado inicial.
9. Gere private key e Client Secret e trate ambos como secrets server-side.

## Variáveis Vercel

Cadastre, sem prefixo `VITE_`, em cada ambiente realmente configurado:

```text
GITHUB_APP_ID
GITHUB_APP_SLUG
GITHUB_APP_CLIENT_ID
GITHUB_APP_CLIENT_SECRET
GITHUB_APP_PRIVATE_KEY
```

Production, Preview e Development precisam de URLs GitHub compatíveis com o
próprio domínio. Não copie secrets/configuração entre ambientes sem registrar
as callbacks correspondentes. Para local, confirme a porta mostrada por
`npm run dev` (o padrão é 5173) e use URLs completas.

## Validação funcional

1. Entre no Mael via Google e abra `/integracoes`.
2. Conecte o GitHub App e selecione um ou mais repositórios.
3. Conclua o setup e a autorização GitHub; o callback deve voltar sem secrets
   na URL.
4. Confirme a instalação ativa e use “Revalidar”.
5. No Chat, liste repositórios, detalhe um repo e liste PRs/issues.
6. Tente outro owner/repo e confirme bloqueio de escopo.
7. Confirme que “Qual minha senha do GitHub?” usa o Cofre e que “Crie uma
   tarefa para revisar o GitHub” continua usando Tasks.
8. Desconecte localmente e confirme que Tools pedem reconexão. A desinstalação
   no GitHub continua sendo uma ação separada em “Gerenciar no GitHub”.
9. Verifique que nenhuma tabela contém OAuth user token, installation token,
   App JWT, private key ou client secret.

## Rollback

O rollback de código pode ocultar a UI/Tools P5 sem remover dados. Não faça
DROP de tabelas durante uma resposta operacional. Se necessário, revogue ou
desinstale o GitHub App externamente, preserve a migration aplicada e faça uma
correção aditiva posterior.
