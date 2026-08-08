/**
 * ReminderScheduler (Etapa 9) — nunca depende do frontend estar aberto.
 *
 * `runDueReminders` é a unidade de trabalho: busca lembretes ativos e
 * vencidos ainda não notificados, dispara o NotificationProvider e marca
 * `notified_at`. Este processo não roda sozinho dentro do app TanStack
 * Start (que só responde a requisições) — ele precisa ser chamado por um
 * agendador externo, por exemplo:
 *
 *   - Supabase: `pg_cron` chamando uma Edge Function a cada minuto, ou
 *   - uma rota HTTP dedicada (ex.: /api/cron/reminders) protegida por um
 *     segredo, disparada por um cron job da hospedagem (Vercel Cron,
 *     Cloudflare Cron Triggers, etc.)
 *
 * Nenhuma dessas opções está conectada ainda — este módulo só prepara a
 * lógica de negócio de forma testável e pronta para ser chamada por
 * qualquer um desses gatilhos, sem exigir que o usuário esteja com o app
 * aberto no navegador (o que o MVP atual efetivamente não garante).
 */

import type { ReminderService } from "../services/reminder.service";
import type { NotificationProvider } from "../providers/notification.provider";
import { logger } from "../core/logger";

export class ReminderScheduler {
  constructor(
    private readonly reminderService: ReminderService,
    private readonly notifications: NotificationProvider,
  ) {}

  async runDueReminders(now: Date = new Date()): Promise<{ processed: number }> {
    const due = await this.reminderService.listDue(now);
    let processed = 0;

    for (const reminder of due) {
      try {
        await this.notifications.send({
          userId: reminder.user_id,
          title: reminder.title,
          body: reminder.notes ?? "",
        });
        await this.reminderService.markNotified(reminder.id, now);
        processed++;
      } catch (err) {
        logger.error("Falha ao processar lembrete vencido", err, {
          route: "reminder-scheduler",
          reminderId: reminder.id,
        });
      }
    }

    return { processed };
  }
}
