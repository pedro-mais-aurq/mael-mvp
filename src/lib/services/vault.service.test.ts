import { describe, expect, it, vi } from "vitest";
import { VaultService } from "./vault.service";
import type { VaultRepository } from "../repositories/vault.repository";
import type { VaultEntryRow, VaultMetaEntry } from "../mael-types";

function fakeRepo(overrides: Partial<VaultRepository> = {}): VaultRepository {
  return {
    listByUser: async () => [],
    create: async (input) =>
      ({
        id: "vault-1",
        user_id: input.userId,
        name: input.name,
        service: input.service,
        username: input.username,
        domain: input.domain,
        category: input.category,
        password_ciphertext: input.password_ciphertext,
        notes_ciphertext: input.notes_ciphertext,
        strength_label: input.strength_label,
        created_at: new Date().toISOString(),
      }) satisfies VaultEntryRow,
    delete: async () => {},
    searchMeta: async () => [],
    findByNameOrService: async () => [],
    ...overrides,
  } as VaultRepository;
}

describe("VaultService", () => {
  it("never receives or stores plaintext passwords — only ciphertext passes through", async () => {
    const service = new VaultService(fakeRepo());
    const entry = await service.create("user-1", {
      name: "GitHub",
      password_ciphertext: "base64:ciphertext-blob",
    });
    expect(entry.password_ciphertext).toBe("base64:ciphertext-blob");
  });

  it("logs (but does not block) when a name/service duplicate is found", async () => {
    const findByNameOrService = vi.fn(async (): Promise<VaultMetaEntry[]> => [
      { name: "GitHub", service: "github.com", username: null, strength_label: null },
    ]);
    const service = new VaultService(fakeRepo({ findByNameOrService }));
    const entry = await service.create("user-1", {
      name: "GitHub",
      password_ciphertext: "blob",
    });
    expect(findByNameOrService).toHaveBeenCalledWith("GitHub", null);
    expect(entry).toBeTruthy(); // creation still succeeds
  });

  it("search delegates to the repository with metadata only", async () => {
    const searchMeta = vi.fn(async (): Promise<VaultMetaEntry[]> => []);
    const service = new VaultService(fakeRepo({ searchMeta }));
    await service.search("banco", 5);
    expect(searchMeta).toHaveBeenCalledWith("banco", 5);
  });
});
