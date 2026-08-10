import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Github } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { prepareGitHubVerification } from "@/lib/github.functions";

export const Route = createFileRoute("/integracoes_/github/setup")({
  component: GitHubSetupPage,
});

function GitHubSetupPage() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const params = new URLSearchParams(window.location.search);
    const state = params.get("state");
    const installationId = params.get("installation_id");
    const setupAction = params.get("setup_action");
    window.history.replaceState({}, document.title, window.location.pathname);

    if (!state || !installationId) {
      setError("A instalação não retornou os dados necessários.");
      return;
    }

    void prepareGitHubVerification({
      data: { state, installation_id: installationId, setup_action: setupAction },
    })
      .then((result) => {
        if (!mounted) return;
        const url = new URL(result.url);
        if (url.protocol !== "https:" || url.hostname !== "github.com") {
          setError("A autorização retornou um endereço inválido.");
          return;
        }
        window.location.replace(url.toString());
      })
      .catch(() => {
        if (mounted) setError("Não foi possível validar a instalação do GitHub.");
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
          <h1 className="mt-3 text-lg font-semibold">Validando instalação GitHub</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {error ?? "Aguarde enquanto preparamos a autorização segura da sua conta GitHub…"}
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
