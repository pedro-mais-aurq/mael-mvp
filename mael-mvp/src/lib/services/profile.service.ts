import { ProfileRepository } from "../repositories/profile.repository";
import type { ProfileRow } from "../mael-types";

export class ProfileService {
  constructor(private readonly repo: ProfileRepository) {}

  getProfile(userId: string): Promise<ProfileRow | null> {
    return this.repo.findById(userId);
  }

  getDisplayName(userId: string, fallback = "usuário"): Promise<string> {
    return this.repo.getName(userId).then((name) => name ?? fallback);
  }

  upsertName(userId: string, name: string): Promise<void> {
    return this.repo.upsertName(userId, name);
  }

  setMasterSecret(userId: string, salt: string, verifier: string): Promise<void> {
    return this.repo.setMasterSecret(userId, salt, verifier);
  }

  async verifyMaster(userId: string, verifier: string): Promise<boolean> {
    const stored = await this.repo.getMasterVerifier(userId);
    return Boolean(stored) && stored === verifier;
  }
}
