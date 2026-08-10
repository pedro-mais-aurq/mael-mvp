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
   * Tool `search_vault` e pelo VaultService para detecção de
   * duplicidade por nome/serviço (a senha em si é opaca para o servidor).
   */
  async searchMeta(userId: string, query: string, limit = 8): Promise<VaultMetaEntry[]> {
    const normalized = this.normalizeSearchTerm(query);
    if (!normalized) return [];
    const safeLimit = Math.min(Math.max(limit, 1), 20);
    return this.searchFixedColumns(userId, normalized, ["name", "service", "username"], safeLimit);
  }

  async findByNameOrService(
    userId: string,
    name: string,
    service: string | null,
  ): Promise<VaultMetaEntry[]> {
    const results: VaultMetaEntry[] = [];
    const normalizedName = this.normalizeSearchTerm(name);
    const normalizedService = this.normalizeSearchTerm(service ?? "");

    if (normalizedName) {
      results.push(...(await this.searchFixedColumns(userId, normalizedName, ["name"], 8)));
    }
    if (normalizedService) {
      results.push(...(await this.searchFixedColumns(userId, normalizedService, ["service"], 8)));
    }
    return this.uniqueMeta(results, 8);
  }

  private async searchFixedColumns(
    userId: string,
    value: string,
    columns: Array<"name" | "service" | "username">,
    limit: number,
  ): Promise<VaultMetaEntry[]> {
    const pattern = `%${value.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
    const batches = await Promise.all(
      columns.map(async (column) => {
        const { data, error } = await this.supabase
          .from("vault_entries")
          .select("name, service, username, strength_label")
          .eq("user_id", userId)
          .ilike(column, pattern)
          .order("name")
          .limit(limit);
        if (error) throw error;
        return (data ?? []) as VaultMetaEntry[];
      }),
    );
    return this.uniqueMeta(batches.flat(), limit);
  }

  private uniqueMeta(entries: VaultMetaEntry[], limit: number): VaultMetaEntry[] {
    const unique = new Map<string, VaultMetaEntry>();
    for (const entry of entries) {
      const key = `${entry.name}\u0000${entry.service}\u0000${entry.username}`;
      if (!unique.has(key)) unique.set(key, entry);
    }
    return [...unique.values()]
      .sort((left, right) => left.name.localeCompare(right.name, "pt-BR"))
      .slice(0, limit);
  }

  private normalizeSearchTerm(value: string): string {
    const withoutControls = Array.from(value, (character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127 ? " " : character;
    }).join("");
    return withoutControls.replace(/[(),]/g, " ").trim().slice(0, 120);
  }
}
