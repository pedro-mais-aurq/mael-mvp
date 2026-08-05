/*
 * Criptografia do cofre — zero-knowledge, 100% client-side (Web Crypto).
 *
 * Corrige a falha arquitetural do backend original, em que a "chave" derivava
 * apenas do user_id + KEK do servidor (ou seja, o servidor podia decifrar
 * qualquer senha). Aqui:
 *  - A senha mestra nunca sai do navegador.
 *  - PBKDF2-SHA256 (210k iterações) deriva uma chave AES-GCM-256 da senha mestra.
 *  - O servidor guarda apenas salt + verificador (SHA-256 da chave derivada),
 *    suficiente para validar o desbloqueio sem conhecer a senha nem a chave.
 *  - Senhas e notas viajam para o banco já cifradas (AES-GCM).
 */

const PBKDF2_ITERATIONS = 210_000;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function generateSalt(): string {
  return toBase64(crypto.getRandomValues(new Uint8Array(16)));
}

export async function deriveVaultKey(masterPassword: string, saltB64: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(masterPassword),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: fromBase64(saltB64) as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    material,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
}

/** Verificador público do desbloqueio: SHA-256 da chave derivada (não da senha). */
export async function vaultVerifier(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey("raw", key);
  const digest = await crypto.subtle.digest("SHA-256", raw);
  return toHex(new Uint8Array(digest));
}

export async function encryptField(key: CryptoKey, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    new TextEncoder().encode(plaintext),
  );
  const packed = new Uint8Array(iv.length + ciphertext.byteLength);
  packed.set(iv, 0);
  packed.set(new Uint8Array(ciphertext), iv.length);
  return toBase64(packed);
}

export async function decryptField(key: CryptoKey, blobB64: string): Promise<string> {
  const packed = fromBase64(blobB64);
  const iv = packed.slice(0, 12);
  const ciphertext = packed.slice(12);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    ciphertext as BufferSource,
  );
  return new TextDecoder().decode(plain);
}

/* ---------- Força e geração de senhas (portado do backend original) ---------- */

const LOWER = "abcdefghijklmnopqrstuvwxyz";
const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS = "0123456789";
const SYMBOLS = "!@#$%^&*()-_=+[]{};:,.<>?";
const COMMON = ["password", "senha", "qwerty", "letmein", "admin", "123456"];

export function evaluatePasswordStrength(password: string): { score: number; label: string } {
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  const lowered = password.toLowerCase();
  if (COMMON.some((c) => lowered.includes(c))) score = Math.min(score, 2);
  const labels = ["muito fraca", "fraca", "média", "forte", "muito forte", "excelente"];
  return { score, label: labels[Math.min(score, labels.length - 1)]! };
}

export function generateStrongPassword(length = 20): string {
  const all = LOWER + UPPER + DIGITS + SYMBOLS;
  const required = [LOWER, UPPER, DIGITS, SYMBOLS].map(
    (set) => set[crypto.getRandomValues(new Uint32Array(1))[0]! % set.length]!,
  );
  const remaining = length - required.length;
  const randoms = crypto.getRandomValues(new Uint32Array(remaining));
  const chars = [...required];
  for (let i = 0; i < remaining; i++) chars.push(all[randoms[i]! % all.length]!);
  // Fisher–Yates
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0]! % (i + 1);
    const a = chars[i]!;
    chars[i] = chars[j]!;
    chars[j] = a;
  }
  return chars.join("");
}
