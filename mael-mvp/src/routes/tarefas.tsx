import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Bell, BellOff, CalendarClock, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import {
  clearTaskReminder,
  createTask,
  deleteTask,
  listTasks,
  setTaskReminderEnabled,
  toggleTask,
} from "@/lib/tasks.functions";
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
      {
        name: "description",
        content: "Tarefas, prazos e lembretes reunidos em um só lugar.",
      },
      { property: "og:title", content: "Tarefas — Mael" },
      { property: "og:description", content: "Gerencie tarefas, prazos e lembretes." },
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

function formatLocalDateTime(value: string): string {
  return format(new Date(value), "d 'de' MMMM 'às' HH:mm", { locale: ptBR });
}

function dueLabel(task: TaskRow): string | null {
  if (task.due_at) return `Prazo: ${formatLocalDateTime(task.due_at)}`;
  if (!task.due_date) return null;
  const date = format(new Date(`${task.due_date}T00:00:00`), "d 'de' MMMM", { locale: ptBR });
  return `Prazo: ${date}${task.due_time ? ` às ${task.due_time}` : ""}`;
}

function localDateTimeToIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Data e hora inválidas.");
  return date.toISOString();
}

function TaskItem({
  task,
  onToggle,
  onDelete,
  onSetReminderEnabled,
  onClearReminder,
}: {
  task: TaskRow;
  onToggle: (task: TaskRow) => void;
  onDelete: (id: string) => void;
  onSetReminderEnabled: (id: string, enabled: boolean) => void;
  onClearReminder: (id: string) => void;
}) {
  const deadline = dueLabel(task);
  const reminderEnabled = task.reminder_enabled ?? true;

  return (
    <div
      className={cn(
        "group flex items-start gap-3 rounded-lg border border-border/70 bg-card px-4 py-3 transition-colors",
        task.completed && "opacity-55",
      )}
    >
      <Checkbox
        checked={task.completed}
        onCheckedChange={() => onToggle(task)}
        aria-label={task.completed ? "Reabrir tarefa" : "Concluir tarefa"}
        className="mt-0.5"
      />
      <div className="min-w-0 flex-1">
        <p className={cn("truncate text-sm font-medium", task.completed && "line-through")}>
          {task.title}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {deadline && (
            <span className="inline-flex items-center gap-1">
              <CalendarClock className="h-3.5 w-3.5" />
              {deadline}
            </span>
          )}
          {task.remind_at && (
            <>
              <span className="inline-flex items-center gap-1">
                {reminderEnabled ? (
                  <Bell className="h-3.5 w-3.5 text-primary" />
                ) : (
                  <BellOff className="h-3.5 w-3.5" />
                )}
                Lembrete: {formatLocalDateTime(task.remind_at)}
                {!reminderEnabled && " (desativado)"}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-2 text-xs"
                onClick={() => onSetReminderEnabled(task.id, !reminderEnabled)}
              >
                {reminderEnabled ? (
                  <>
                    <BellOff className="h-3.5 w-3.5" />
                    Silenciar lembrete
                  </>
                ) : (
                  <>
                    <Bell className="h-3.5 w-3.5" />
                    Reativar lembrete
                  </>
                )}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-2 text-xs text-destructive hover:text-destructive"
                onClick={() => onClearReminder(task.id)}
              >
                <X className="h-3.5 w-3.5" />
                Remover lembrete
              </Button>
            </>
          )}
          {!deadline && !task.remind_at && <span>Sem prazo ou lembrete</span>}
          {task.category && <span>Categoria: {task.category}</span>}
        </div>
      </div>
      <PriorityBadge priority={task.priority} />
      <Button
        variant="ghost"
        size="icon"
        className="opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100"
        onClick={() => onDelete(task.id)}
        title="Excluir tarefa"
      >
        <Trash2 className="h-4 w-4 text-destructive" />
      </Button>
    </div>
  );
}

function TaskGroup({
  title,
  tasks,
  onToggle,
  onDelete,
  onSetReminderEnabled,
  onClearReminder,
}: {
  title: string;
  tasks: TaskRow[];
  onToggle: (task: TaskRow) => void;
  onDelete: (id: string) => void;
  onSetReminderEnabled: (id: string, enabled: boolean) => void;
  onClearReminder: (id: string) => void;
}) {
  if (tasks.length === 0) return null;
  return (
    <section>
      <h2 className="font-display mt-6 mb-2 text-xs tracking-[0.3em] text-muted-foreground uppercase">
        {title}
      </h2>
      <div className="space-y-2">
        {tasks.map((task) => (
          <TaskItem
            key={task.id}
            task={task}
            onToggle={onToggle}
            onDelete={onDelete}
            onSetReminderEnabled={onSetReminderEnabled}
            onClearReminder={onClearReminder}
          />
        ))}
      </div>
    </section>
  );
}

function TasksPage() {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<Priority>("media");
  const [dueAt, setDueAt] = useState("");
  const [remindAt, setRemindAt] = useState("");

  const { data: tasks, isLoading } = useQuery({
    queryKey: ["tasks"],
    queryFn: () => listTasks(),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["tasks"] });

  const addMutation = useMutation({
    mutationFn: () =>
      createTask({
        data: {
          title: title.trim(),
          priority,
          due_at: localDateTimeToIso(dueAt),
          remind_at: localDateTimeToIso(remindAt),
        },
      }),
    onSuccess: () => {
      setTitle("");
      setDueAt("");
      setRemindAt("");
      setPriority("media");
      invalidate();
      toast.success("Tarefa criada.");
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
      toast.success("Tarefa excluída.");
    },
  });

  const reminderEnabledMutation = useMutation({
    mutationFn: ({ taskId, enabled }: { taskId: string; enabled: boolean }) =>
      setTaskReminderEnabled({ data: { taskId, enabled } }),
    onSuccess: (_, { enabled }) => {
      invalidate();
      toast.success(enabled ? "Lembrete reativado." : "Lembrete silenciado.");
    },
    onError: () => toast.error("Não consegui alterar o lembrete."),
  });

  const clearReminderMutation = useMutation({
    mutationFn: (taskId: string) => clearTaskReminder({ data: { taskId } }),
    onSuccess: () => {
      invalidate();
      toast.success("Lembrete removido. A tarefa foi mantida.");
    },
    onError: () => toast.error("Não consegui remover o lembrete."),
  });

  const pendingTasks = tasks?.filter((task) => !task.completed) ?? [];
  const completedTasks = tasks?.filter((task) => task.completed) ?? [];

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl">
        <h1 className="font-display text-xl font-bold tracking-[0.15em] text-primary uppercase gold-glow">
          Tarefas
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Tarefas, prazos e lembretes reunidos em um só lugar.
        </p>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (title.trim()) addMutation.mutate();
          }}
          className="panel-card mt-5 grid gap-3 p-4 pt-6 sm:grid-cols-2"
        >
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Nova tarefa…"
            aria-label="Título da tarefa"
            className="sm:col-span-2"
          />
          <div>
            <label className="mb-1.5 block text-xs text-muted-foreground" htmlFor="task-due-at">
              Prazo opcional
            </label>
            <Input
              id="task-due-at"
              type="datetime-local"
              value={dueAt}
              onChange={(event) => setDueAt(event.target.value)}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs text-muted-foreground" htmlFor="task-remind-at">
              Lembrete opcional
            </label>
            <Input
              id="task-remind-at"
              type="datetime-local"
              value={remindAt}
              onChange={(event) => setRemindAt(event.target.value)}
            />
          </div>
          <div className="flex items-end gap-2 sm:col-span-2">
            <Select value={priority} onValueChange={(value) => setPriority(value as Priority)}>
              <SelectTrigger className="w-32" aria-label="Prioridade">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="baixa">Baixa</SelectItem>
                <SelectItem value="media">Média</SelectItem>
                <SelectItem value="alta">Alta</SelectItem>
              </SelectContent>
            </Select>
            <Button
              type="submit"
              className="ml-auto"
              disabled={addMutation.isPending || !title.trim()}
            >
              <Plus className="h-4 w-4" />
              Adicionar
            </Button>
          </div>
        </form>

        {isLoading ? (
          <p className="py-10 text-center text-sm text-muted-foreground italic">
            Carregando tarefas…
          </p>
        ) : !tasks?.length ? (
          <div className="panel-card mt-5 py-12 text-center">
            <p className="font-display text-sm tracking-[0.25em] text-muted-foreground uppercase">
              Nenhuma tarefa
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Crie acima ou peça ao Mael na Conversa.
            </p>
          </div>
        ) : (
          <>
            <TaskGroup
              title="A fazer"
              tasks={pendingTasks}
              onToggle={(task) => toggleMutation.mutate(task)}
              onDelete={(id) => deleteMutation.mutate(id)}
              onSetReminderEnabled={(taskId, enabled) =>
                reminderEnabledMutation.mutate({ taskId, enabled })
              }
              onClearReminder={(taskId) => clearReminderMutation.mutate(taskId)}
            />
            <TaskGroup
              title="Concluídas"
              tasks={completedTasks}
              onToggle={(task) => toggleMutation.mutate(task)}
              onDelete={(id) => deleteMutation.mutate(id)}
              onSetReminderEnabled={(taskId, enabled) =>
                reminderEnabledMutation.mutate({ taskId, enabled })
              }
              onClearReminder={(taskId) => clearReminderMutation.mutate(taskId)}
            />
          </>
        )}
      </div>
    </AppShell>
  );
}
