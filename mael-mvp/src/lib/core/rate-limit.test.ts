import { describe, expect, it, vi } from "vitest";
import { enforceRateLimit } from "./rate-limit";
import { RateLimitError } from "./exceptions";

function fakeSupabase(opts: { count: number; countErrors?: boolean }) {
  const insert = vi.fn().mockResolvedValue({ error: null });
  const from = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnThis(),
      gte: vi
        .fn()
        .mockResolvedValue(
          opts.countErrors
            ? { count: null, error: { message: "relation does not exist" } }
            : { count: opts.count, error: null },
        ),
    }),
    insert,
  });
  return { from } as never;
}

describe("enforceRateLimit", () => {
  it("allows the request and records it when under the limit", async () => {
    const supabase = fakeSupabase({ count: 2 });
    await expect(
      enforceRateLimit(supabase, "user-1", { action: "send_chat", limit: 5, windowSeconds: 60 }),
    ).resolves.toBeUndefined();
  });

  it("throws RateLimitError when the limit is reached", async () => {
    const supabase = fakeSupabase({ count: 5 });
    await expect(
      enforceRateLimit(supabase, "user-1", { action: "send_chat", limit: 5, windowSeconds: 60 }),
    ).rejects.toBeInstanceOf(RateLimitError);
  });

  it("fails open (does not block) when the rate_limit_events table is missing", async () => {
    const supabase = fakeSupabase({ count: 0, countErrors: true });
    await expect(
      enforceRateLimit(supabase, "user-1", { action: "send_chat", limit: 5, windowSeconds: 60 }),
    ).resolves.toBeUndefined();
  });
});
