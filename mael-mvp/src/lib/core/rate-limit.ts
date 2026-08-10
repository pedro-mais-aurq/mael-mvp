/**
 * Rate limiting (Etapa 15) — proteção contra brute force e abuso.
 *
 * Usa a tabela `rate_limit_events` (ver migration
 * 20260805200000_hardening.sql) em vez de memória local: TanStack Start pode
 * rodar em múltiplas instâncias/edge workers, então um contador em memória
 * não seria confiável entre requisições. Isso troca "estabilidade" por um
 * pouco de latência extra (uma query) em endpoints sensíveis — aceitável
 * dado que são poucos (login de senha mestra, chat).
 *
 * Importante: se a tabela ainda não existir (migration não aplicada), a
 * checagem falha aberta (não bloqueia o usuário) e apenas loga um aviso —
 * nunca quebra o comportamento atual do MVP.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "./logger";
import { RateLimitError } from "./exceptions";

export interface RateLimitOptions {
  action: string;
  limit: number;
  windowSeconds: number;
}

export async function enforceRateLimit(
  supabase: SupabaseClient,
  userId: string,
  opts: RateLimitOptions,
): Promise<void> {
  const since = new Date(Date.now() - opts.windowSeconds * 1000).toISOString();

  const { count, error: countError } = await supabase
    .from("rate_limit_events")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("action", opts.action)
    .gte("created_at", since);

  if (countError) {
    // Tabela ainda não migrada (ou outra falha transitória): não bloquear o
    // usuário por causa de infraestrutura de rate limit ausente.
    logger.warn("Rate limit check indisponível — permitindo por padrão", {
      route: "rate-limit",
      userId,
      action: opts.action,
      error: countError.message,
    });
    return;
  }

  if ((count ?? 0) >= opts.limit) {
    throw new RateLimitError();
  }

  const { error: insertError } = await supabase
    .from("rate_limit_events")
    .insert({ user_id: userId, action: opts.action });
  if (insertError) {
    logger.warn("Falha ao registrar evento de rate limit", {
      route: "rate-limit",
      userId,
      action: opts.action,
      error: insertError.message,
    });
  }
}
