# Changelog

## Alpha 0.1

- Autenticação da aplicação consolidada em Google OAuth via Supabase, com
  limpeza do cache autenticado no logout e na troca de usuário.
- Tasks e Reminders unificados: Tasks são a fonte canônica e os adapters
  legados foram preservados somente para compatibilidade de rollout.
- Chat reconstruído sobre Tool Calling com whitelist, schemas, budgets,
  resolução canônica de alvos e dados de Tools tratados como não confiáveis.
- GitHub App read-only para repositories, pull requests e issues, com state
  single-use, PKCE, verificação da instalação e tokens temporários em memória.
- Cofre mantido zero-knowledge; ciphertext e senhas nunca são enviados ao LLM.
- Hardening de RLS, isolamento entre usuários, logs com redaction, paginação
  GitHub, rate limits e semântica explícita de resultados truncados.

Este projeto ainda não possui versionamento formal no `package.json`; nenhuma
versão ou tag foi criada artificialmente por este fechamento.
