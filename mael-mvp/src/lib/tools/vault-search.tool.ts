import type { ToolExecutionResult } from "../chat/tool-types";
import type { VaultService } from "../services/vault.service";

export class VaultSearchTool {
  constructor(private readonly vaultService: VaultService) {}

  async search(userId: string, input: { query: string }): Promise<ToolExecutionResult> {
    const entries = await this.vaultService.search(userId, input.query, 8);
    const safeEntries = entries.map((entry) => ({
      name: entry.name,
      service: entry.service,
      username: entry.username,
      strength_label: entry.strength_label,
    }));

    return {
      ok: true,
      modelOutput: {
        ok: true,
        query: input.query,
        entries: safeEntries,
        security_notice: "A senha não é disponibilizada à IA e só pode ser revelada no Cofre.",
      },
      persistedOutput: {
        kind: "vault_matches",
        match_count: safeEntries.length,
      },
      fallbackReply:
        entries.length === 0
          ? `Não encontrei entradas no Cofre para "${input.query}".`
          : "Encontrei metadados no Cofre. A senha só pode ser revelada na tela do Cofre com sua senha mestra.",
      mutatesTasks: false,
    };
  }
}
