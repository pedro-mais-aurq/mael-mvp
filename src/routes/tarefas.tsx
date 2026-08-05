import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { createTask, deleteTask, listTasks, toggleTask } from "@/lib/tasks.functions";
import type { Priority, TaskRow } from "@/lib/mael-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/tarefas")({
  head: () => ({
    meta: [
      { title: "Tarefas — Mael" },
      { name: "description", content: "Suas tarefas anotadas no pergaminho do Louco: crie, conclua e organize por prioridade." },
      { property: "og:title", content: "Tarefas — Mael" },
      { property: "og:description", content: "Gerencie as tarefas que O Louco anotou para você." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TasksPage,
});

const PRIORITY_LABEL: Record<Priority, string> = {
  alta: "Alta",
  media: "Média",
  baixa: "Baixa",
};

function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "text-[0.65rem]",
        priority === "alta" && "border-destructive/60 text-destructive",
        priority === "media" && "border-primary/60 text-primary",
        priority === "baixa" && "border-border text-muted-foreground",
      )}
    >
      {PRIORITY_LABEL[priority]}
    </Badge>
  );
}

function TasksPage() {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<Priority>("media");
  const [dueDate, setDueDate] = useState("");

  const { data: tasks, isLoading } = useQuery({
    queryKey: ["tasks"],
    queryFn: () => listTasks(),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["tasks"] });

  const addMutation = useMutation({
    mutationFn: () =>
      createTask({
        data: { title: title.trim(), priority, due_date: dueDate || null },
      }),
    onSuccess: () => {
      setTitle("");
      setDueDate("");
      setPriority("media");
      invalidate();
      toast.success("Tarefa anotada no pergaminho.");
    },
    onError: () => toast.error("Não consegui anotar a tarefa."),
  });

  const toggleMutation = useMutation({
    mutationFn: (task: TaskRow) =>
      toggleTask({ data: { id: task.id, completed: !task.completed } }),
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteTask({ data: { id } }),
    onSuccess: () => {
      invalidate();
      toast.success("Tarefa riscada do pergaminho.");
    },
  });

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl">
        <h1 className="font-display text-xl font-bold tracking-[0.15em] text-primary uppercase gold-glow">
          Tarefas
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          O pergaminho do Louco — o que precisa ser feito, na ordem em que o vento sopra.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim()) addMutation.mutate();
          }}
          className="tarot-card mt-5 flex flex-col gap-3 p-4 pt-6 sm:flex-row sm:items-end"
        >
          <div className="flex-1">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Nova tarefa…"
              aria-label="Título da tarefa"
            />
          </div>
          <div className="flex gap-2">
            <Input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-36"
              aria-label="Data de vencimento"
            />
            <Select value={priority} onValueChange={(v) => setPriority(v as Priority)}>
              <SelectTrigger className="w-28" aria-label="Prioridade">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="baixa">Baixa</SelectItem>
                <SelectItem value="media">Média</SelectItem>
                <SelectItem value="alta">Alta</SelectItem>
              </SelectContent>
            </Select>
            <Button type="submit" size="icon" disabled={addMutation.isPending || !title.trim()}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </form>

        <div className="mt-5 space-y-2">
          {isLoading ? (
            <p className="py-10 text-center text-sm text-muted-foreground italic">
              Desenrolando o pergaminho…
            </p>
          ) : !tasks?.length ? (
            <div className="tarot-card py-12 text-center">
              <p className="font-display text-sm tracking-[0.25em] text-muted-foreground uppercase">
                O pergaminho está em branco
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                Anote acima ou peça ao Louco na Conversa.
              </p>
            </div>
          ) : (
            tasks.map((task) => (
              <div
                key={task.id}
                className={cn(
                  "group flex items-center gap-3 rounded-lg border border-border/70 bg-card px-4 py-3 transition-colors",
                  task.completed && "opacity-55",
                )}
              >
                <Checkbox
                  checked={task.completed}
                  onCheckedChange={() => toggleMutation.mutate(task)}
                  aria-label={task.completed ? "Reabrir tarefa" : "Concluir tarefa"}
                />
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "truncate text-sm font-medium",
                      task.completed && "line-through",
                    )}
                  >
                    {task.title}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {task.due_date
                      ? `até ${format(new Date(`${task.due_date}T00:00:00`), "d 'de' MMMM", { locale: ptBR })}${task.due_time ? ` às ${task.due_time}` : ""}`
                      : "sem data"}
                    {task.category ? ` · ${task.category}` : ""}
                  </p>
                </div>
                <PriorityBadge priority={task.priority} />
                <Button
                  variant="ghost"
                  size="icon"
                  className="opacity-0 transition-opacity group-hover:opacity-100"
                  onClick={() => deleteMutation.mutate(task.id)}
                  title="Excluir tarefa"
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ))
          )}
        </div>
      </div>
    </AppShell>
  );
}
