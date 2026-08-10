import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import type { VaultMetaEntry } from "../mael-types";
import { VaultRepository } from "./vault.repository";

interface RecordedCall {
  method: string;
  args: unknown[];
}

interface DatabaseResult {
  data: VaultMetaEntry[];
  error: Error | null;
}

class FluentVaultQuery implements PromiseLike<DatabaseResult> {
  private column: string | null = null;

  constructor(
    private readonly calls: RecordedCall[],
    private readonly dataByColumn: Record<string, VaultMetaEntry[]>,
  ) {}

  private record(method: string, args: unknown[]): this {
    this.calls.push({ method, args });
    return this;
  }

  select(...args: unknown[]): this {
    return this.record("select", args);
  }

  eq(...args: unknown[]): this {
    return this.record("eq", args);
  }

  ilike(...args: unknown[]): this {
    this.column = String(args[0]);
    return this.record("ilike", args);
  }

  order(...args: unknown[]): this {
    return this.record("order", args);
  }

  limit(...args: unknown[]): this {
    return this.record("limit", args);
  }

  then<TResult1 = DatabaseResult, TResult2 = never>(
    onfulfilled?: ((value: DatabaseResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    const result = { data: this.dataByColumn[this.column ?? ""] ?? [], error: null };
    return Promise.resolve(result).then(onfulfilled, onrejected);
  }
}

function setup(dataByColumn: Record<string, VaultMetaEntry[]> = {}) {
  const calls: RecordedCall[] = [];
  const client = {
    from: (table: string) => {
      calls.push({ method: "from", args: [table] });
      return new FluentVaultQuery(calls, dataByColumn);
    },
  } as unknown as SupabaseClient;
  return { repository: new VaultRepository(client), calls };
}

function callsFor(calls: RecordedCall[], method: string): unknown[][] {
  return calls.filter((call) => call.method === method).map((call) => call.args);
}

describe("VaultRepository — busca de metadados endurecida", () => {
  it("usa somente colunas fixas, user_id e select sem ciphertext", async () => {
    const github = {
      name: "GitHub",
      service: "github.com",
      username: "ana",
      strength_label: "forte",
    } satisfies VaultMetaEntry;
    const { repository, calls } = setup({ name: [github], service: [github] });

    await expect(repository.searchMeta("user-1", "git%,()._hub", 8)).resolves.toEqual([github]);

    expect(callsFor(calls, "from")).toEqual([
      ["vault_entries"],
      ["vault_entries"],
      ["vault_entries"],
    ]);
    expect(callsFor(calls, "eq")).toEqual([
      ["user_id", "user-1"],
      ["user_id", "user-1"],
      ["user_id", "user-1"],
    ]);
    expect(callsFor(calls, "ilike").map((args) => args[0])).toEqual([
      "name",
      "service",
      "username",
    ]);
    expect(JSON.stringify(callsFor(calls, "select"))).not.toContain("ciphertext");
    expect(JSON.stringify(calls)).not.toContain('"or"');
    for (const [, pattern] of callsFor(calls, "ilike")) {
      expect(pattern).not.toContain(",");
      expect(pattern).not.toContain("(");
      expect(pattern).not.toContain(")");
    }
  });

  it("não consulta o banco para termo vazio após sanitização", async () => {
    const { repository, calls } = setup();
    await expect(repository.searchMeta("user-1", "\u0000\u0001  ")).resolves.toEqual([]);
    expect(calls).toEqual([]);
  });
});
