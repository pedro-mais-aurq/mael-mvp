import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { ProfileRepository } from "./repositories/profile.repository";
import { ProfileService } from "./services/profile.service";
import { handleServiceError } from "./core/exceptions";
import { enforceRateLimit } from "./core/rate-limit";
import type { ProfileRow } from "./mael-types";

function profileService(supabase: SupabaseClient): ProfileService {
  return new ProfileService(new ProfileRepository(supabase));
}

export const getProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ProfileRow | null> => {
    const supabase = context.supabase as unknown as SupabaseClient;
    try {
      return await profileService(supabase).getProfile(context.userId);
    } catch (err) {
      throw handleServiceError(err, { route: "profile.getProfile", userId: context.userId });
    }
  });

export const upsertProfileName = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ name: z.string().trim().min(1).max(80) }).parse(data))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as unknown as SupabaseClient;
    try {
      await profileService(supabase).upsertName(context.userId, data.name);
      return { ok: true };
    } catch (err) {
      throw handleServiceError(err, { route: "profile.upsertProfileName", userId: context.userId });
    }
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
    try {
      await profileService(supabase).setMasterSecret(context.userId, data.salt, data.verifier);
      return { ok: true };
    } catch (err) {
      throw handleServiceError(err, { route: "profile.setMasterSecret", userId: context.userId });
    }
  });

export const verifyMaster = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ verifier: z.string().regex(/^[0-9a-f]{64}$/) }).parse(data))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as unknown as SupabaseClient;
    try {
      // Etapa 15 — proteção contra brute force do desbloqueio do cofre.
      await enforceRateLimit(supabase, context.userId, {
        action: "verify_master",
        limit: 10,
        windowSeconds: 300,
      });
      const ok = await profileService(supabase).verifyMaster(context.userId, data.verifier);
      return { ok };
    } catch (err) {
      throw handleServiceError(err, { route: "profile.verifyMaster", userId: context.userId });
    }
  });
