/**
 * MemoryProvider (Etapa 12) — arquitetura preparada para memória de longo
 * prazo, ainda não conectada ao fluxo de chat. Por enquanto o histórico
 * usado pelo ChatService continua sendo as últimas N mensagens da sessão
 * (ver ChatRepository.recentHistory) — isso é intencional: a etapa pede
 * para preparar a estrutura, não implementar inteligência complexa agora.
 *
 * Quando for ativada, a tabela correspondente precisa de uma migration
 * própria (nunca reaproveitar `chat_messages`, que é o histórico bruto da
 * conversa, não memória derivada).
 */

export type MemoryKind = "conversation" | "preference" | "project" | "knowledge";

export interface MemoryRecord {
  id: string;
  userId: string;
  kind: MemoryKind;
  content: string;
  createdAt: string;
}

export interface MemoryProvider {
  remember(userId: string, kind: MemoryKind, content: string): Promise<void>;
  recall(userId: string, kind?: MemoryKind, limit?: number): Promise<MemoryRecord[]>;
}

/** Implementação nula: aceita chamadas, não persiste nada. Substituir quando a tabela de memória existir. */
export class NullMemoryProvider implements MemoryProvider {
  async remember(): Promise<void> {
    // no-op — intencional nesta fase do MVP
  }
  async recall(): Promise<MemoryRecord[]> {
    return [];
  }
}
