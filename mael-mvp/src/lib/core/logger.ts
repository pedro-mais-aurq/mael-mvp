/**
 * Logging estruturado (Etapa 13).
 *
 * Cada linha de log é um objeto JSON de uma linha só — formato que qualquer
 * agregador de logs (Vercel, Cloudflare, Datadog, etc.) consegue indexar sem
 * parsing especial. Erros sempre carregam timestamp, rota, usuário (quando
 * disponível), requestId e stack trace.
 */

export interface LogContext {
  route?: string;
  userId?: string;
  requestId?: string;
  [key: string]: unknown;
}

/**
 * Chaves que nunca podem ser escritas em log, em nenhuma profundidade —
 * tokens, senhas, cookies, headers de auth, chaves privadas e o conteúdo do
 * Cofre. Comparação case-insensitive porque nomes de campo variam
 * (accessToken, access_token, Authorization, etc.).
 */
const SENSITIVE_KEY_PATTERN =
  /token|senha|password|secret|cookie|authorization|api[_-]?key|private[_-]?key|ciphertext|master_verifier|master_salt/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEY_PATTERN.test(key) ? "[REDACTED]" : redact(val, depth + 1);
  }
  return out;
}

/**
 * Serializa qualquer erro de forma diagnosticável. Erros do PostgREST/
 * Supabase (RLS, schema, constraints, conexão) chegam como objetos simples
 * — NÃO instâncias de Error — então `err instanceof Error` é falso e
 * `String(err)` produzia "[object Object]" (bug corrigido aqui). Extraímos
 * os campos padrão do PostgrestError (message/code/details/hint) e caímos
 * de volta em JSON.stringify para qualquer outro formato de erro.
 */
function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    const base: Record<string, unknown> = {
      name: err.name,
      message: err.message,
      stack: err.stack,
    };
    // Erros de driver/Postgrest às vezes estendem Error mas ainda carregam
    // code/details/hint como propriedades extras — preserva se existirem.
    for (const key of ["code", "details", "hint"] as const) {
      const val = (err as unknown as Record<string, unknown>)[key];
      if (val !== undefined) base[key] = val;
    }
    return base;
  }

  if (err && typeof err === "object") {
    // Formato PostgrestError do supabase-js: { message, details, hint, code }.
    const obj = err as Record<string, unknown>;
    const hasKnownShape = "message" in obj || "code" in obj || "details" in obj || "hint" in obj;
    if (hasKnownShape) {
      return {
        name: typeof obj["name"] === "string" ? obj["name"] : "PostgrestError",
        message: obj["message"],
        code: obj["code"],
        details: obj["details"],
        hint: obj["hint"],
      };
    }
    try {
      return { message: JSON.stringify(obj) };
    } catch {
      return { message: "Erro não serializável" };
    }
  }

  return { message: String(err) };
}

function emit(level: "info" | "warn" | "error", message: string, context: LogContext = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(redact(context) as LogContext),
  };
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  info(message: string, context?: LogContext) {
    emit("info", message, context);
  },
  warn(message: string, context?: LogContext) {
    emit("warn", message, context);
  },
  error(message: string, err: unknown, context?: LogContext) {
    emit("error", message, {
      ...context,
      error: serializeError(err),
    });
  },
};

export function newRequestId(): string {
  return crypto.randomUUID();
}
