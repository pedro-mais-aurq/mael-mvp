import type { SupabaseClient } from "@supabase/supabase-js";

import type { ProfileRow } from "../mael-types";

export class ProfileRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async findById(userId: string): Promise<ProfileRow | null> {
    const { data, error } = await this.supabase
      .from("profiles")
      .select("id, name, master_salt, master_verifier, created_at")
      .eq("id", userId)
      .maybeSingle();
    if (error) throw error;
    return (data as ProfileRow | null) ?? null;
  }

  async getName(userId: string): Promise<string | null> {
    const { data, error } = await this.supabase
      .from("profiles")
      .select("name")
      .eq("id", userId)
      .maybeSingle();
    if (error) throw error;
    return (data?.name as string | null) ?? null;
  }

  async upsertName(userId: string, name: string): Promise<void> {
    const { error } = await this.supabase.from("profiles").upsert({ id: userId, name });
    if (error) throw error;
  }

  async setMasterSecret(userId: string, salt: string, verifier: string): Promise<void> {
    const { error } = await this.supabase.from("profiles").upsert({
      id: userId,
      master_salt: salt,
      master_verifier: verifier,
    });
    if (error) throw error;
  }

  async getMasterVerifier(userId: string): Promise<string | null> {
    const { data, error } = await this.supabase
      .from("profiles")
      .select("master_verifier")
      .eq("id", userId)
      .maybeSingle();
    if (error) throw error;
    return (data?.master_verifier as string | null) ?? null;
  }
}
