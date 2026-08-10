import type { SupabaseClient } from "@supabase/supabase-js";

import type { ChatMessageDTO, JsonValue } from "../mael-types";

const MESSAGE_COLUMNS = "id, session_id, role, content, intent, tool_output, created_at";

export class ChatRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async findOwnedSessionId(userId: string, sessionId: string): Promise<string | null> {
    const { data } = await this.supabase
      .from("chat_sessions")
      .select("id")
      .eq("id", sessionId)
      .eq("user_id", userId)
      .maybeSingle();
    return (data?.id as string | undefined) ?? null;
  }

  async createSession(userId: string, title: string): Promise<string> {
    const { data, error } = await this.supabase
      .from("chat_sessions")
      .insert({ user_id: userId, title: title.slice(0, 60) })
      .select("id")
      .single();
    if (error) throw error;
    return data.id as string;
  }

  async touchSession(sessionId: string): Promise<void> {
    await this.supabase
      .from("chat_sessions")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", sessionId);
  }

  async recentHistory(
    sessionId: string,
    limit: number,
  ): Promise<{ role: "user" | "assistant"; content: string }[]> {
    const { data } = await this.supabase
      .from("chat_messages")
      .select("role, content")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: false })
      .limit(limit);
    return (data ?? [])
      .reverse()
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content as string }));
  }

  async insertMessage(input: {
    sessionId: string;
    userId: string;
    role: "user" | "assistant";
    content: string;
    intent?: string;
    toolOutput?: JsonValue | null;
  }): Promise<ChatMessageDTO> {
    const { data, error } = await this.supabase
      .from("chat_messages")
      .insert({
        session_id: input.sessionId,
        user_id: input.userId,
        role: input.role,
        content: input.content,
        ...(input.intent !== undefined ? { intent: input.intent } : {}),
        ...(input.toolOutput !== undefined ? { tool_output: input.toolOutput } : {}),
      })
      .select(MESSAGE_COLUMNS)
      .single();
    if (error) throw error;
    return data as ChatMessageDTO;
  }
}
