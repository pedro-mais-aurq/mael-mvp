import { VaultRepository } from "../repositories/vault.repository";
import { logger } from "../core/logger";
import type { VaultEntryRow, VaultMetaEntry } from "../mael-types";

export interface CreateVaultEntryInput {
  name: string;
  service?: string | null | undefined;
  username?: string | null | undefined;
  domain?: string | null | undefined;
  category?: string | null | undefined;
  password_ciphertext: string;
  notes_ciphertext?: string | null | undefined;
  strength_label?: string | null | undefined;
}

export class VaultService {
  constructor(private readonly repo: VaultRepository) {}

  listForUser(): Promise<VaultEntryRow[]> {
    return this.repo.listByUser();
  }

  async create(userId: string, input: CreateVaultEntryInput): Promise<VaultEntryRow> {
    // Detecção de duplicidade (Etapa 11): por nome/serviço apenas — a senha
    // em si é opaca para o servidor por design (zero-knowledge), então
    // duplicidade de *senha* só pode ser detectada no cliente, antes da
    // cifragem. Aqui apenas logamos como sinal, sem bloquear a criação (o
    // contrato de resposta do endpoint não muda).
    const matches = await this.repo.findByNameOrService(input.name, input.service ?? null);
    if (matches.length > 0) {
      logger.info("Possível entrada duplicada no cofre", {
        route: "vault.service.create",
        userId,
        name: input.name,
        service: input.service ?? null,
        existing: matches.length,
      });
    }

    return this.repo.create({
      userId,
      name: input.name,
      service: input.service ?? null,
      username: input.username ?? null,
      domain: input.domain ?? null,
      category: input.category ?? null,
      password_ciphertext: input.password_ciphertext,
      notes_ciphertext: input.notes_ciphertext ?? null,
      strength_label: input.strength_label ?? null,
    });
  }

  delete(userId: string, id: string): Promise<void> {
    return this.repo.delete(userId, id);
  }

  /** Metadados apenas (nunca ciphertext) — usado pelo VaultSearchTool do chat. */
  search(query: string, limit = 8): Promise<VaultMetaEntry[]> {
    return this.repo.searchMeta(query, limit);
  }
}
