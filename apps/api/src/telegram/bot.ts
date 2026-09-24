import type { FastifyBaseLogger } from "fastify";
import { brand } from "@dualyne/config";
import type { AppContext } from "../context";

/**
 * @dualynebot: answers commands. The owner's chat (TELEGRAM_CHAT_ID) gets /status and /credit;
 * anyone else who finds the bot gets a short, professional welcome with links. Alerts are sent
 * separately (lib/alert.ts). Uses long polling, so no public webhook is needed.
 */
export interface BotConfig {
  token: string;
  ownerChatId: string;
  apiUrl: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: { chat?: { id?: number | string }; text?: string };
}

const POLL_SECONDS = 25;
/** One reply per chat per this many seconds, so a stuck client can't make the bot loop. */
const REPLY_GAP_SECONDS = 2;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const usd = (micro: number) => `$${(micro / 1_000_000).toFixed(2)}`;

const PUBLIC_COMMANDS = [
  { command: "start", description: "What Dualyne is" },
  { command: "about", description: "Links: chat, compare, docs" },
];
const OWNER_COMMANDS = [
  { command: "status", description: "Site, API, usage and spend today" },
  { command: "credit", description: "OpenRouter credit left" },
  { command: "help", description: "Commands and alerts" },
];

export function welcomeText(): string {
  const site = brand.siteUrl;
  return [
    `<b>${brand.name}</b>: every AI model, one prompt away.`,
    "",
    "Chat with Claude, Llama, DeepSeek, Mistral and more for free, compare two answers side by side, and use one API key for all of them.",
    "",
    `• Chat: ${site}/chat`,
    `• Compare models: ${site}/#compare`,
    `• API docs: ${site}/docs`,
    "",
    `This bot sends service updates to the ${brand.name} team. For help, visit ${site}.`,
  ].join("\n");
}

export function ownerHelpText(): string {
  return [
    `<b>${brand.name} admin</b>`,
    "",
    "/status: site, API, usage and spend today",
    "/credit: OpenRouter credit left",
    "/help: this list",
    "",
    "Alerts arrive here automatically: the site going down or coming back, OpenRouter credit running low or out, and the daily budget being reached.",
  ].join("\n");
}

async function check(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function statusText(ctx: AppContext): Promise<string> {
  const { env } = ctx;
  const now = ctx.clock();
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const webPort = process.env.WEB_PORT;
  const [db, redis, site, liveModels, bySource, spent, credit] = await Promise.all([
    ctx.prisma.$queryRaw`SELECT 1`.then(
      () => true,
      () => false,
    ),
    ctx.redis.ping().then(
      (r) => r === "PONG",
      () => false,
    ),
    check(webPort ? `http://127.0.0.1:${webPort}/health` : `https://${env.SITE_DOMAIN}/`),
    ctx.prisma.model.count({ where: { enabled: true, missingSince: null } }).catch(() => null),
    ctx.prisma.usageLog
      .groupBy({ by: ["source"], where: { createdAt: { gte: dayStart } }, _count: { _all: true } })
      .catch(() => []),
    ctx.budget.spentMicro().catch(() => null),
    env.OPENROUTER_API_KEY ? ctx.openrouter.creditsLeft() : Promise.resolve(null),
  ]);
  const count = (s: string) => bySource.find((r) => r.source === s)?._count._all ?? 0;
  const mark = (ok: boolean) => (ok ? "✅" : "🔴");
  return [
    `<b>${brand.name} status</b>`,
    "",
    `${mark(site)} Website: ${site ? "online" : "not answering"} (${esc(env.SITE_DOMAIN)})`,
    `${mark(db && redis)} API: online · database ${db ? "ok" : "down"} · cache ${redis ? "ok" : "down"}`,
    `🤖 Models live: ${liveModels ?? "?"}`,
    `📊 Today (UTC): ${count("chat")} chats · ${count("compare")} comparisons · ${count("api")} API calls`,
    `💵 Spend today: ${spent === null ? "?" : usd(spent)} of $${env.DAILY_BUDGET_USD.toFixed(2)} budget`,
    env.OPENROUTER_API_KEY
      ? `💳 OpenRouter credit: ${credit === null ? "unavailable" : `$${Math.max(0, credit).toFixed(2)} left`}`
      : "💳 OpenRouter: no key yet (preview mode)",
  ].join("\n");
}

export async function creditText(ctx: AppContext): Promise<string> {
  if (!ctx.env.OPENROUTER_API_KEY) return "No OpenRouter key yet: the site runs in preview mode.";
  const left = await ctx.openrouter.creditsLeft();
  if (left === null) return "OpenRouter didn't report the credit right now. Try again in a minute.";
  const low = left < ctx.env.OPENROUTER_LOW_BALANCE_USD;
  return [
    `<b>OpenRouter credit</b>: $${Math.max(0, left).toFixed(2)} left`,
    low ? "⚠️ Below the alert level. Top up at https://openrouter.ai/settings/credits" : "Enough for now.",
  ].join("\n");
}

/** The reply to one incoming message, or null to stay quiet. */
export async function replyFor(
  ctx: AppContext,
  cfg: BotConfig,
  update: TelegramUpdate,
): Promise<string | null> {
  const text = update.message?.text?.trim();
  const chat = update.message?.chat?.id;
  if (!text || chat === undefined) return null;
  const owner = String(chat) === cfg.ownerChatId;
  const command = text.startsWith("/") ? text.split(/\s+/)[0]!.split("@")[0]!.toLowerCase() : "";

  if (owner) {
    switch (command) {
      case "/status":
        return statusText(ctx);
      case "/credit":
        return creditText(ctx);
      case "/about":
        return welcomeText();
      default:
        return ownerHelpText();
    }
  }
  if (command === "/status" || command === "/credit") {
    return `This command is for the ${brand.name} team.\n\n${welcomeText()}`;
  }
  return welcomeText();
}

export class TelegramBot {
  private running = false;
  private abort: AbortController | null = null;
  private offset = 0;

  constructor(
    private readonly ctx: AppContext,
    private readonly log: FastifyBaseLogger,
    private readonly cfg: BotConfig,
  ) {}

  private async call(method: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    const res = await fetch(`${this.cfg.apiUrl.replace(/\/$/, "")}/bot${this.cfg.token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: signal ?? AbortSignal.timeout(15_000),
    });
    // Never log the URL: it holds the token.
    if (!res.ok) throw new Error(`telegram ${method} returned ${res.status}`);
    return ((await res.json()) as { result?: unknown }).result;
  }

  /** Command menu and profile texts, so the bot looks finished to anyone who opens it. */
  async setUpProfile(): Promise<void> {
    const steps: [string, Record<string, unknown>][] = [
      ["setMyCommands", { commands: PUBLIC_COMMANDS }],
      ["setMyCommands", { commands: OWNER_COMMANDS, scope: { type: "chat", chat_id: this.cfg.ownerChatId } }],
      [
        "setMyShortDescription",
        { short_description: `${brand.name}: every AI model, one prompt away. ${brand.siteUrl}` },
      ],
      [
        "setMyDescription",
        {
          description: `${brand.name} lets you chat with Claude, Llama, DeepSeek, Mistral and more, compare answers side by side, and use one API key for every model.\n\nOpen ${brand.siteUrl}`,
        },
      ],
    ];
    for (const [method, body] of steps) {
      await this.call(method, body).catch((err: Error) =>
        this.log.warn({ msg: err.message }, "telegram setup"),
      );
    }
  }

  async handle(update: TelegramUpdate): Promise<void> {
    const chat = update.message?.chat?.id;
    if (chat === undefined) return;
    const first = await this.ctx.redis.set(`tgbot:gap:${chat}`, "1", "EX", REPLY_GAP_SECONDS, "NX");
    if (!first) return;
    const text = await replyFor(this.ctx, this.cfg, update);
    if (!text) return;
    await this.call("sendMessage", {
      chat_id: chat,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.setUpProfile();
    void this.loop();
  }

  stop(): void {
    this.running = false;
    this.abort?.abort();
  }

  private async loop(): Promise<void> {
    let wait = 1000;
    while (this.running) {
      this.abort = new AbortController();
      try {
        const updates = (await this.call(
          "getUpdates",
          { offset: this.offset, timeout: POLL_SECONDS, allowed_updates: ["message"] },
          AbortSignal.any([this.abort.signal, AbortSignal.timeout((POLL_SECONDS + 10) * 1000)]),
        )) as TelegramUpdate[];
        wait = 1000;
        for (const u of updates ?? []) {
          this.offset = Math.max(this.offset, u.update_id + 1);
          await this.handle(u).catch((err: Error) =>
            this.log.warn({ msg: err.message }, "telegram reply failed"),
          );
        }
      } catch (err) {
        if (!this.running) break;
        this.log.warn({ msg: (err as Error).message }, "telegram polling failed");
        await new Promise((r) => setTimeout(r, wait));
        wait = Math.min(wait * 2, 60_000);
      }
    }
  }
}
