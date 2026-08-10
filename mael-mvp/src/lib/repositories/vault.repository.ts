import type { SupabaseClient } from "@supabase/supabase-js";

import type { VaultEntryRow, VaultMetaEntry } from "../mael-types";

export interface NewVaultEntryInput {
  userId: string;
  name: string;
  service: string;
  username: string;
  domain: string;
  category: string;
  password_ciphertext: string;
  notes_ciphertext: string;
  strength_label: string;
}
export class VaultRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async listByUser(): Promise<VaultEntryRow[]> {
    const { data, error } = await this.supabase
      .from("vault_entries")
      .select("*")
      .order("name", { ascending: true });
    if (error) throw error;
    return (data ?? []) as VaultEntryRow[];
  }

  async create(input: NewVaultEntryInput): Promise<VaultEntryRow> {
    const { data, error } = await this.supabase
      .from("vault_entries")
      .insert({
        user_id: input.userId,
        name: input.name,
        service: input.service,
        username: input.username,
        domain: input.domain,
        category: input.category,
        password_ciphertext: input.password_ciphertext,
        notes_ciphertext: input.notes_ciphertext,
        strength_label: input.strength_label,
      })
      .select("*")
      .single();
    if (error) throw error;
    return data as VaultEntryRow;
  }

  async delete(userId: string, id: string): Promise<void> {
    const { error } = await this.supabase
      .from("vault_entries")
      .delete()
      .eq("id", id)
      .eq("user_id", userId);
    if (error) throw error;
  }

  /**
   * Só metadados (nome/serviço/usuário) — nunca o ciphertext. Usado pelo
   * ChatService para "search_password" e pelo VaultService para detecção de
   * duplicidade por nome/serviço (a senha em si é opaca para o servidor).
   */
  async searchMeta(query: string, limit = 8): Promise<VaultMetaEntry[]> {
    const pattern = `%${query.replace(/[%,]/g, " ")}%`;
    const { data, error } = await this.supabase
      .from("vault_entries")
      .select("name, service, username, strength_label")
      .or(`name.ilike.${pattern},service.ilike.${pattern},username.ilike.${pattern}`)
      .order("name")
      .limit(limit);
    if (error) throw error;
    return (data ?? []) as VaultMetaEntry[];
  }

  async findByNameOrService(name: string, service: string | null): Promise<VaultMetaEntry[]> {
    const orFilter = service ? `name.ilike.${name},service.ilike.${service}` : `name.ilike.${name}`;
    const { data, error } = await this.supabase
      .from("vault_entries")
      .select("name, service, username, strength_label")
      .or(orFilter);
    if (error) throw error;
    return (data ?? []) as VaultMetaEntry[];
  }
}
