import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TasksRepository, type NewTaskInput, type TaskUpdatePatch } from "./tasks.repository";

interface RecordedCall {
  method: string;
  args: unknown[];
}

interface DatabaseResult {
  data: unknown;
  error: Error | null;
}

class FluentQuery implements PromiseLike<DatabaseResult> {
  constructor(
    private readonly calls: RecordedCall[],
    private readonly result: DatabaseResult,
  ) {}

  private record(method: string, args: unknown[]): this {
    this.calls.push({ method, args });
    return this;
  }

  select(...args: unknown[]): this {
    return this.record("select", args);
  }

  insert(...args: unknown[]): this {
    return this.record("insert", args);
  }

  update(...args: unknown[]): this {
    return this.record("update", args);
  }

  delete(...args: unknown[]): this {
    return this.record("delete", args);
  }

  eq(...args: unknown[]): this {
    return this.record("eq", args);
  }

  is(...args: unknown[]): this {
    return this.record("is", args);
  }

  not(...args: unknown[]): this {
    return this.record("not", args);
  }

  lte(...args: unknown[]): this {
    return this.record("lte", args);
  }

  gte(...args: unknown[]): this {
    return this.record("gte", args);
  }

  ilike(...args: unknown[]): this {
    return this.record("ilike", args);
  }

  order(...args: unknown[]): this {
    return this.record("order", args);
  }

  limit(...args: unknown[]): this {
    return this.record("limit", args);
  }

  single(): Promise<DatabaseResult> {
    this.record("single", []);
    return Promise.resolve(this.result);
  }

  maybeSingle(): Promise<DatabaseResult> {
    this.record("maybeSingle", []);
    return Promise.resolve(this.result);
  }

  then<TResult1 = DatabaseResult, TResult2 = never>(
    onfulfilled?: ((value: DatabaseResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }
}

function mockClient(data: unknown = []): {
  client: SupabaseClient;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const query = new FluentQuery(calls, { data, error: null });
  const client = {
    from: (table: string) => {
      calls.push({ method: "from", args: [table] });
      return query;
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

function callsFor(calls: RecordedCall[], method: string): unknown[][] {
  return calls.filter((call) => call.method === method).map((call) => call.args);
}

describe("TasksRepository — fonte canônica P2", () => {
  it("lista por user_id em tasks", async () => {
    const { client, calls } = mockClient([]);
    await new TasksRepository(client).listByUser("user-1");

    expect(callsFor(calls, "from")).toEqual([["tasks"]]);
    expect(callsFor(calls, "eq")).toContainEqual(["user_id", "user-1"]);
  });

  it("lista para Tool com filtros explícitos, escopo do usuário e limite", async () => {
    const { client, calls } = mockClient([]);
    await new TasksRepository(client).listForTool("user-1", {
      status: "completed",
      hasReminder: true,
      query: "50%_off",
      dueFrom: "2026-08-10T00:00:00.000Z",
      dueTo: "2026-08-11T23:59:59.000Z",
      limit: 21,
    });

    expect(callsFor(calls, "eq")).toEqual([
      ["user_id", "user-1"],
      ["completed", true],
    ]);
    expect(callsFor(calls, "not")).toContainEqual(["remind_at", "is", null]);
    expect(callsFor(calls, "ilike")).toEqual([["title", "%50\\%\\_off%"]]);
    expect(callsFor(calls, "gte")).toEqual([["due_at", "2026-08-10T00:00:00.000Z"]]);
    expect(callsFor(calls, "lte")).toEqual([["due_at", "2026-08-11T23:59:59.000Z"]]);
    expect(callsFor(calls, "limit")).toEqual([[21]]);
  });

  it("resolve mutações por conjunto do backend sem query controlada pelo LLM", async () => {
    const { client, calls } = mockClient([]);
    await new TasksRepository(client).listForResolution("user-1", {
      status: "all",
      limit: 101,
    });

    expect(callsFor(calls, "eq")).toEqual([["user_id", "user-1"]]);
    expect(callsFor(calls, "ilike")).toEqual([]);
    expect(callsFor(calls, "limit")).toEqual([[101]]);
  });

  it("inclui leitura compatível de due_date legado mantendo due_at nulo", async () => {
    const { client, calls } = mockClient([]);
    await new TasksRepository(client).listLegacyDueDate("user-1", "2026-08-10", {
      status: "open",
      hasReminder: null,
      query: null,
      limit: 51,
    });

    expect(callsFor(calls, "eq")).toEqual([
      ["user_id", "user-1"],
      ["due_date", "2026-08-10"],
      ["completed", false],
    ]);
    expect(callsFor(calls, "is")).toEqual([["due_at", null]]);
    expect(callsFor(calls, "limit")).toEqual([[51]]);
  });

  it("busca e atualiza somente a Task pertencente ao usuário", async () => {
    const patch: TaskUpdatePatch = {
      title: "Novo título",
      due_at: null,
      reminder_enabled: false,
    };
    const { client, calls } = mockClient({ id: "task-1", title: "Novo título" });
    const repository = new TasksRepository(client);

    await repository.findById("user-1", "task-1");
    await repository.update("user-1", "task-1", patch);

    expect(callsFor(calls, "eq")).toEqual([
      ["id", "task-1"],
      ["user_id", "user-1"],
      ["id", "task-1"],
      ["user_id", "user-1"],
    ]);
    expect(callsFor(calls, "update")).toEqual([[patch]]);
    expect(callsFor(calls, "maybeSingle")).toHaveLength(2);
  });

  it("cria com todos os campos temporais e de compatibilidade", async () => {
    const input: NewTaskInput = {
      userId: "user-1",
      title: "Consulta",
      description: "Dentista",
      category: "geral",
      priority: "media",
      due_date: null,
      due_time: null,
      due_at: "2026-08-11T12:00:00.000Z",
      remind_at: "2026-08-10T12:00:00.000Z",
      notified_at: null,
      reminder_enabled: true,
      legacy_reminder_id: null,
    };
    const { client, calls } = mockClient({ id: "task-1" });
    await new TasksRepository(client).create(input);

    expect(callsFor(calls, "from")).toEqual([["tasks"]]);
    expect(callsFor(calls, "insert")).toEqual([
      [
        {
          user_id: "user-1",
          title: "Consulta",
          description: "Dentista",
          category: "geral",
          priority: "media",
          due_date: null,
          due_time: null,
          due_at: "2026-08-11T12:00:00.000Z",
          remind_at: "2026-08-10T12:00:00.000Z",
          notified_at: null,
          reminder_enabled: true,
          legacy_reminder_id: null,
        },
      ],
    ]);
  });

  it("mantém completed e completed_at consistentes ao concluir e reabrir", async () => {
    const first = mockClient();
    await new TasksRepository(first.client).setCompleted("user-1", "task-1", true);
    expect(callsFor(first.calls, "update")[0]?.[0]).toEqual({
      completed: true,
      completed_at: expect.any(String),
    });
    expect(callsFor(first.calls, "eq")).toEqual([
      ["id", "task-1"],
      ["user_id", "user-1"],
    ]);

    const second = mockClient();
    await new TasksRepository(second.client).setCompleted("user-1", "task-1", false);
    expect(callsFor(second.calls, "update")[0]?.[0]).toEqual({
      completed: false,
      completed_at: null,
    });
  });

  it("retorna null quando update/delete não afetam nenhuma linha", async () => {
    const { client } = mockClient(null);
    const repository = new TasksRepository(client);
    await expect(repository.update("user-1", "ausente", { title: "X" })).resolves.toBeNull();
    await expect(repository.delete("user-1", "ausente")).resolves.toBeNull();
  });

  it("altera e limpa lembrete sem apagar a task", async () => {
    const disable = mockClient();
    await new TasksRepository(disable.client).setReminderEnabled("user-1", "task-1", false);
    expect(callsFor(disable.calls, "update")).toEqual([[{ reminder_enabled: false }]]);
    expect(callsFor(disable.calls, "eq")).toContainEqual(["user_id", "user-1"]);
    expect(callsFor(disable.calls, "delete")).toEqual([]);

    const enable = mockClient();
    await new TasksRepository(enable.client).setReminderEnabled("user-1", "task-1", true);
    expect(callsFor(enable.calls, "update")).toEqual([[{ reminder_enabled: true }]]);
    expect(callsFor(enable.calls, "delete")).toEqual([]);

    const clear = mockClient();
    await new TasksRepository(clear.client).clearReminder("user-1", "task-1");
    expect(callsFor(clear.calls, "update")).toEqual([
      [{ remind_at: null, notified_at: null, reminder_enabled: true }],
    ]);
    expect(callsFor(clear.calls, "delete")).toEqual([]);
  });

  it("busca somente lembretes vencidos, ativos, pendentes e não notificados", async () => {
    const { client, calls } = mockClient([]);
    await new TasksRepository(client).listDueUnnotified("2026-08-10T18:00:00.000Z", 25);

    expect(callsFor(calls, "from")).toEqual([["tasks"]]);
    expect(callsFor(calls, "eq")).toEqual([
      ["reminder_enabled", true],
      ["completed", false],
    ]);
    expect(callsFor(calls, "is")).toEqual([["notified_at", null]]);
    expect(callsFor(calls, "lte")).toEqual([["remind_at", "2026-08-10T18:00:00.000Z"]]);
    expect(callsFor(calls, "limit")).toEqual([[25]]);
  });

  it("marca notified_at exclusivamente em tasks", async () => {
    const { client, calls } = mockClient();
    await new TasksRepository(client).markNotified("task-1", "2026-08-10T18:01:00.000Z");
    expect(callsFor(calls, "from")).toEqual([["tasks"]]);
    expect(callsFor(calls, "update")).toEqual([[{ notified_at: "2026-08-10T18:01:00.000Z" }]]);
  });
});
