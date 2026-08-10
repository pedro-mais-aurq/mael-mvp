import type { JsonValue } from "../mael-types";

/**
 * Contrato comum de toda Tool (Etapa 8). Cada Tool só conhece o Service que
 * usa — nunca outra Tool. Toda comunicação entre funcionalidades passa pelos
 * Services, nunca Tool → Tool diretamente.
 */
export interface ToolResult {
  /** Se `false`, o ChatService cai de volta para o intent "chat" com esta reply. */
  ok: boolean;
  reply: string;
  toolOutput: JsonValue | null;
}

export function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function asDateOnly(value: unknown): string | null {
  const s = asString(value);
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

export function asTimeOnly(value: unknown): string | null {
  const s = asString(value);
  return s && /^\d{2}:\d{2}(:\d{2})?$/.test(s) ? s.slice(0, 5) : null;
}
