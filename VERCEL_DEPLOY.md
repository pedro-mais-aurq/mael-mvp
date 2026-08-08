# Deploy do Mael na Vercel

O Mael é um app TanStack Start full-stack com SSR e server functions. Esta
versão foi preparada para Vercel Functions e não depende de Cloudflare Workers.

## 1. Importar o repositório

1. Abra a Vercel e escolha **Add New → Project**.
2. Importe o repositório GitHub do Mael.
3. Confirme o preset **TanStack Start**.
4. Build command: `npm run build`.
5. Não defina um Output Directory manualmente; deixe a integração do framework
   cuidar do output do Nitro.

## 2. Variáveis de ambiente

Cadastre em **Project → Settings → Environment Variables**:

```text
SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY
SUPABASE_SERVICE_ROLE_KEY
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
OPENROUTER_API_KEY
```

Use:

- `VITE_SUPABASE_URL` = mesmo valor de `SUPABASE_URL`.
- `VITE_SUPABASE_PUBLISHABLE_KEY` = mesmo valor de `SUPABASE_PUBLISHABLE_KEY`.
- `SUPABASE_SERVICE_ROLE_KEY` somente no servidor.
- `OPENROUTER_API_KEY` somente no servidor.

As variáveis `VITE_*` são incorporadas ao bundle do navegador durante o build.
Depois de criar ou alterar uma delas, faça um novo deployment.

## 3. O que foi removido do deploy Cloudflare

Não são mais necessários:

```text
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
Wrangler
workers.dev
.github/workflows/deploy.yml
```

O `vite.config.ts` contém `cloudflare: false`, mantendo o restante da
configuração compartilhada do Lovable/TanStack Start.

## 4. Primeiro teste

Depois do deploy:

1. Abra a URL fornecida pela Vercel.
2. Confira se `/auth` carrega sem erros de variáveis Supabase no console.
3. Faça login/cadastro.
4. Teste uma operação autenticada (por exemplo, listar/criar tarefa).
5. Teste o chat para validar `OPENROUTER_API_KEY` no runtime do servidor.
