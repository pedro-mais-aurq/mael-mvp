/**
 * NotificationProvider (Etapa 7 / Etapa 9) — abstração para o que acontece
 * quando um lembrete vence. Hoje o frontend não tem push/e-mail/SMS
 * integrado, então a implementação padrão só loga; trocar para
 * push/e-mail no futuro é implementar uma nova classe, sem tocar no
 * ReminderScheduler.
 */

import { logger } from "../core/logger";

export interface NotificationPayload {
  userId: string;
  title: string;
  body: string;
}

export interface NotificationProvider {
  send(payload: NotificationPayload): Promise<void>;
}

export class LoggingNotificationProvider implements NotificationProvider {
  async send(payload: NotificationPayload): Promise<void> {
    logger.info("Notificação de lembrete disparada", {
      route: "notification.provider",
      userId: payload.userId,
      title: payload.title,
    });
  }
}
