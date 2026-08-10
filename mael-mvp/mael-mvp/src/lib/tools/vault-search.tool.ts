import type { VaultService } from "../services/vault.service";
import { asString, type ToolResult } from "./types";

export class VaultSearchTool {
  constructor(private readonly vaultService: VaultService) {}

  async searchFromArgs(args: Record<string, unknown>): Promise<ToolResult> {
    const query = asString(args["query"]);
    if (!query) {
      return { ok: false, reply: "", toolOutput: null };
    }

    // Metadados apenas — NUNCA o ciphertext. O conteúdo sensível só é
    // decifrado no dispositivo do usuário, com a senha mestra.
    const entries = await this.vaultService.search(query, 8);

    const reply =
      entries.length === 0
        ? `Consultei seu cofre e não encontrei nada sobre "${query}". Se quiser, posso guardar essa senha agora — abra o Cofre.`
        : entries.length === 1
          ? `Encontrei uma entrada no seu cofre: ${entries[0]!.service ?? entries[0]!.name}. Por segurança, a senha só é revelada no Cofre, com sua senha mestra.`
          : `Encontrei ${entries.length} entradas no seu cofre. A senha em si só é revelada no Cofre, com sua senha mestra.`;

    return {
      ok: true,
      reply,
      toolOutput: {
        kind: "vault_matches",
        query,
        entries: entries.map((m) => ({
          name: m.name,
          service: m.service,
          username: m.username,
          strength_label: m.strength_label,
        })),
      },
    };
  }
}
