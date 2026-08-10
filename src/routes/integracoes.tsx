import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Github, RefreshCw, Unplug } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import {
  beginGitHubConnection,
  disconnectGitHubConnection,
  listGitHubConnections,
  revalidateGitHubConnection,
} from "@/lib/github.functions";

export const Route = createFileRoute("/integracoes")({
  head: () => ({
    meta: [
      { title: "Integrações — Mael" },
      {
        name: "description",
        content: "Conecte instalações GitHub App read-only ao Mael.",
      },
    ],
  }),
  component: IntegrationsPage,
});

function relativeDate(value: string | null): string {
  if (!value) return "ainda não verificada";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "data indisponível" : date.toLocaleString("pt-BR");
}

function IntegrationsPage() {
  const queryClient = useQueryClient();
  const connections = useQuery({
    queryKey: ["github-connections"],
    queryFn: () => listGitHubConnections(),
    retry: false,
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("github") === "connected") {
      toast.success("GitHub conectado com segurança.");
      window.history.replaceState({}, document.title, window.location.pathname);
      void queryClient.invalidateQueries({ queryKey: ["github-connections"] });
    }
  }, [queryClient]);

  const connect = useMutation({
    mutationFn: () => beginGitHubConnection(),
    onSuccess(result) {
      const url = new URL(result.url);
      if (url.protocol !== "https:" || url.hostname !== "github.com") {
        toast.error("O endereço de conexão retornado é inválido.");
        return;
      }
      window.location.assign(url.toString());
    },
    onError() {
      toast.error("Não foi possível iniciar a conexão com o GitHub.");
    },
  });

  const revalidate = useMutation({
    mutationFn: (connectionId: string) =>
      revalidateGitHubConnection({ data: { connection_id: connectionId } }),
    async onSuccess() {
      await queryClient.invalidateQueries({ queryKey: ["github-connections"] });
      toast.success("Instalação GitHub revalidada.");
    },
    onError() {
      toast.error("Não foi possível revalidar a instalação GitHub.");
    },
  });

  const disconnect = useMutation({
    mutationFn: (connectionId: string) =>
      disconnectGitHubConnection({ data: { connection_id: connectionId } }),
    async onSuccess() {
      await queryClient.invalidateQueries({ queryKey: ["github-connections"] });
      toast.success("Associação local desconectada.");
    },
    onError() {
      toast.error("Não foi possível desconectar a associação local.");
    },
  });

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <p className="font-display text-xs tracking-[0.28em] text-primary uppercase">
            Integrações
          </p>
          <h1 className="mt-1 text-2xl font-semibold">Serviços conectados</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            O GitHub é uma integração read-only do produto. Ele não altera seu login Google no Mael
            e nenhum token é armazenado no navegador ou no banco.
          </p>
        </div>

        <section className="panel-card p-5 pt-7">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex gap-3">
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-2.5">
                <Github className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h2 className="font-semibold">GitHub</h2>
                <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                  Conecte repositórios selecionados para consultar metadados, issues e pull requests
                  pelo chat.
                </p>
              </div>
            </div>
            <Button disabled={connect.isPending} onClick={() => connect.mutate()}>
              <Github className="h-4 w-4" />
              {connect.isPending ? "Abrindo GitHub…" : "Conectar GitHub"}
            </Button>
          </div>

          {connections.isLoading && (
            <p className="mt-5 text-sm text-muted-foreground">Carregando conexões…</p>
          )}
          {connections.isError && (
            <p className="mt-5 text-sm text-destructive">
              GitHub ainda não está configurado ou disponível neste ambiente.
            </p>
          )}
          {connections.data?.length === 0 && (
            <p className="mt-5 rounded-md border border-border/70 bg-background/40 px-3 py-2 text-sm text-muted-foreground">
              Nenhuma instalação GitHub conectada.
            </p>
          )}

          <div className="mt-5 space-y-3">
            {connections.data?.map((connection) => (
              <div
                key={connection.id}
                className="rounded-lg border border-border/80 bg-background/40 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">@{connection.account_login}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {connection.account_type === "Organization" ? "Organização" : "Conta pessoal"}
                      {" · "}
                      {connection.repository_selection === "selected"
                        ? "somente repositórios selecionados"
                        : connection.repository_selection === "all"
                          ? "todos os repositórios da instalação"
                          : "seleção não informada"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Status: {connection.status === "active" ? "ativa" : "desconectada"} · Última
                      verificação: {relativeDate(connection.last_verified_at)}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={revalidate.isPending}
                      onClick={() => revalidate.mutate(connection.id)}
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      {connection.status === "disconnected" ? "Reconectar" : "Revalidar"}
                    </Button>
                    <Button variant="outline" size="sm" asChild>
                      <a href={connection.manage_url} target="_blank" rel="noreferrer">
                        <ExternalLink className="h-3.5 w-3.5" />
                        Gerenciar no GitHub
                      </a>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={disconnect.isPending || connection.status === "disconnected"}
                      onClick={() => {
                        if (
                          window.confirm(
                            "Desconectar somente do Mael? Isso não desinstala o GitHub App no GitHub.",
                          )
                        ) {
                          disconnect.mutate(connection.id);
                        }
                      }}
                    >
                      <Unplug className="h-3.5 w-3.5" />
                      Desconectar do Mael
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <p className="mt-5 text-xs text-muted-foreground">
            Desconectar do Mael remove apenas a associação local. Para revogar a instalação, use
            “Gerenciar no GitHub”.
          </p>
        </section>
      </div>
    </AppShell>
  );
}
