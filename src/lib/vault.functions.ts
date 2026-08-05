import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { VaultEntryRow } from "./mael-types";

export const listVaultEntries = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<VaultEntryRow[]> => {
    const supabase = context.supabase as unknown as SupabaseClient;
    const { data, error } = await supabase
      .from("vault_entries")
      .select("*")
      .order("name", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as VaultEntryRow[];
  });

export const createVaultEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        name: z.string().trim().min(1).max(120),
        service: z.string().trim().max(120).nullish(),
        username: z.string().trim().max(200).nullish(),
        domain: z.string().trim().max(200).nullish(),
        category: z.string().trim().max(60).nullish(),
        password_ciphertext: z.string().min(1),
        notes_ciphertext: z.string().nullish(),
        strength_label: z.string().trim().max(30).nullish(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as unknown as SupabaseClient;
    const { data: row, error } = await supabase
      .from("vault_entries")
      .insert({
        user_id: context.userId,
        name: data.name,
        service: data.service ?? null,
        username: data.username ?? null,
        domain: data.domain ?? null,
        category: data.category ?? null,
        password_ciphertext: data.password_ciphertext,
        notes_ciphertext: data.notes_ciphertext ?? null,
        strength_label: data.strength_label ?? null,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row as VaultEntryRow;
  });

export const deleteVaultEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as unknown as SupabaseClient;
    const { error } = await supabase
      .from("vault_entries")
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
