import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ListChecks, KeyRound, MessageCircle, LogOut, Plug } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import {
  cachedAuthenticatedUserId,
  isolateAuthenticatedQueryCache,
  shouldClearAuthenticatedCache,
  signOutWithClearedCache,
} from "@/lib/auth/session-cache";
import { getProfile } from "@/lib/profile.functions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const foolLogo = new URL("../assets/fool-logo.svg", import.meta.url).href;

const NAV = [
  { to: "/", label: "Conversa", icon: MessageCircle },
  { to: "/tarefas", label: "Tarefas", icon: ListChecks },
  { to: "/cofre", label: "Cofre", icon: KeyRound },
  { to: "/integracoes", label: "Integrações", icon: Plug },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [signingOut, setSigningOut] = useState(false);
  const transitionVersion = useRef(0);

  useEffect(() => {
    let mounted = true;
    const applySession = async (nextUserId: string | null) => {
      if (!mounted) return;
      const version = ++transitionVersion.current;
      const previousUserId = cachedAuthenticatedUserId(queryClient);
      const mustClear = shouldClearAuthenticatedCache(previousUserId, nextUserId);
      if (mustClear || !nextUserId) {
        setAuthLoading(true);
        setSessionUserId(null);
      }
      await isolateAuthenticatedQueryCache(queryClient, nextUserId);
      if (!mounted || version !== transitionVersion.current) return;
      if (!nextUserId) {
        void navigate({ to: "/auth" });
        return;
      }
      setSessionUserId(nextUserId);
      setAuthLoading(false);
    };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      void applySession(session?.user.id ?? null);
    });

    void supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!mounted) return;
        if (error) {
          console.error("[Auth] Falha ao restaurar sessão no AppShell", {
            code: error.code ?? "session_restore_failed",
          });
          void applySession(null);
          return;
        }
        void applySession(data.session?.user.id ?? null);
      })
      .catch(() => {
        if (!mounted) return;
        console.error("[Auth] Falha inesperada ao restaurar sessão no AppShell");
        void applySession(null);
      });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [navigate, queryClient]);

  const { data: profile } = useQuery({
    queryKey: ["profile", sessionUserId],
    queryFn: () => getProfile(),
    enabled: Boolean(sessionUserId) && !authLoading,
    retry: false,
  });

  async function handleLogout() {
    if (signingOut) return;
    setSigningOut(true);
    setAuthLoading(true);
    setSessionUserId(null);
    const { error } = await signOutWithClearedCache(queryClient, () => supabase.auth.signOut());
    if (!error) {
      void navigate({ to: "/auth" });
      return;
    }

    console.error("[Auth] Falha ao encerrar sessão", {
      code: error.code ?? "sign_out_failed",
    });
    toast.error("Não foi possível sair agora.");
    const { data } = await supabase.auth.getSession();
    const restoredUserId = data.session?.user.id ?? null;
    await isolateAuthenticatedQueryCache(queryClient, restoredUserId);
    if (restoredUserId) {
      setSessionUserId(restoredUserId);
      setAuthLoading(false);
      setSigningOut(false);
    } else {
      void navigate({ to: "/auth" });
    }
  }

  if (authLoading || !sessionUserId) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background">
        <img src={foolLogo} alt="Mael" className="h-16 w-16 animate-pulse" />
        <p className="font-display text-sm tracking-[0.3em] text-muted-foreground uppercase">
          Carregando…
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 w-full max-w-4xl items-center gap-4 px-4">
          <Link to="/" className="flex items-center gap-2.5">
            <img src={foolLogo} alt="Mael" className="h-8 w-8" />
            <div className="leading-none">
              <span className="font-display text-lg font-bold tracking-[0.18em] text-primary gold-glow">
                MAEL
              </span>
              <span className="block text-[0.6rem] tracking-[0.28em] text-muted-foreground uppercase">
                Assistente pessoal
              </span>
            </div>
          </Link>

          <nav className="ml-auto flex items-center gap-1">
            {NAV.map(({ to, label, icon: Icon }) => {
              const active = location.pathname === to;
              return (
                <Link
                  key={to}
                  to={to}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
                    active
                      ? "bg-accent text-primary"
                      : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span className="hidden sm:inline">{label}</span>
                </Link>
              );
            })}
            <span className="mx-1 hidden h-5 w-px bg-border sm:block" />
            {profile?.name && (
              <span className="hidden max-w-32 truncate text-sm text-muted-foreground md:inline">
                {profile.name}
              </span>
            )}
            <Button
              variant="ghost"
              size="icon"
              title="Sair"
              disabled={signingOut}
              onClick={() => void handleLogout()}
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
