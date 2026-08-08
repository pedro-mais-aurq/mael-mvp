import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { orchestrateChat } from "./chat.server";
import { handleServiceError } from "./core/exceptions";
import { enforceRateLimit } from "./core/rate-limit";
import type { SendChatResult } from "./mael-types";

export const sendChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        message: z.string().trim().min(1).max(4000),
        session_id: z.string().uuid().nullish(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }): Promise<SendChatResult> => {
    const supabase = context.supabase as unknown as SupabaseClient;
    try {
      // Etapa 15 — protege o gateway de IA (custo + abuso) contra flood.
      await enforceRateLimit(supabase, context.userId, {
        action: "send_chat",
        limit: 30,
        windowSeconds: 300,
      });

      const { data: profile } = await supabase
        .from("profiles")
        .select("name")
        .eq("id", context.userId)
        .maybeSingle();

      return await orchestrateChat({
        supabase,
        userId: context.userId,
        userName: (profile?.name as string | null) ?? "usuário",
        message: data.message,
        sessionId: data.session_id ?? null,
      });
    } catch (err) {
      throw handleServiceError(err, { route: "chat.sendChat", userId: context.userId });
    }
  });
