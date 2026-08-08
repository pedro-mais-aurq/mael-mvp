export type Priority = "baixa" | "media" | "alta";

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface ProfileRow {
  id: string;
  name: string | null;
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
  completed: boolean;
  created_at: string;
}

export interface ReminderRow {
  id: string;
  user_id: string;
  title: string;
  notes: string | null;
  remind_at: string;
  active: boolean;
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
