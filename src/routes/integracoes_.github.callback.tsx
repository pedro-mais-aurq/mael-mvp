import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Github } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { completeGitHubConnection } from "@/lib/github.functions";

export const Route = createFileRoute("/integracoes_/github/callback")({
  component: GitHubCallbackPage,
});

function GitHubCallbackPage() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    const oauthError = params.has("error") || params.has("error_description");
    window.history.replaceState({}, document.title, window.location.pathname);

    if (oauthError || !code || !state) {
      setError("A autorização do GitHub foi cancelada ou não pôde ser concluída.");
      return;
    }

    void completeGitHubConnection({ data: { code, state } })
      .then(() => {
        if (mounted) window.location.replace("/integracoes?github=connected");
      })
      .catch(() => {
        if (mounted) setError("Não foi possível concluir a conexão com o GitHub.");
      });

    return () => {
      mounted = false;
    };
  }, []);

  return (
    <AppShell>
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="panel-card max-w-md p-6 pt-8 text-center">
          <Github className="mx-auto h-9 w-9 text-primary" />
          <h1 className="mt-3 text-lg font-semibold">Concluindo conexão GitHub</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {error ?? "Confirmando sua identidade e o acesso à instalação selecionada…"}
          </p>
          {error && (
            <Button className="mt-5" variant="outline" asChild>
              <Link to="/integracoes">Voltar às Integrações</Link>
            </Button>
          )}
        </div>
      </div>
    </AppShell>
  );
}
