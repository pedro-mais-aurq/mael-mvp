import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { VaultRepository } from "./repositories/vault.repository";
import { VaultService } from "./services/vault.service";
import { handleServiceError } from "./core/exceptions";
import type { VaultEntryRow } from "./mael-types";

function vaultService(supabase: SupabaseClient): VaultService {
  return new VaultService(new VaultRepository(supabase));
}

export const listVaultEntries = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<VaultEntryRow[]> => {
    const supabase = context.supabase as unknown as SupabaseClient;
    try {
      return await vaultService(supabase).listForUser();
    } catch (err) {
      throw handleServiceError(err, { route: "vault.listVaultEntries", userId: context.userId });
    }
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
    try {
      return await vaultService(supabase).create(context.userId, data);
    } catch (err) {
      throw handleServiceError(err, { route: "vault.createVaultEntry", userId: context.userId });
    }
  });

export const deleteVaultEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as unknown as SupabaseClient;
    try {
      await vaultService(supabase).delete(context.userId, data.id);
      return { ok: true };
    } catch (err) {
      throw handleServiceError(err, { route: "vault.deleteVaultEntry", userId: context.userId });
    }
  });
