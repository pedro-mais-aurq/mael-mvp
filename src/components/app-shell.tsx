import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ListChecks, Bell, KeyRound, MessageCircle, LogOut } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { getProfile } from "@/lib/profile.functions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const foolLogo = new URL("../assets/fool-logo.svg", import.meta.url).href;

const NAV = [
  { to: "/", label: "Conversa", icon: MessageCircle },
  { to: "/tarefas", label: "Tarefas", icon: ListChecks },
  { to: "/lembretes", label: "Lembretes", icon: Bell },
  { to: "/cofre", label: "Cofre", icon: KeyRound },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) navigate({ to: "/auth" });
    });
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      if (!data.session) {
        navigate({ to: "/auth" });
      } else {
        setReady(true);
      }
    });
    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [navigate]);

  const { data: profile } = useQuery({
    queryKey: ["profile"],
    queryFn: () => getProfile(),
    enabled: ready,
    retry: false,
  });

  if (!ready) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background">
        <img src={foolLogo} alt="O Louco" className="h-16 w-16 animate-pulse" />
        <p className="font-display text-sm tracking-[0.3em] text-muted-foreground uppercase">
          Abrindo a tiragem…
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 w-full max-w-4xl items-center gap-4 px-4">
          <Link to="/" className="flex items-center gap-2.5">
            <img src={foolLogo} alt="O Louco" className="h-8 w-8" />
            <div className="leading-none">
              <span className="font-display text-lg font-bold tracking-[0.18em] text-primary gold-glow">
                MAEL
              </span>
              <span className="block text-[0.6rem] tracking-[0.28em] text-muted-foreground uppercase">
                0 · O Louco
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
              onClick={async () => {
                await supabase.auth.signOut();
                navigate({ to: "/auth" });
              }}
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
