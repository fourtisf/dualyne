import type { FastifyBaseLogger } from "fastify";
import type { Redis } from "ioredis";

export type Alerter = (text: string) => Promise<void>;

export interface AlertTargets {
  /** Slack or Discord incoming webhook (Slack reads `text`, Discord `content`). */
  webhookUrl?: string;
  /** Telegram bot: messages go to `chatId`. */
  telegram?: { token: string; chatId: string; apiUrl: string };
}

/** Logs a warning and sends it to every configured target. Never throws. */
export function createAlerter(log: FastifyBaseLogger, targets: AlertTargets = {}): Alerter {
  return async (text: string) => {
    log.warn({ alert: text }, "alert");
    const sends: Promise<void>[] = [];
    if (targets.webhookUrl) {
      const url = targets.webhookUrl;
      sends.push(
        fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text, content: text }),
          signal: AbortSignal.timeout(5000),
        }).then(
          (res) => {
            if (!res.ok) log.error({ status: res.status }, "alert webhook failed");
          },
          (err: unknown) => log.error({ err }, "alert webhook failed"),
        ),
      );
    }
    if (targets.telegram) {
      const { token, chatId, apiUrl } = targets.telegram;
      sends.push(
        fetch(`${apiUrl.replace(/\/$/, "")}/bot${token}/sendMessage`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text: `⚠️ Dualyne: ${text}`,
            disable_web_page_preview: true,
          }),
          signal: AbortSignal.timeout(5000),
        }).then(
          // The bot token is part of the URL: log the status only, never the URL or error details.
          (res) => {
            if (!res.ok) log.error({ status: res.status }, "telegram alert failed");
          },
          () => log.error("telegram alert failed (network)"),
        ),
      );
    }
    await Promise.all(sends);
  };
}

/** Send `text` at most once per `ttlSeconds` for the same `key` (for alerts that could repeat). */
export async function alertOnce(
  redis: Redis,
  alert: Alerter,
  key: string,
  ttlSeconds: number,
  text: string,
): Promise<void> {
  const first = await redis.set(`alert:${key}`, "1", "EX", ttlSeconds, "NX");
  if (first) await alert(text);
}
