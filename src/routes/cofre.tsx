import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Eye, EyeOff, Lock, LockOpen, Plus, Trash2, Wand2 } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { getProfile, setMasterSecret, verifyMaster } from "@/lib/profile.functions";
import {
  createVaultEntry,
  deleteVaultEntry,
  listVaultEntries,
} from "@/lib/vault.functions";
import {
  deriveVaultKey,
  decryptField,
  encryptField,
  evaluatePasswordStrength,
  generateSalt,
  generateStrongPassword,
  vaultVerifier,
} from "@/lib/vault-crypto";
import type { VaultEntryRow } from "@/lib/mael-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const foolLogo = new URL("../assets/fool-logo.svg", import.meta.url).href;

export const Route = createFileRoute("/cofre")({
  head: () => ({
    meta: [
      { title: "Cofre — Mael" },
      {
        name: "description",
        content:
          "Cofre zero-knowledge: senhas cifradas no seu dispositivo com AES-GCM derivado da senha mestra. O servidor jamais vê o conteúdo.",
      },
      { property: "og:title", content: "Cofre — Mael" },
      { property: "og:description", content: "Seu cofre de senhas criptografado de ponta a ponta." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: VaultPage,
});

type VaultStatus = "loading" | "setup" | "locked" | "unlocked";

function VaultPage() {
  const queryClient = useQueryClient();
  const [vaultKey, setVaultKey] = useState<CryptoKey | null>(null);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [masterInput, setMasterInput] = useState("");
  const [masterConfirm, setMasterConfirm] = useState("");
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ["profile"],
    queryFn: () => getProfile(),
  });

  const status: VaultStatus = vaultKey
    ? "unlocked"
    : profileLoading
      ? "loading"
      : profile?.master_verifier
        ? "locked"
        : "setup";

  const { data: entries, isLoading: entriesLoading } = useQuery({
    queryKey: ["vault"],
    queryFn: () => listVaultEntries(),
    enabled: status === "unlocked",
  });

  async function setupMaster(e: React.FormEvent) {
    e.preventDefault();
    setUnlockError(null);
    if (masterInput.length < 8) {
      setUnlockError("A senha mestra precisa de pelo menos 8 caracteres.");
      return;
    }
    if (masterInput !== masterConfirm) {
      setUnlockError("As duas senhas não coincidem.");
      return;
    }
    setBusy(true);
    try {
      const salt = generateSalt();
      const key = await deriveVaultKey(masterInput, salt);
      const verifier = await vaultVerifier(key);
      await setMasterSecret({ data: { salt, verifier } });
      setVaultKey(key);
      setMasterInput("");
      setMasterConfirm("");
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      toast.success("Cofre selado. Só você detém a chave.");
    } catch (err) {
      console.error(err);
      setUnlockError("Não consegui selar o cofre. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  async function unlock(e: React.FormEvent) {
    e.preventDefault();
    setUnlockError(null);
    if (!profile?.master_salt) return;
    setBusy(true);
    try {
      const key = await deriveVaultKey(masterInput, profile.master_salt);
      const verifier = await vaultVerifier(key);
      const { ok } = await verifyMaster({ data: { verifier } });
      if (!ok) {
        setUnlockError("Senha mestra incorreta — o cofre permanece selado.");
        return;
      }
      setVaultKey(key);
      setMasterInput("");
    } catch (err) {
      console.error(err);
      setUnlockError("Não consegui abrir o cofre. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  function lock() {
    setVaultKey(null);
    setRevealed({});
    setShowForm(false);
    toast.success("Cofre selado novamente.");
  }

  async function reveal(entry: VaultEntryRow) {
    if (!vaultKey) return;
    if (revealed[entry.id]) {
      setRevealed((prev) => {
        const next = { ...prev };
        delete next[entry.id];
        return next;
      });
      return;
    }
    try {
      const plain = await decryptField(vaultKey, entry.password_ciphertext);
      setRevealed((prev) => ({ ...prev, [entry.id]: plain }));
    } catch {
      toast.error("Não consegui decifrar esta entrada.");
    }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-xl font-bold tracking-[0.15em] text-primary uppercase gold-glow">
              Cofre
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Zero-knowledge: as senhas são cifradas aqui, no seu dispositivo. O servidor só
              guarda enigmas que não consegue ler.
            </p>
          </div>
          {status === "unlocked" && (
            <Button variant="outline" size="sm" onClick={lock}>
              <Lock className="h-4 w-4" /> Selar
            </Button>
          )}
        </div>

        {status === "loading" && (
          <p className="py-16 text-center text-sm text-muted-foreground italic">
            Examinando o selo do cofre…
          </p>
        )}

        {status === "setup" && (
          <form onSubmit={setupMaster} className="tarot-card mx-auto mt-8 max-w-sm space-y-4 p-6 pt-8">
            <div className="text-center">
              <img src={foolLogo} alt="" className="mx-auto h-14 w-14" />
              <h2 className="font-display mt-3 text-sm tracking-[0.25em] text-primary uppercase">
                Crie sua senha mestra
              </h2>
              <p className="mt-2 text-xs text-muted-foreground">
                É ela — e só ela — que abre seu cofre. Não a guardamos em lugar nenhum: se
                perdê-la, nem o Louco poderá ajudar.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="master-new">Senha mestra</Label>
              <Input
                id="master-new"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={masterInput}
                onChange={(e) => setMasterInput(e.target.value)}
                placeholder="Mínimo de 8 caracteres"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="master-confirm">Repita a senha mestra</Label>
              <Input
                id="master-confirm"
                type="password"
                required
                autoComplete="new-password"
                value={masterConfirm}
                onChange={(e) => setMasterConfirm(e.target.value)}
              />
            </div>
            {unlockError && <p className="text-sm text-destructive">{unlockError}</p>}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Forjando o selo…" : "Selar o cofre"}
            </Button>
          </form>
        )}

        {status === "locked" && (
          <form onSubmit={unlock} className="tarot-card mx-auto mt-8 max-w-sm space-y-4 p-6 pt-8">
            <div className="text-center">
              <Lock className="mx-auto h-8 w-8 text-primary" />
              <h2 className="font-display mt-3 text-sm tracking-[0.25em] text-primary uppercase">
                O cofre está selado
              </h2>
              <p className="mt-2 text-xs text-muted-foreground">
                Sussurre a senha mestra e as portas se abrem.
              </p>
            </div>
            <Input
              type="password"
              required
              autoComplete="current-password"
              value={masterInput}
              onChange={(e) => setMasterInput(e.target.value)}
              placeholder="Senha mestra"
              aria-label="Senha mestra"
            />
            {unlockError && <p className="text-sm text-destructive">{unlockError}</p>}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Girando a chave…" : "Abrir o cofre"}
            </Button>
          </form>
        )}

        {status === "unlocked" && vaultKey && (
          <>
            <div className="mt-5 flex justify-end">
              <Button variant="outline" size="sm" onClick={() => setShowForm((v) => !v)}>
                <Plus className="h-4 w-4" /> Nova entrada
              </Button>
            </div>

            {showForm && (
              <NewEntryForm
                vaultKey={vaultKey}
                onDone={() => {
                  setShowForm(false);
                  queryClient.invalidateQueries({ queryKey: ["vault"] });
                }}
              />
            )}

            <div className="mt-4 space-y-2">
              {entriesLoading ? (
                <p className="py-10 text-center text-sm text-muted-foreground italic">
                  Contando os segredos…
                </p>
              ) : !entries?.length ? (
                <div className="tarot-card py-12 text-center">
                  <LockOpen className="mx-auto h-6 w-6 text-primary" />
                  <p className="font-display mt-3 text-sm tracking-[0.25em] text-muted-foreground uppercase">
                    O cofre ecoa vazio
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Guarde sua primeira senha — ela será cifrada antes de sair daqui.
                  </p>
                </div>
              ) : (
                entries.map((entry) => (
                  <VaultEntryCard
                    key={entry.id}
                    entry={entry}
                    plain={revealed[entry.id]}
                    onReveal={() => reveal(entry)}
                  />
                ))
              )}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}

function NewEntryForm({ vaultKey, onDone }: { vaultKey: CryptoKey; onDone: () => void }) {
  const [name, setName] = useState("");
  const [service, setService] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [notes, setNotes] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const strength = evaluatePasswordStrength(password);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const passwordCiphertext = await encryptField(vaultKey, password);
      const notesCiphertext = notes.trim() ? await encryptField(vaultKey, notes.trim()) : null;
      return createVaultEntry({
        data: {
          name: name.trim(),
          service: service.trim() || null,
          username: username.trim() || null,
          password_ciphertext: passwordCiphertext,
          notes_ciphertext: notesCiphertext,
          strength_label: strength.label,
        },
      });
    },
    onSuccess: () => {
      toast.success("Segredo guardado — já cifrado, como deve ser.");
      onDone();
    },
    onError: () => toast.error("Não consegui guardar esta entrada."),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim() && password) saveMutation.mutate();
      }}
      className="tarot-card mt-4 space-y-3 p-4 pt-6"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="entry-name">Nome *</Label>
          <Input
            id="entry-name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Banco, Gmail…"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="entry-service">Serviço</Label>
          <Input
            id="entry-service"
            value={service}
            onChange={(e) => setService(e.target.value)}
            placeholder="site ou app"
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="entry-username">Usuário</Label>
        <Input
          id="entry-username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="login ou email"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="entry-password">Senha *</Label>
        <div className="flex gap-2">
          <Input
            id="entry-password"
            type={showPassword ? "text" : "password"}
            required
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            title={showPassword ? "Ocultar" : "Mostrar"}
            onClick={() => setShowPassword((v) => !v)}
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            title="Gerar senha forte"
            onClick={() => {
              setPassword(generateStrongPassword());
              setShowPassword(true);
            }}
          >
            <Wand2 className="h-4 w-4" />
          </Button>
        </div>
        {password && (
          <p
            className={cn(
              "text-xs",
              strength.score <= 2 ? "text-destructive" : "text-primary",
            )}
          >
            Força: {strength.label}
          </p>
        )}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="entry-notes">Notas (cifradas também)</Label>
        <Input
          id="entry-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="opcional"
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button type="submit" disabled={saveMutation.isPending || !name.trim() || !password}>
          {saveMutation.isPending ? "Cifrando…" : "Guardar no cofre"}
        </Button>
      </div>
    </form>
  );
}

function VaultEntryCard({
  entry,
  plain,
  onReveal,
}: {
  entry: VaultEntryRow;
  plain: string | undefined;
  onReveal: () => void;
}) {
  const queryClient = useQueryClient();
  const deleteMutation = useMutation({
    mutationFn: () => deleteVaultEntry({ data: { id: entry.id } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vault"] });
      toast.success("Entrada removida do cofre.");
    },
  });

  return (
    <div className="group rounded-lg border border-border/70 bg-card px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{entry.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {[entry.service, entry.username].filter(Boolean).join(" · ") || "sem detalhes"}
          </p>
        </div>
        {entry.strength_label && (
          <Badge variant="outline" className="border-primary/50 text-[0.65rem] text-primary">
            {entry.strength_label}
          </Badge>
        )}
        <Button variant="ghost" size="icon" onClick={onReveal} title={plain ? "Ocultar senha" : "Revelar senha"}>
          {plain ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="opacity-0 transition-opacity group-hover:opacity-100"
          onClick={() => deleteMutation.mutate()}
          title="Excluir entrada"
        >
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </div>
      {plain !== undefined && (
        <div className="mt-2 flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
          <code className="flex-1 font-mono text-sm break-all">{plain}</code>
          <Button
            variant="ghost"
            size="icon"
            title="Copiar"
            onClick={() => {
              navigator.clipboard.writeText(plain);
              toast.success("Copiado — use com sabedoria.");
            }}
          >
            <Copy className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
