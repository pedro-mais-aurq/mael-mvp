import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/lembretes")({
  beforeLoad: () => {
    throw redirect({ to: "/tarefas" });
  },
});
