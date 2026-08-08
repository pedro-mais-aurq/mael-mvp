/**
 * Exception handling padronizado (Etapa 14).
 *
 * Regra: nenhum erro bruto (stack trace, mensagem de driver do Postgres,
 * detalhe interno) pode chegar ao cliente. `handleServiceError` loga o erro
 * completo no servidor e devolve um `Error` simples e seguro para o handler
 * relançar. Isso preserva o contrato atual: os server functions sempre
 * lançavam `Error(message)` e o frontend só usa `err.message` como texto de
 * fallback (nunca faz parsing estruturado), então essa troca é 100%
 * compatível com as telas existentes.
 */

import { logger, type LogContext } from "./logger";

export class AppError extends Error {
  readonly code: string;
  constructor(message: string, code = "INTERNAL_ERROR") {
    super(message);
    this.name = "AppError";
    this.code = code;
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, "VALIDATION_ERROR");
    this.name = "ValidationError";
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Registro não encontrado.") {
    super(message, "NOT_FOUND");
    this.name = "NotFoundError";
  }
}

export class RateLimitError extends AppError {
  constructor(message = "Muitas tentativas em pouco tempo. Aguarde um instante.") {
    super(message, "RATE_LIMITED");
    this.name = "RateLimitError";
  }
}

const GENERIC_MESSAGE = "Não foi possível concluir a operação agora. Tente novamente.";

/**
 * Loga o erro real (com stack) e devolve um Error seguro para lançar de volta
 * ao caller do server function. AppError e suas subclasses têm mensagens já
 * pensadas para o usuário final, então passam direto; qualquer outro erro
 * (falha do Postgres, exceção inesperada, etc.) vira uma mensagem genérica.
 */
export function handleServiceError(err: unknown, context: LogContext): Error {
  logger.error(`Erro em ${context["route"] ?? "unknown"}`, err, context);
  if (err instanceof AppError) return new Error(err.message);
  return new Error(GENERIC_MESSAGE);
}
