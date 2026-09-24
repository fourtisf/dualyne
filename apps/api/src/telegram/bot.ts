import { CHAT_MESSAGE_MAX, CHAT_TOTAL_MAX, type ChatMessage } from "@dualyne/shared";
import type { Model } from "@prisma/client";
import type { FastifyBaseLogger } from "fastify";
import { brand } from "@dualyne/config";
import { isRefusal } from "../budget";
import type { AppContext } from "../context";
import { estimateTokens, tokensCostMicro, usdToMicro } from "../lib/money";
import { logUsage } from "../usage/log";
import { alertBudgetOnce, alertOutOfCredits } from "../routes/v1.chat";
import { esc, splitMarkdown, stripTags, toTelegramHtml } from "./format";

/**
 * @dualynebot: a public AI assistant on Telegram. Anyone can message it and get answers from the
 * free (explorer-tier) models, with the same protections as the website's Chat page: a per-user
 * hourly limit, the daily budget and a fixed max_tokens. In groups it answers /ask, mentions and
 * replies to its own messages. The owner's chat (TELEGRAM_CHAT_ID, optional) also gets /status
 * and /credit, which are hidden from everyone else. Uses long polling, so no webhook is needed.
 */
export interface BotConfig {
  token: string;
  /** "" = no owner chat: the admin commands are off. */
  ownerChatId: string;
  apiUrl: string;
}

interface TgUser {
  id: number;
  is_bot?: boolean;
  username?: string;
}
interface TgMessage {
  message_id?: number;
  chat?: { id?: number | string; type?: string };
  from?: TgUser;
  text?: string;
  reply_to_message?: { from?: TgUser };
}
export interface TelegramUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: { id: string; from?: TgUser; message?: TgMessage; data?: string };
}

type Keyboard = { text: string; callback_data: string }[][];
/** A ready HTML message, or a model's Markdown answer with a footer line. */
type HtmlReply = { html: string; keyboard?: Keyboard };
export type Reply = HtmlReply | { markdown: string; footer: string };

const POLL_SECONDS = 25;
/** One reply per chat per this many seconds, so a stuck client can't make the bot loop. */
const REPLY_GAP_SECONDS = 1;
/** The conversation the bot remembers per chat: this many messages, for this long. */
const HISTORY_MESSAGES = 10;
const HISTORY_TTL_SECONDS = 3600;
/** Chosen model per chat. */
const MODEL_TTL_SECONDS = 30 * 86_400;
const ANSWER_TIMEOUT_MS = 90_000;
/** Updates answered at the same time; the rest wait. */
const MAX_IN_FLIGHT = 16;
export const DEFAULT_MODEL = "claude-swift";

const usd = (micro: number) => `$${(micro / 1_000_000).toFixed(2)}`;

const PUBLIC_COMMANDS = [
  { command: "start", description: "Start here" },
  { command: "model", description: "Choose the AI model" },
  { command: "new", description: "Start a new conversation" },
  { command: "ask", description: "Ask a question (in groups)" },
  { command: "help", description: "How it works, limits and privacy" },
  { command: "about", description: "Dualyne website and links" },
];
const OWNER_COMMANDS = [
  ...PUBLIC_COMMANDS,
  { command: "status", description: "Admin: site, API, usage and spend today" },
  { command: "credit", description: "Admin: OpenRouter credit left" },
];

const keys = {
  gap: (chat: string) => `tgbot:gap:${chat}`,
  busy: (chat: string) => `tgbot:busy:${chat}`,
  history: (chat: string) => `tgbot:hist:${chat}`,
  model: (chat: string) => `tgbot:model:${chat}`,
};

// ---------- texts ----------

export function welcomeText(models: Pick<Model, "name">[], limit: number): string {
  const names = models.map((m) => m.name).join(", ");
  return [
    `<b>Welcome to ${brand.name}</b> 👋`,
    "",
    `Ask me anything and I'll answer with a free AI model${names ? `: ${esc(names)}` : ""}.`,
    "",
    "Just type your question. For example:",
    "<i>Explain blockchains in three sentences</i>",
    "<i>Write a polite email asking for a refund</i>",
    "",
    "/model: choose the AI model",
    "/new: start a new conversation",
    "/help: limits, privacy and all commands",
    "",
    `Free: ${limit} messages an hour. For side-by-side comparisons and premium models, open ${brand.siteUrl}`,
  ].join("\n");
}

export function helpText(limit: number, owner: boolean): string {
  const lines = [
    `<b>${brand.name} bot</b>`,
    "",
    "<b>Chat</b>",
    "Send a message and the bot answers. It remembers the conversation for an hour, so you can ask follow-up questions.",
    "",
    "/model: choose the AI model",
    "/new: forget this conversation and start fresh",
    "/ask <i>question</i>: ask in a group (or mention the bot, or reply to it)",
    "/about: website and links",
    "",
    "<b>Limits</b>",
    `${limit} free messages an hour per person. Answers are kept short (about 700 words).`,
    "",
    "<b>Privacy</b>",
    "Your messages go to the model you picked to get an answer. The bot keeps the last few messages for an hour, then forgets them; /new forgets them right away. Don't send passwords or private data.",
  ];
  if (owner) {
    lines.push(
      "",
      "<b>Admin (only in this chat)</b>",
      "/status: site, API, usage and spend today",
      "/credit: OpenRouter credit left",
      "Alerts arrive here automatically.",
    );
  }
  return lines.join("\n");
}

export function aboutText(): string {
  const site = brand.siteUrl;
  const lines = [
    `<b>${brand.name}</b>: every AI model, one prompt away.`,
    "",
    `• Chat in your browser: ${site}/chat`,
    `• Compare two models side by side: ${site}/#compare`,
    `• One API key for every model: ${site}/docs`,
  ];
  if (brand.social.x) lines.push(`• X: ${brand.social.x}`);
  if (brand.social.telegram) lines.push(`• Community: ${brand.social.telegram}`);
  return lines.join("\n");
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
    `📊 Today (UTC): ${count("chat")} web chats · ${count("telegram")} Telegram · ${count("compare")} comparisons · ${count("api")} API calls`,
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

function retryIn(seconds: number): string {
  if (seconds < 90) return `${seconds} seconds`;
  const min = Math.ceil(seconds / 60);
  return min < 90 ? `${min} minutes` : `${Math.ceil(min / 60)} hours`;
}

// ---------- the bot ----------

class TelegramError extends Error {
  constructor(
    readonly method: string,
    readonly status: number,
  ) {
    // Never put the URL in the message: it holds the token.
    super(`telegram ${method} returned ${status}`);
  }
}

export class TelegramBot {
  private running = false;
  private abort: AbortController | null = null;
  private offset = 0;
  private username = "";
  private readonly inFlight = new Set<Promise<void>>();

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
    if (!res.ok) throw new TelegramError(method, res.status);
    return ((await res.json()) as { result?: unknown }).result;
  }

  private isOwner(chat: string): boolean {
    return this.cfg.ownerChatId !== "" && chat === this.cfg.ownerChatId;
  }

  /** The bot's own username (for mentions in groups), command menus and profile texts. */
  async setUpProfile(): Promise<void> {
    const me = (await this.call("getMe", {}).catch(() => null)) as TgUser | null;
    if (me?.username) this.username = me.username;
    const steps: [string, Record<string, unknown>][] = [
      ["setMyCommands", { commands: PUBLIC_COMMANDS }],
      [
        "setMyShortDescription",
        {
          short_description: `Ask anything. Free answers from Claude, Llama, DeepSeek and Mistral. ${brand.siteUrl}`,
        },
      ],
      [
        "setMyDescription",
        {
          description: `Hi! I'm the ${brand.name} AI assistant.\n\nAsk me anything and I'll answer with a free AI model: Claude, Llama, DeepSeek or Mistral. Pick the model with /model.\n\nPress Start and type your question.`,
        },
      ],
    ];
    if (this.cfg.ownerChatId) {
      steps.splice(1, 0, [
        "setMyCommands",
        { commands: OWNER_COMMANDS, scope: { type: "chat", chat_id: this.cfg.ownerChatId } },
      ]);
    }
    for (const [method, body] of steps) {
      await this.call(method, body).catch((err: Error) =>
        this.log.warn({ msg: err.message }, "telegram setup"),
      );
    }
  }

  private async freeModels(): Promise<Model[]> {
    return this.ctx.prisma.model.findMany({
      where: { enabled: true, minTier: "explorer", missingSince: null },
      orderBy: { sortOrder: "asc" },
    });
  }

  /** The chat's chosen model, or the default, or the first free model. */
  private async modelFor(chat: string, models: Model[]): Promise<Model | undefined> {
    const chosen = await this.ctx.redis.get(keys.model(chat));
    return models.find((m) => m.id === chosen) ?? models.find((m) => m.id === DEFAULT_MODEL) ?? models[0];
  }

  private async modelPicker(chat: string): Promise<HtmlReply> {
    const models = await this.freeModels();
    if (!models.length) return { html: "No models are available right now. Try again later." };
    const current = await this.modelFor(chat, models);
    return {
      html: [
        "<b>Choose a model</b>",
        "",
        ...models.map(
          (m) =>
            `${m.id === current?.id ? "✅" : "▫️"} <b>${esc(m.name)}</b> (${esc(m.provider)}): ${esc(m.bestFor)}`,
        ),
        "",
        `More models, like GPT and Gemini, are on ${brand.siteUrl}`,
      ].join("\n"),
      keyboard: models.map((m) => [
        { text: `${m.id === current?.id ? "✓ " : ""}${m.name}`, callback_data: `model:${m.id}` },
      ]),
    };
  }

  private async setModel(chat: string, id: string): Promise<string> {
    const models = await this.freeModels();
    const model = models.find((m) => m.id === id.toLowerCase() || m.name.toLowerCase() === id.toLowerCase());
    if (!model) return `There's no free model called "${esc(id)}". Send /model to see the list.`;
    await this.ctx.redis.set(keys.model(chat), model.id, "EX", MODEL_TTL_SECONDS);
    return `Now answering with <b>${esc(model.name)}</b>. Send your question.`;
  }

  /** The answer to one message, or null to stay quiet. `ask` runs the model. */
  async replyFor(update: TelegramUpdate): Promise<Reply | null> {
    const m = update.message;
    const text = m?.text?.trim();
    const chatId = m?.chat?.id;
    if (!m || !text || chatId === undefined || m.from?.is_bot) return null;
    const chat = String(chatId);
    const owner = this.isOwner(chat);
    const isPrivate = (m.chat?.type ?? "private") === "private";

    if (text.startsWith("/")) {
      const [head = "", ...args] = text.split(/\s+/);
      const [cmd = "", target] = head.toLowerCase().split("@");
      // In groups, commands meant for other bots are none of our business.
      if (target && this.username && target !== this.username.toLowerCase()) return null;
      const arg = text.slice(head.length).trim();
      const limit = this.ctx.env.CHAT_LIMIT_PER_HOUR;
      switch (cmd) {
        case "/start":
          return { html: welcomeText(await this.freeModels(), limit) };
        case "/help":
          return { html: helpText(limit, owner) };
        case "/about":
        case "/links":
          return { html: aboutText() };
        case "/new":
        case "/reset":
          await this.ctx.redis.del(keys.history(chat));
          return { html: "Started a new conversation. What would you like to ask?" };
        case "/model":
        case "/models":
          return args.length ? { html: await this.setModel(chat, arg) } : this.modelPicker(chat);
        case "/ask":
          return arg
            ? this.ask(m, chat, arg)
            : { html: "Add your question after /ask, for example:\n/ask What is an API?" };
        case "/status":
          if (owner) return { html: await statusText(this.ctx) };
          break;
        case "/credit":
          if (owner) return { html: await creditText(this.ctx) };
          break;
      }
      return isPrivate ? { html: "I don't know that command. Send /help to see what I can do." } : null;
    }

    if (isPrivate) return this.ask(m, chat, text);
    // Groups: answer a mention or a reply to one of our messages, nothing else.
    const mention = this.username ? `@${this.username.toLowerCase()}` : "";
    const mentioned = mention !== "" && text.toLowerCase().includes(mention);
    const repliedToUs =
      !!m.reply_to_message?.from?.is_bot &&
      (!this.username || m.reply_to_message.from.username?.toLowerCase() === this.username.toLowerCase());
    if (!mentioned && !repliedToUs) return null;
    const question = mentioned
      ? text.replace(new RegExp(mention.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig"), "").trim()
      : text;
    return question ? this.ask(m, chat, question) : { html: "Hi! Ask me a question after the mention." };
  }

  /** Ask the chat's model, with the chat's recent history. */
  private async ask(m: TgMessage, chat: string, question: string): Promise<Reply> {
    const { ctx } = this;
    const { env } = ctx;
    if (!env.OPENROUTER_API_KEY) return { html: "The AI models open soon. Come back in a little while." };
    if (question.length > CHAT_MESSAGE_MAX) {
      return {
        html: `That message is too long. Please keep it under ${CHAT_MESSAGE_MAX.toLocaleString("en-US")} characters.`,
      };
    }
    const models = await this.freeModels();
    const model = await this.modelFor(chat, models);
    if (!model) return { html: "No models are available right now. Try again later." };

    if (!(await ctx.redis.set(keys.busy(chat), "1", "EX", ANSWER_TIMEOUT_MS / 1000 + 30, "NX"))) {
      return { html: "I'm still answering your last message. One moment, please." };
    }
    try {
      if (await ctx.budget.isExhausted()) {
        await alertBudgetOnce({ ctx });
        return { html: "Free chat is paused for today. It comes back at 00:00 UTC." };
      }
      const person = String(m.from?.id ?? chat);
      const slot = await ctx.chatLimiter.hit(`tg:${person}`);
      if (!slot.allowed) {
        return {
          html: `You've used your ${env.CHAT_LIMIT_PER_HOUR} free messages for this hour. Try again in ${retryIn(slot.retryAfterSeconds)}.`,
        };
      }

      const history = await this.history(chat);
      const messages: ChatMessage[] = [...history, { role: "user", content: question }];
      while (messages.length > 1 && messages.reduce((n, x) => n + x.content.length, 0) > CHAT_TOTAL_MAX) {
        messages.splice(0, 2);
      }
      const inputTokens = estimateTokens(messages.reduce((n, x) => n + x.content.length, 0));
      const reservation = await ctx.budget.reserve(
        tokensCostMicro(
          inputTokens,
          env.COMPARE_MAX_TOKENS,
          Number(model.promptPrice),
          Number(model.completionPrice),
        ),
        true,
      );
      if (isRefusal(reservation)) {
        await slot.release();
        if (reservation.refused === "busy") {
          return { html: "Lots of people are chatting right now. Try again in a few seconds." };
        }
        await alertBudgetOnce({ ctx });
        return { html: "Free chat is paused for today. It comes back at 00:00 UTC." };
      }

      void this.call("sendChatAction", { chat_id: m.chat!.id, action: "typing" }).catch(() => undefined);
      const startedAt = Date.now();
      let answer = "";
      let status = 200;
      let errorCode: string | null = null;
      let usage: { prompt_tokens?: number; completion_tokens?: number; cost?: number } | undefined;
      let generationId: string | null = null;
      try {
        const res = await ctx.openrouter.chat(
          {
            model: model.openrouterId,
            messages,
            max_tokens: env.COMPARE_MAX_TOKENS,
            usage: { include: true },
          },
          AbortSignal.timeout(ANSWER_TIMEOUT_MS),
        );
        if (!res.ok) {
          await res.text().catch(() => "");
          if (res.status === 402) void alertOutOfCredits(ctx);
          status = 502;
          errorCode = `upstream_${res.status}`;
        } else {
          const json = (await res.json()) as {
            id?: string;
            choices?: { message?: { content?: string | null } }[];
            usage?: typeof usage;
            error?: { code?: unknown };
          };
          generationId = json.id ?? null;
          usage = json.usage;
          answer = json.choices?.[0]?.message?.content?.trim() ?? "";
          if (!answer) {
            status = 502;
            errorCode = json.error ? `upstream_${String(json.error.code ?? "error")}` : "empty_answer";
          }
        }
      } catch {
        status = 502;
        errorCode = "upstream_timeout";
      }

      const inTok = usage?.prompt_tokens ?? inputTokens;
      const outTok = usage?.completion_tokens ?? estimateTokens(answer.length);
      const costMicro =
        usage?.cost != null
          ? usdToMicro(usage.cost)
          : status === 200
            ? tokensCostMicro(inTok, outTok, Number(model.promptPrice), Number(model.completionPrice))
            : 0;
      await ctx.budget.settle(reservation, costMicro);
      await logUsage(ctx.prisma, this.log, {
        createdAt: ctx.clock(),
        source: "telegram",
        modelId: model.id,
        openrouterId: model.openrouterId,
        generationId,
        inputTokens: status === 200 ? inTok : 0,
        outputTokens: status === 200 ? outTok : 0,
        costMicroUsd: costMicro,
        latencyMs: Date.now() - startedAt,
        status,
        errorCode,
        stream: false,
        ipHash: ctx.ipHash(`telegram:${person}`),
      });

      if (status !== 200) {
        await slot.release();
        return {
          html: `${esc(model.name)} didn't answer this time. Please try again, or pick another model with /model.`,
        };
      }
      await this.remember(chat, [...messages, { role: "assistant", content: answer }]);
      const footer = [`<i>${esc(model.name)}</i>`];
      if (slot.remaining <= 5) footer.push(`<i>${slot.remaining} free messages left this hour</i>`);
      return { markdown: answer, footer: footer.join(" · ") };
    } finally {
      await ctx.redis.del(keys.busy(chat));
    }
  }

  private async history(chat: string): Promise<ChatMessage[]> {
    try {
      const raw = await this.ctx.redis.get(keys.history(chat));
      const parsed = raw ? (JSON.parse(raw) as ChatMessage[]) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private async remember(chat: string, messages: ChatMessage[]): Promise<void> {
    const kept = messages.slice(-HISTORY_MESSAGES);
    await this.ctx.redis.set(keys.history(chat), JSON.stringify(kept), "EX", HISTORY_TTL_SECONDS);
  }

  /** Send HTML; if Telegram rejects the markup, send the same words as plain text. */
  private async send(chatId: number | string, html: string, extra: Record<string, unknown>): Promise<void> {
    const body = { chat_id: chatId, disable_web_page_preview: true, ...extra };
    try {
      await this.call("sendMessage", { ...body, text: html, parse_mode: "HTML" });
    } catch (err) {
      if (!(err instanceof TelegramError) || err.status !== 400) throw err;
      await this.call("sendMessage", { ...body, text: stripTags(html) });
    }
  }

  async handle(update: TelegramUpdate): Promise<void> {
    if (update.callback_query) return this.handleButton(update.callback_query);
    const m = update.message;
    const chatId = m?.chat?.id;
    if (!m || chatId === undefined) return;
    const chat = String(chatId);
    if (!(await this.ctx.redis.set(keys.gap(chat), "1", "EX", REPLY_GAP_SECONDS, "NX"))) return;
    const reply = await this.replyFor(update);
    if (!reply) return;

    const isPrivate = (m.chat?.type ?? "private") === "private";
    const replyTo =
      !isPrivate && m.message_id
        ? { reply_parameters: { message_id: m.message_id, allow_sending_without_reply: true } }
        : {};
    if ("html" in reply) {
      await this.send(chatId, reply.html, {
        ...replyTo,
        ...(reply.keyboard ? { reply_markup: { inline_keyboard: reply.keyboard } } : {}),
      });
      return;
    }
    // A model's answer, possibly longer than one message; the footer goes on the last part.
    const parts = splitMarkdown(reply.markdown).map(toTelegramHtml);
    for (let i = 0; i < parts.length; i++) {
      const last = i === parts.length - 1;
      await this.send(chatId, last ? `${parts[i]}\n\n${reply.footer}` : parts[i]!, i === 0 ? replyTo : {});
    }
  }

  private async handleButton(q: NonNullable<TelegramUpdate["callback_query"]>): Promise<void> {
    const chatId = q.message?.chat?.id;
    const data = q.data ?? "";
    if (chatId === undefined || !data.startsWith("model:")) {
      await this.call("answerCallbackQuery", { callback_query_id: q.id });
      return;
    }
    const text = await this.setModel(String(chatId), data.slice("model:".length));
    await this.call("answerCallbackQuery", { callback_query_id: q.id, text: stripTags(text).slice(0, 190) });
    if (q.message?.message_id) {
      const picker = await this.modelPicker(String(chatId));
      await this.call("editMessageText", {
        chat_id: chatId,
        message_id: q.message.message_id,
        text: picker.html,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        reply_markup: { inline_keyboard: picker.keyboard ?? [] },
      }).catch(() => undefined);
    }
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

  /** Answer an update in the background, so one slow model answer doesn't hold up everyone else. */
  private async dispatch(u: TelegramUpdate): Promise<void> {
    while (this.inFlight.size >= MAX_IN_FLIGHT) await Promise.race(this.inFlight);
    const p = this.handle(u)
      .catch((err: Error) => this.log.warn({ msg: err.message }, "telegram reply failed"))
      .finally(() => this.inFlight.delete(p));
    this.inFlight.add(p);
  }

  private async loop(): Promise<void> {
    let wait = 1000;
    while (this.running) {
      this.abort = new AbortController();
      try {
        const updates = (await this.call(
          "getUpdates",
          { offset: this.offset, timeout: POLL_SECONDS, allowed_updates: ["message", "callback_query"] },
          AbortSignal.any([this.abort.signal, AbortSignal.timeout((POLL_SECONDS + 10) * 1000)]),
        )) as TelegramUpdate[];
        wait = 1000;
        for (const u of updates ?? []) {
          this.offset = Math.max(this.offset, u.update_id + 1);
          await this.dispatch(u);
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
