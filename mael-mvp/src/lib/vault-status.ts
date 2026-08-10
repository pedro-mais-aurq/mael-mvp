import type { ProfileRow } from "./mael-types";

export type VaultStatus = "loading" | "error" | "setup" | "locked" | "unlocked";

export interface VaultStatusInput {
  vaultKey: unknown | null;
  profileLoading: boolean;
  profileError: boolean;
  profile: Pick<ProfileRow, "master_verifier"> | null | undefined;
}

/**
 * Deriva o estado da tela do Cofre a partir do resultado da query de profile.
 *
 * Regra de segurança (P1 — correção): um erro ao carregar o profile NUNCA
 * deve ser interpretado como "setup". Se isso acontecesse, um usuário que já
 * possui `master_salt`/`master_verifier` configurados poderia ver o fluxo de
 * criação de senha mestra e sobrescrever esses campos, perdendo acesso às
 * entradas do cofre já cifradas com a chave antiga.
 */
export function deriveVaultStatus(input: VaultStatusInput): VaultStatus {
  if (input.vaultKey) return "unlocked";
  if (input.profileLoading) return "loading";
  if (input.profileError) return "error";
  return input.profile?.master_verifier ? "locked" : "setup";
}
