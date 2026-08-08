import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, isPast } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Bell, BellOff, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import {
  createReminder,
  deleteReminder,
  listReminders,
  toggleReminder,
} from "@/lib/reminders.functions";
import type { ReminderRow } from "@/lib/mael-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/lembretes")({
  head: () => ({
    meta: [
      { title: "Lembretes — Mael" },
      {
        name: "description",
        content: "Lembretes que tocam na hora certa, criados por voz ou à mão.",
      },
      { property: "og:title", content: "Lembretes — Mael" },
      { property: "og:description", content: "Gerencie seus lembretes." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RemindersPage,
});

function RemindersPage() {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState("");

  const { data: reminders, isLoading } = useQuery({
    queryKey: ["reminders"],
    queryFn: () => listReminders(),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["reminders"] });

  const addMutation = useMutation({
    mutationFn: () =>
      createReminder({
        data: { title: title.trim(), remind_at: new Date(when).toISOString() },
      }),
    onSuccess: () => {
      setTitle("");
      setWhen("");
      invalidate();
      toast.success("Lembrete criado.");
    },
    onError: () => toast.error("Não consegui gravar o lembrete."),
  });

  const toggleMutation = useMutation({
    mutationFn: (reminder: ReminderRow) =>
      toggleReminder({ data: { id: reminder.id, active: !reminder.active } }),
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteReminder({ data: { id } }),
    onSuccess: () => {
      invalidate();
      toast.success("Lembrete silenciado para sempre.");
    },
  });

  const upcoming = reminders?.filter((r) => !isPast(new Date(r.remind_at))) ?? [];
  const past = reminders?.filter((r) => isPast(new Date(r.remind_at))) ?? [];

  function ReminderItem({ reminder }: { reminder: ReminderRow }) {
    const remindAt = new Date(reminder.remind_at);
    return (
      <div
        className={cn(
          "group flex items-center gap-3 rounded-lg border border-border/70 bg-card px-4 py-3",
          !reminder.active && "opacity-55",
        )}
      >
        <button
          onClick={() => toggleMutation.mutate(reminder)}
          title={reminder.active ? "Silenciar lembrete" : "Reativar lembrete"}
          className="text-primary transition-colors hover:text-primary/70"
        >
          {reminder.active ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{reminder.title}</p>
          <p className="text-xs text-muted-foreground">
            {format(remindAt, "d 'de' MMMM 'às' HH:mm", { locale: ptBR })}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="opacity-0 transition-opacity group-hover:opacity-100"
          onClick={() => deleteMutation.mutate(reminder.id)}
          title="Excluir lembrete"
        >
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </div>
    );
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl">
        <h1 className="font-display text-xl font-bold tracking-[0.15em] text-primary uppercase gold-glow">
          Lembretes
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Cada lembrete dispara uma única vez, exatamente quando deve.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim() && when) addMutation.mutate();
          }}
          className="panel-card mt-5 flex flex-col gap-3 p-4 pt-6 sm:flex-row sm:items-end"
        >
          <div className="flex-1">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Lembrar de…"
              aria-label="Título do lembrete"
            />
          </div>
          <div className="flex gap-2">
            <Input
              type="datetime-local"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              className="w-52"
              aria-label="Data e hora do lembrete"
            />
            <Button
              type="submit"
              size="icon"
              disabled={addMutation.isPending || !title.trim() || !when}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </form>

        {isLoading ? (
          <p className="py-10 text-center text-sm text-muted-foreground italic">
            Carregando lembretes…
          </p>
        ) : !reminders?.length ? (
          <div className="panel-card mt-5 py-12 text-center">
            <p className="font-display text-sm tracking-[0.25em] text-muted-foreground uppercase">
              Nenhum lembrete
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Crie acima ou peça ao Mael na Conversa.
            </p>
          </div>
        ) : (
          <>
            {upcoming.length > 0 && (
              <>
                <h2 className="font-display mt-6 mb-2 text-xs tracking-[0.3em] text-muted-foreground uppercase">
                  Por tocar
                </h2>
                <div className="space-y-2">
                  {upcoming.map((r) => (
                    <ReminderItem key={r.id} reminder={r} />
                  ))}
                </div>
              </>
            )}
            {past.length > 0 && (
              <>
                <h2 className="font-display mt-6 mb-2 text-xs tracking-[0.3em] text-muted-foreground uppercase">
                  Já tocaram
                </h2>
                <div className="space-y-2 opacity-70">
                  {past.map((r) => (
                    <ReminderItem key={r.id} reminder={r} />
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
