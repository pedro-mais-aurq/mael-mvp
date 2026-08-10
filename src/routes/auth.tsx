import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { hasOAuthCallbackError, startGoogleOAuth } from "@/lib/auth/google-oauth";

const foolLogo = new URL("../assets/fool-logo.svg", import.meta.url).href;

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Entrar — Mael" },
      {
        name: "description",
        content: "Acesse sua conta Mael com o Google.",
      },
      { property: "og:title", content: "Entrar — Mael" },
      { property: "og:description", content: "Entre no Mael com sua conta Google." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    let redirectStarted = false;
    const redirectAuthenticatedUser = () => {
      if (!mounted || redirectStarted) return;
      redirectStarted = true;
      void navigate({ to: "/" });
    };

    if (hasOAuthCallbackError(window.location.search, window.location.hash)) {
      setError("Não foi possível entrar com o Google agora.");
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) redirectAuthenticatedUser();
    });

    void supabase.auth
      .getSession()
      .then(({ data, error: sessionError }) => {
        if (!mounted) return;
        if (sessionError) {
          console.error("[Auth] Falha ao restaurar sessão", {
            code: sessionError.code ?? "session_restore_failed",
          });
          setError("Não foi possível verificar sua sessão agora.");
          setCheckingSession(false);
          return;
        }
        if (data.session?.user) {
          redirectAuthenticatedUser();
          return;
        }
        setCheckingSession(false);
      })
      .catch(() => {
        if (!mounted) return;
        console.error("[Auth] Falha inesperada ao restaurar sessão");
        setError("Não foi possível verificar sua sessão agora.");
        setCheckingSession(false);
      });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [navigate]);

  async function signInWithGoogle() {
    setBusy(true);
    setError(null);
    try {
      const { data, error: oauthError } = await startGoogleOAuth(
        supabase.auth,
        window.location.origin,
      );
      if (!oauthError && data.url) return;

      console.error("[Auth] Google OAuth não iniciado", {
        provider: "google",
        code: oauthError?.code ?? "oauth_redirect_missing",
      });
      setError("Não foi possível entrar com o Google agora.");
      setBusy(false);
    } catch {
      console.error("[Auth] Falha inesperada ao iniciar Google OAuth", {
        provider: "google",
      });
      setError("Não foi possível entrar com o Google agora.");
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-10">
      <div className="mb-8 flex flex-col items-center text-center">
        <img src={foolLogo} alt="Mael" className="h-28 w-28" />
        <h1 className="font-display mt-4 text-4xl font-bold tracking-[0.22em] text-primary gold-glow">
          MAEL
        </h1>
        <p className="font-display mt-1 text-xs tracking-[0.42em] text-muted-foreground uppercase">
          Assistente pessoal
        </p>
      </div>

      <div className="panel-card w-full max-w-sm p-6 pt-8">
        <p className="mb-5 text-center text-sm text-muted-foreground">
          Entre com sua conta Google para acessar suas tarefas, conversas e Cofre.
        </p>

        {error && <p className="mb-4 text-center text-sm text-destructive">{error}</p>}

        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={busy || checkingSession}
          onClick={() => void signInWithGoogle()}
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="currentColor"
              d="M21.35 11.1h-9.17v2.73h6.51c-.33 3.81-3.5 5.44-6.5 5.44C8.36 19.27 5 16.25 5 12c0-4.1 3.2-7.27 7.2-7.27 3.09 0 4.9 1.97 4.9 1.97L19 4.72S16.56 2 12.1 2C6.42 2 2.03 6.8 2.03 12c0 5.05 4.13 10 10.22 10 5.35 0 9.25-3.67 9.25-9.09 0-1.15-.15-1.81-.15-1.81Z"
            />
          </svg>
          {checkingSession
            ? "Verificando sessão…"
            : busy
              ? "Redirecionando…"
              : "Continuar com Google"}
        </Button>
      </div>

      <p className="mt-6 max-w-xs text-center text-xs text-muted-foreground">
        Seu Cofre permanece zero-knowledge: ninguém além de você consegue ler suas senhas.
      </p>
    </div>
  );
}
