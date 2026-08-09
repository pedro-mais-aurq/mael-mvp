export type Priority = "baixa" | "media" | "alta";

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface ProfileRow {
  id: string;
  name: string | null;
  /** P1 — transitório: presente após a migration remota ser aplicada. */
  timezone?: string | null;
  master_salt: string | null;
  master_verifier: string | null;
  created_at: string;
}

export interface ChatMessageDTO {
  id: string;
  session_id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  intent: string | null;
  tool_output: JsonValue | null;
  created_at: string;
}

export interface SendChatResult {
  session_id: string;
  user_message: ChatMessageDTO;
  assistant_message: ChatMessageDTO;
}

export interface TaskRow {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  category: string | null;
  priority: Priority;
  due_date: string | null;
  due_time: string | null;
  /** P1/P2 — transitórios: presentes após as migrations remotas serem aplicadas. */
  due_at?: string | null;
  remind_at?: string | null;
  notified_at?: string | null;
  legacy_reminder_id?: string | null;
  reminder_enabled?: boolean;
  completed: boolean;
  completed_at?: string | null;
  created_at: string;
  updated_at?: string;
}

/**
 * @deprecated Contrato de compatibilidade P2 para adapters antigos. A fonte
 * persistida é `tasks`; `ReminderRow` não representa mais um domínio próprio.
 */
export interface ReminderRow {
  id: string;
  user_id: string;
  title: string;
  notes: string | null;
  remind_at: string;
  active: boolean;
  /** Transitório: nem todo objeto antigo/mock precisa carregar este campo. */
  notified_at?: string | null;
  created_at: string;
}

export interface VaultEntryRow {
  id: string;
  user_id: string;
  name: string;
  service: string | null;
  username: string | null;
  domain: string | null;
  category: string | null;
  password_ciphertext: string;
  notes_ciphertext: string | null;
  strength_label: string | null;
  created_at: string;
}

export interface VaultMetaEntry {
  name: string;
  service: string | null;
  username: string | null;
  strength_label: string | null;
}
