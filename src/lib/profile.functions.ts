import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { ProfileRow } from "./mael-types";

export const getProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ProfileRow | null> => {
    const supabase = context.supabase as unknown as SupabaseClient;
    const { data, error } = await supabase
      .from("profiles")
      .select("id, name, master_salt, master_verifier, created_at")
      .eq("id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as ProfileRow | null) ?? null;
  });

export const upsertProfileName = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z.object({ name: z.string().trim().min(1).max(80) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as unknown as SupabaseClient;
    const { error } = await supabase
      .from("profiles")
      .upsert({ id: context.userId, name: data.name });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setMasterSecret = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        salt: z.string().min(8),
        verifier: z.string().regex(/^[0-9a-f]{64}$/),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as unknown as SupabaseClient;
    const { error } = await supabase.from("profiles").upsert({
      id: context.userId,
      master_salt: data.salt,
      master_verifier: data.verifier,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const verifyMaster = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z.object({ verifier: z.string().regex(/^[0-9a-f]{64}$/) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as unknown as SupabaseClient;
    const { data: row, error } = await supabase
      .from("profiles")
      .select("master_verifier")
      .eq("id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return { ok: Boolean(row?.master_verifier) && row?.master_verifier === data.verifier };
  });
