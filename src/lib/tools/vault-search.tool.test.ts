import { describe, expect, it, vi } from "vitest";

import type { VaultService } from "../services/vault.service";
import { VaultSearchTool } from "./vault-search.tool";

describe("VaultSearchTool", () => {
  it("retorna somente metadados e nunca ciphertext ou senha", async () => {
    const search = vi.fn(async () => [
      {
        name: "GitHub",
        service: "github.com",
        username: "ana",
        strength_label: "forte",
        password_ciphertext: "SEGREDO-CIFRADO",
        notes_ciphertext: "OUTRO-SEGREDO",
      },
    ]);
    const tool = new VaultSearchTool({ search } as unknown as VaultService);
    const result = await tool.search("user-1", { query: "github" });
    const serialized = JSON.stringify(result);

    expect(search).toHaveBeenCalledWith("user-1", "github", 8);
    expect(serialized).toContain("GitHub");
    expect(serialized).not.toContain("SEGREDO-CIFRADO");
    expect(serialized).not.toContain("OUTRO-SEGREDO");
    expect(serialized).not.toContain("password_ciphertext");
    expect(result.persistedOutput).toEqual({ kind: "vault_matches", match_count: 1 });
    expect(JSON.stringify(result.persistedOutput)).not.toContain("ana");
  });
});
