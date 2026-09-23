import type { FastifyBaseLogger } from "fastify";

export type Alerter = (text: string) => Promise<void>;

/** Logs a warning and, when ALERT_WEBHOOK_URL is set, posts it (Slack uses `text`, Discord `content`). */
export function createAlerter(log: FastifyBaseLogger, webhookUrl?: string): Alerter {
  return async (text: string) => {
    log.warn({ alert: text }, "alert");
    if (!webhookUrl) return;
    try {
      await fetch(webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, content: text }),
        signal: AbortSignal.timeout(5000),
      });
    } catch (err) {
      log.error({ err }, "alert webhook failed");
    }
  };
}
