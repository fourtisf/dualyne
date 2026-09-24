import { CHAT_MESSAGE_MAX, CHAT_TOTAL_MAX, type ChatMessage } from "@dualyne/shared";
import type { Model } from "@prisma/client";
import type { FastifyBaseLogger } from "fastify";
import { brand } from "@dualyne/config";
import { isRefusal } from "../budget";
import type { AppContext } from "../context";
import { estimateTokens, tokensCostMicro, usdToMicro } from "../lib/money";
import { readEvents, StreamInspector } from "../openrouter/sse";
import { logUsage } from "../usage/log";
import { alertBudgetOnce, alertOutOfCredits } from "../routes/v1.chat";
import { pickTwo } from "../routes/votes";
import { esc, splitMarkdown, stripTags, toTelegramHtml } from "./format";
import {
  aboutText,
  creditText,
  helpText,
  NOT_TEXT,
  retryIn,
  statsText,
  statusText,
  systemPrompt,
  tokenText,
  welcomeText,
} from "./texts";

/**
 * @dualynebot: a public AI assistant on Telegram. Anyone can message it and get answers from the
 * free (explorer-tier) models, streamed into the chat as they are written, with buttons to try
 * again, ask another model, compare two models blind (the vote counts toward the leaderboard) or
 * start over. Same protections as the website's Chat page: a per-person daily limit, the daily
 * budget and a fixed max_tokens. In groups it answers /ask, mentions and replies to itself.
 * The owner's chat (TELEGRAM_CHAT_ID, optional) also gets /status and /credit, hidden from
 * everyone else. Uses long polling, so no webhook is needed.
 */
export interface BotConfig {
  token: string;
  /** "" = no owner chat: the admin commands are off. */
  ownerChatId: string;
  apiUrl: string;
}

export interface BotTiming {
  /** Wait this long before showing a partial answer, so quick answers arrive as one message. */
  firstUpdateMs: number;
  /** Then update the partial answer at most this often (Telegram limits edits). */
  updateEveryMs: number;
}
const DEFAULT_TIMING: BotTiming = { firstUpdateMs: 1200, updateEveryMs: 1500 };

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

type Button = {
  text: string;
  callback_data?: string;
  url?: string;
  web_app?: { url: string };
  copy_text?: { text: string };
};
type Keyboard = Button[][];
type Reply = { html: string; keyboard?: Keyboard };

/** Where an answer goes and who asked. */
interface Where {
  chatId: number | string;
  chat: string;
  /** The person, for the daily limit and votes. */
  person: string;
  isPrivate: boolean;
  /** In groups, answers reply to the question. */
  replyTo?: number;
}

type Generated = { ok: true; text: string } | { ok: false; reason: "busy" | "exhausted" | "failed" };

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
/** Longest Markdown piece per Telegram message (converted HTML must stay under 4096). */
const PART_CHARS = 3500;
export const DEFAULT_MODEL = "claude-swift";

const PAUSED = "Free chat is paused for today. It comes back at 00:00 UTC.";
const BUSY = "Lots of people are chatting right now. Try again in a few seconds.";

const PUBLIC_COMMANDS = [
  { command: "start", description: "Start here" },
  { command: "compare", description: "Two models answer, you pick the better one" },
  { command: "model", description: "Choose the AI model" },
  { command: "new", description: "Start a new conversation" },
  { command: "ask", description: "Ask a question (in groups)" },
  // The token command only when the token is shown (NEXT_PUBLIC_TOKEN_ENABLED), like the website.
  ...(brand.tokenEnabled
    ? [{ command: "token", description: `$${brand.tokenSymbol} token and contract address` }]
    : []),
  { command: "help", description: "How it works, limits and privacy" },
  { command: "about", description: "Website and links" },
];
const OWNER_COMMANDS = [
  ...PUBLIC_COMMANDS,
  { command: "status", description: "Admin: site, API, usage and spend today" },
  { command: "credit", description: "Admin: OpenRouter credit left" },
  { command: "stats", description: "Admin: visitors, pages and chats" },
];

const ANSWER_BUTTONS: Keyboard = [
  [
    { text: "🔄 Try again", callback_data: "act:retry" },
    { text: "🔀 Other model", callback_data: "act:other" },
  ],
  [
    { text: "⚖️ Compare", callback_data: "act:compare" },
    { text: "🆕 New chat", callback_data: "act:new" },
  ],
];

const keys = {
  gap: (chat: string) => `tgbot:gap:${chat}`,
  busy: (chat: string) => `tgbot:busy:${chat}`,
  history: (chat: string) => `tgbot:hist:${chat}`,
  last: (chat: string) => `tgbot:last:${chat}`,
  model: (chat: string) => `tgbot:model:${chat}`,
};

class TelegramError extends Error {
  constructor(
    readonly method: string,
    readonly status: number,
  ) {
    // Never put the URL in the message: it holds the token.
    super(`telegram ${method} returned ${status}`);
  }
}

const chars = (messages: ChatMessage[]) => messages.reduce((n, x) => n + x.content.length, 0);

export class TelegramBot {
  private running = false;
  private abort: AbortController | null = null;
  private offset = 0;
  private username = "";
  private readonly inFlight = new Set<Promise<void>>();
  private readonly timing: BotTiming;

  constructor(
    private readonly ctx: AppContext,
    private readonly log: FastifyBaseLogger,
    private readonly cfg: BotConfig,
    timing: Partial<BotTiming> = {},
  ) {
    this.timing = { ...DEFAULT_TIMING, ...timing };
  }

  // ---------- Telegram calls ----------

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

  /** Send HTML; if Telegram rejects it, the same words as plain text. Returns the message id. */
  private async send(
    chatId: number | string,
    html: string,
    extra: Record<string, unknown> = {},
  ): Promise<number> {
    const body = { chat_id: chatId, disable_web_page_preview: true, ...extra };
    let sent: unknown;
    try {
      sent = await this.call("sendMessage", { ...body, text: html, parse_mode: "HTML" });
    } catch (err) {
      if (!(err instanceof TelegramError) || err.status !== 400) throw err;
      sent = await this.call("sendMessage", { ...body, text: stripTags(html) });
    }
    return (sent as { message_id?: number } | null)?.message_id ?? 0;
  }

  private async edit(
    chatId: number | string,
    messageId: number,
    html: string,
    keyboard?: Keyboard,
  ): Promise<void> {
    const body = {
      chat_id: chatId,
      message_id: messageId,
      disable_web_page_preview: true,
      ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
    };
    try {
      await this.call("editMessageText", { ...body, text: html, parse_mode: "HTML" });
    } catch (err) {
      if (!(err instanceof TelegramError) || err.status !== 400) throw err;
      // Bad markup, or "message is not modified": try the plain words once, quietly.
      await this.call("editMessageText", { ...body, text: stripTags(html) }).catch(() => undefined);
    }
  }

  private reply(w: Where, html: string, keyboard?: Keyboard): Promise<number> {
    return this.send(w.chatId, html, {
      ...(w.replyTo
        ? { reply_parameters: { message_id: w.replyTo, allow_sending_without_reply: true } }
        : {}),
      ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
    });
  }

  /** Keep "typing…" on screen (Telegram clears it after about 5 seconds). */
  private typing(w: Where): () => void {
    const tick = () =>
      void this.call("sendChatAction", { chat_id: w.chatId, action: "typing" }).catch(() => undefined);
    tick();
    const timer = setInterval(tick, 4500);
    return () => clearInterval(timer);
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
          short_description: `Ask anything in any language. Free answers from Claude, Llama, DeepSeek and Mistral. ${brand.siteUrl}`,
        },
      ],
      [
        "setMyDescription",
        {
          description: `Hi! I'm the ${brand.name} AI assistant.\n\nAsk me anything, in any language, and a free AI model answers: Claude, Llama, DeepSeek or Mistral. Use /compare to see two models answer the same question and vote for the better one.\n\nPress Start and type your question.`,
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

  // ---------- models ----------

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

  /** The list of models with buttons. `action` "model" sets the model; "alt" also asks again. */
  private async modelPicker(chat: string, action: "model" | "alt" = "model"): Promise<Reply> {
    const models = await this.freeModels();
    if (!models.length) return { html: "No models are available right now. Try again later." };
    const current = await this.modelFor(chat, models);
    const shown = action === "alt" ? models.filter((m) => m.id !== current?.id) : models;
    return {
      html: [
        action === "alt" ? "<b>Ask another model</b> the same question:" : "<b>Choose a model</b>",
        "",
        ...shown.map(
          (m) =>
            `${m.id === current?.id ? "✅" : "▫️"} <b>${esc(m.name)}</b> (${esc(m.provider)}): ${esc(m.bestFor)}`,
        ),
        "",
        `More models, like GPT and Gemini, are on ${brand.siteUrl}`,
      ].join("\n"),
      keyboard: shown.map((m) => [
        { text: `${m.id === current?.id ? "✓ " : ""}${m.name}`, callback_data: `${action}:${m.id}` },
      ]),
    };
  }

  /** Set the chat's model by id or name; undefined if it isn't a free model. */
  private async setModel(chat: string, name: string): Promise<Model | undefined> {
    const n = name.toLowerCase();
    const model = (await this.freeModels()).find((m) => m.id === n || m.name.toLowerCase() === n);
    if (model) await this.ctx.redis.set(keys.model(chat), model.id, "EX", MODEL_TTL_SECONDS);
    return model;
  }

  private openAppButton(w: Where): Button {
    const url = `${brand.siteUrl}/chat`;
    // Mini Apps open inside Telegram, but only from private chats.
    return w.isPrivate ? { text: "🌐 Open Dualyne", web_app: { url } } : { text: "🌐 Open Dualyne", url };
  }

  // ---------- messages ----------

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
    const kept = JSON.stringify(messages.slice(-HISTORY_MESSAGES));
    await this.ctx.redis.set(keys.history(chat), kept, "EX", HISTORY_TTL_SECONDS);
  }

  /** Commands and plain text. AI answers are sent by ask/compare themselves (null here). */
  private async onMessage(m: TgMessage, w: Where): Promise<Reply | null> {
    const text = m.text?.trim();
    if (!text) return w.isPrivate ? { html: NOT_TEXT } : null;
    const limit = this.ctx.env.CHAT_LIMIT_PER_DAY;

    if (text.startsWith("/")) {
      const [head = "", ...args] = text.split(/\s+/);
      const [cmd = "", target] = head.toLowerCase().split("@");
      // In groups, commands meant for other bots are none of our business.
      if (target && this.username && target !== this.username.toLowerCase()) return null;
      const arg = text.slice(head.length).trim();
      switch (cmd) {
        case "/start":
          return { html: welcomeText(await this.freeModels(), limit), keyboard: [[this.openAppButton(w)]] };
        case "/help":
          return { html: helpText(limit, this.isOwner(w.chat)) };
        case "/about":
        case "/links": {
          const row: Button[] = [];
          if (brand.social.x) row.push({ text: "X", url: brand.social.x });
          if (brand.social.telegram) row.push({ text: "Community", url: brand.social.telegram });
          return { html: aboutText(), keyboard: [[this.openAppButton(w)], ...(row.length ? [row] : [])] };
        }
        case "/token":
        case "/ca": {
          if (!brand.tokenEnabled) break;
          const address = this.ctx.env.DLYN_TOKEN_ADDRESS;
          return {
            html: tokenText(address),
            keyboard: address ? [[{ text: "📋 Copy address", copy_text: { text: address } }]] : undefined,
          };
        }
        case "/new":
        case "/reset":
          await this.ctx.redis.del(keys.history(w.chat), keys.last(w.chat));
          return { html: "Started a new conversation. What would you like to ask?" };
        case "/model":
        case "/models": {
          if (!args.length) return this.modelPicker(w.chat);
          const model = await this.setModel(w.chat, arg);
          return {
            html: model
              ? `Now answering with <b>${esc(model.name)}</b>. Send your question.`
              : `There's no free model called "${esc(arg)}". Send /model to see the list.`,
          };
        }
        case "/ask":
          if (!arg) return { html: "Add your question after /ask, for example:\n/ask What is an API?" };
          await this.ask(w, arg);
          return null;
        case "/compare":
        case "/vs":
          if (!arg) {
            return {
              html: "Add your question after /compare, for example:\n/compare Explain inflation to a 10-year-old\n\nTwo models answer without their names. Vote for the better answer, then see who wrote which.",
            };
          }
          await this.compare(w, arg);
          return null;
        case "/status":
          if (this.isOwner(w.chat)) return { html: await statusText(this.ctx) };
          break;
        case "/credit":
          if (this.isOwner(w.chat)) return { html: await creditText(this.ctx) };
          break;
        case "/stats":
          if (this.isOwner(w.chat)) return { html: await statsText(this.ctx) };
          break;
      }
      return w.isPrivate ? { html: "I don't know that command. Send /help to see what I can do." } : null;
    }

    if (w.isPrivate) {
      await this.ask(w, text);
      return null;
    }
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
    if (!question) return { html: "Hi! Ask me a question after the mention." };
    await this.ask(w, question);
    return null;
  }

  /** Checks shared by ask and compare. Returns a refusal to send, or null to go ahead. */
  private preflight(question: string): string | null {
    if (!this.ctx.env.OPENROUTER_API_KEY) return "The AI models open soon. Come back in a little while.";
    if (question.length > CHAT_MESSAGE_MAX) {
      return `That message is too long. Please keep it under ${CHAT_MESSAGE_MAX.toLocaleString("en-US")} characters.`;
    }
    return null;
  }

  /** Run `work` unless this chat is already waiting for an answer. */
  private async oneAtATime(w: Where, work: () => Promise<void>): Promise<void> {
    if (!(await this.ctx.redis.set(keys.busy(w.chat), "1", "EX", ANSWER_TIMEOUT_MS / 1000 + 30, "NX"))) {
      await this.reply(w, "I'm still answering your last message. One moment, please.");
      return;
    }
    try {
      await work();
    } finally {
      await this.ctx.redis.del(keys.busy(w.chat));
    }
  }

  private async budgetPaused(): Promise<boolean> {
    if (!(await this.ctx.budget.isExhausted())) return false;
    await alertBudgetOnce({ ctx: this.ctx });
    return true;
  }

  private limitText(retryAfterSeconds: number): string {
    return `You've used your ${this.ctx.env.CHAT_LIMIT_PER_DAY} free messages for today. Try again in ${retryIn(retryAfterSeconds)}.`;
  }

  /**
   * Ask the chat's model (or `opts.model`), with the chat's recent history, and stream the answer
   * into the chat. `again` answers the last question again instead of adding a new one.
   */
  private async ask(
    w: Where,
    question: string,
    opts: { model?: Model; again?: boolean } = {},
  ): Promise<void> {
    const refused = this.preflight(question);
    if (refused) {
      await this.reply(w, refused);
      return;
    }
    await this.oneAtATime(w, async () => {
      const { ctx } = this;
      const model = opts.model ?? (await this.modelFor(w.chat, await this.freeModels()));
      if (!model) {
        await this.reply(w, "No models are available right now. Try again later.");
        return;
      }
      if (await this.budgetPaused()) {
        await this.reply(w, PAUSED);
        return;
      }
      const slot = await ctx.chatLimiter.hit(`tg:${w.person}`);
      if (!slot.allowed) {
        await this.reply(w, this.limitText(slot.retryAfterSeconds));
        return;
      }

      let history = await this.history(w.chat);
      // Answering again: drop the previous answer to this same question.
      const n = history.length;
      if (
        opts.again &&
        n >= 2 &&
        history[n - 1]!.role === "assistant" &&
        history[n - 2]!.content === question
      ) {
        history = history.slice(0, -2);
      }
      const messages: ChatMessage[] = [...history, { role: "user", content: question }];
      while (messages.length > 1 && chars(messages) > CHAT_TOTAL_MAX) messages.splice(0, 2);
      await ctx.redis.set(keys.last(w.chat), question, "EX", HISTORY_TTL_SECONDS);

      // Show the answer as it is written: after a short wait, then every so often.
      const stopTyping = this.typing(w);
      const started = Date.now();
      const live = { id: 0, lastAt: 0, queue: Promise.resolve() };
      const onText = (full: string) => {
        const now = Date.now();
        if (now - started < this.timing.firstUpdateMs || now - live.lastAt < this.timing.updateEveryMs)
          return;
        if (full.length > PART_CHARS) return; // the rest goes out in more messages at the end
        live.lastAt = now;
        const html = `${toTelegramHtml(full)} ▍`;
        live.queue = live.queue
          .then(async () => {
            if (live.id) {
              await this.edit(w.chatId, live.id, html);
            } else {
              live.id = await this.reply(w, html);
              stopTyping();
            }
          })
          .catch(() => undefined);
      };

      const result = await this.generate(model, messages, w.person, { onText });
      stopTyping();
      await live.queue;

      if (!result.ok) {
        await slot.release();
        const html =
          result.reason === "exhausted"
            ? PAUSED
            : result.reason === "busy"
              ? BUSY
              : `${esc(model.name)} didn't answer this time. Please try again, or ask another model.`;
        const keyboard = result.reason === "failed" ? [ANSWER_BUTTONS[0]!] : undefined;
        if (live.id)
          await this.edit(w.chatId, live.id, html, keyboard).catch(() => this.reply(w, html, keyboard));
        else await this.reply(w, html, keyboard);
        return;
      }

      await this.remember(w.chat, [...messages, { role: "assistant", content: result.text }]);
      const footer = [`<i>${esc(model.name)}</i>`];
      if (slot.remaining <= 5) footer.push(`<i>${slot.remaining} free messages left today</i>`);
      const parts = splitMarkdown(result.text, PART_CHARS).map(toTelegramHtml);
      parts[parts.length - 1] += `\n\n${footer.join(" · ")}`;
      for (let i = 0; i < parts.length; i++) {
        const keyboard = i === parts.length - 1 ? ANSWER_BUTTONS : undefined;
        if (i === 0 && live.id) {
          // If the final edit fails (Telegram rate limit), send the answer as a new message.
          await this.edit(w.chatId, live.id, parts[0]!, keyboard).catch(() =>
            this.reply(w, parts[0]!, keyboard),
          );
        } else if (i === 0) await this.reply(w, parts[0]!, keyboard);
        else
          await this.send(
            w.chatId,
            parts[i]!,
            keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {},
          );
      }
    });
  }

  /** Two random free models answer the same question without their names; the asker votes. */
  private async compare(w: Where, question: string): Promise<void> {
    const refused = this.preflight(question);
    if (refused) {
      await this.reply(w, refused);
      return;
    }
    await this.oneAtATime(w, async () => {
      const { ctx } = this;
      const models = await this.freeModels();
      if (models.length < 2) {
        await this.reply(w, "Comparisons need two models. Try again later.");
        return;
      }
      if (await this.budgetPaused()) {
        await this.reply(w, PAUSED);
        return;
      }
      // A comparison is two messages from the daily allowance.
      const first = await ctx.chatLimiter.hit(`tg:${w.person}`);
      const second = first.allowed ? await ctx.chatLimiter.hit(`tg:${w.person}`) : first;
      if (!second.allowed) {
        await first.release();
        await this.reply(
          w,
          first.allowed
            ? "A comparison uses two messages, and you have one left today. Ask a normal question instead, or try tomorrow."
            : this.limitText(first.retryAfterSeconds),
        );
        return;
      }

      const [a, b] = pickTwo(models);
      const run = await ctx.prisma.compareRun.create({
        data: {
          modelA: a.id,
          modelB: b.id,
          ipHash: ctx.ipHash(`telegram:${w.person}`),
          blind: true,
          createdAt: ctx.clock(),
        },
      });
      await ctx.redis.set(keys.last(w.chat), question, "EX", HISTORY_TTL_SECONDS);
      const stopTyping = this.typing(w);
      const messages: ChatMessage[] = [{ role: "user", content: question }];
      const [ra, rb] = await Promise.all([
        this.generate(a, messages, w.person, { compareId: run.id, blind: true }),
        this.generate(b, messages, w.person, { compareId: run.id, blind: true }),
      ]);
      stopTyping();
      await ctx.prisma.compareRun.update({
        where: { id: run.id },
        data: { completedA: ra.ok, completedB: rb.ok },
      });
      if (!ra.ok) await first.release();
      if (!rb.ok) await second.release();

      if (!ra.ok && !rb.ok) {
        const reason = ra.reason === "failed" ? rb.reason : ra.reason;
        await this.reply(
          w,
          reason === "exhausted"
            ? PAUSED
            : reason === "busy"
              ? BUSY
              : "Neither model answered this time. Please try again in a moment.",
        );
        return;
      }
      const answers: [string, Generated][] = [
        ["🅰️ <b>Answer A</b>", ra],
        ["🅱️ <b>Answer B</b>", rb],
      ];
      for (const [label, r] of answers) {
        const parts = r.ok
          ? splitMarkdown(r.text, PART_CHARS).map(toTelegramHtml)
          : ["<i>This model didn't answer.</i>"];
        for (let i = 0; i < parts.length; i++) {
          if (i === 0) await this.reply(w, `${label}\n\n${parts[0]}`);
          else await this.send(w.chatId, parts[i]!);
        }
      }
      if (ra.ok && rb.ok) {
        await this.send(w.chatId, "<b>Which answer is better?</b> Vote to see which model wrote each one.", {
          reply_markup: {
            inline_keyboard: [
              [
                { text: "🅰️ A is better", callback_data: `vote:${run.id}:a` },
                { text: "🅱️ B is better", callback_data: `vote:${run.id}:b` },
              ],
              [{ text: "🤝 About the same", callback_data: `vote:${run.id}:tie` }],
            ],
          },
        });
      } else {
        await this.send(
          w.chatId,
          `Only one model answered, so there's no vote this time. 🅰️ was <b>${esc(a.name)}</b>, 🅱️ was <b>${esc(b.name)}</b>.`,
        );
      }
    });
  }

  /** One model call: budget, streaming, usage log. `onText` gets the answer so far. */
  private async generate(
    model: Model,
    messages: ChatMessage[],
    person: string,
    opts: { onText?: (text: string) => void; compareId?: string; blind?: boolean } = {},
  ): Promise<Generated> {
    const { ctx } = this;
    const { env } = ctx;
    const system = systemPrompt(opts.blind ? null : model);
    const inputTokens = estimateTokens(chars(messages) + system.length);
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
      if (reservation.refused !== "busy") await alertBudgetOnce({ ctx });
      return { ok: false, reason: reservation.refused === "busy" ? "busy" : "exhausted" };
    }

    const startedAt = Date.now();
    const inspector = new StreamInspector();
    let text = "";
    let status = 200;
    let errorCode: string | null = null;
    try {
      const res = await ctx.openrouter.chat(
        {
          model: model.openrouterId,
          messages: [{ role: "system", content: system }, ...messages],
          max_tokens: env.COMPARE_MAX_TOKENS,
          stream: true,
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
        for await (const event of readEvents(res)) {
          inspector.inspect(event, true);
          if (inspector.lastDelta) {
            text += inspector.lastDelta;
            opts.onText?.(text);
          }
        }
        if (inspector.errorCode) {
          status = 502;
          errorCode = inspector.errorCode;
        } else if (!text.trim()) {
          status = 502;
          errorCode = "empty_answer";
        }
      }
    } catch {
      status = 502;
      errorCode = "stream_interrupted";
    }

    const u = inspector.usage;
    const inTok = u?.promptTokens ?? inputTokens;
    const outTok = u?.completionTokens ?? estimateTokens(inspector.outputChars);
    const costMicro =
      u?.costUsd != null
        ? usdToMicro(u.costUsd)
        : tokensCostMicro(inTok, outTok, Number(model.promptPrice), Number(model.completionPrice));
    await ctx.budget.settle(reservation, costMicro);
    await logUsage(ctx.prisma, this.log, {
      createdAt: ctx.clock(),
      source: "telegram",
      modelId: model.id,
      openrouterId: model.openrouterId,
      generationId: inspector.generationId,
      inputTokens: inTok,
      outputTokens: outTok,
      costMicroUsd: costMicro,
      latencyMs: Date.now() - startedAt,
      ttftMs: inspector.firstTokenAt != null ? inspector.firstTokenAt - startedAt : null,
      status,
      errorCode,
      stream: true,
      ipHash: ctx.ipHash(`telegram:${person}`),
      compareId: opts.compareId ?? null,
    });
    return status === 200 ? { ok: true, text: text.trim() } : { ok: false, reason: "failed" };
  }

  // ---------- buttons ----------

  private async onButton(q: NonNullable<TelegramUpdate["callback_query"]>): Promise<void> {
    const m = q.message;
    const chatId = m?.chat?.id;
    const answer = (text?: string) =>
      this.call("answerCallbackQuery", { callback_query_id: q.id, ...(text ? { text } : {}) }).catch(
        () => undefined,
      );
    if (chatId === undefined || !q.from) {
      await answer();
      return;
    }
    const w: Where = {
      chatId,
      chat: String(chatId),
      person: String(q.from.id),
      isPrivate: (m?.chat?.type ?? "private") === "private",
    };
    const [kind = "", value = "", extra = ""] = (q.data ?? "").split(":");

    if (kind === "vote") {
      await this.onVote(q.id, w, m?.message_id, value, extra);
      return;
    }
    if (kind === "model") {
      const model = await this.setModel(w.chat, value);
      await answer(model ? `Now answering with ${model.name}.` : "That model isn't available.");
      if (model && m?.message_id) {
        const picker = await this.modelPicker(w.chat);
        await this.edit(chatId, m.message_id, picker.html, picker.keyboard).catch(() => undefined);
      }
      return;
    }
    if (kind === "act" && value === "new") {
      await this.ctx.redis.del(keys.history(w.chat), keys.last(w.chat));
      await answer("Started a new conversation.");
      await this.send(chatId, "Started a new conversation. What would you like to ask?");
      return;
    }
    if (kind === "act" && value === "other") {
      await answer();
      const picker = await this.modelPicker(w.chat, "alt");
      await this.send(chatId, picker.html, { reply_markup: { inline_keyboard: picker.keyboard ?? [] } });
      return;
    }

    // The rest work on the last question.
    const last = await this.ctx.redis.get(keys.last(w.chat));
    if (!last) {
      await answer("This conversation has expired. Send your question again.");
      return;
    }
    if (kind === "alt") {
      const model = await this.setModel(w.chat, value);
      if (!model) {
        await answer("That model isn't available.");
        return;
      }
      await answer(`Asking ${model.name}…`);
      await this.ask(w, last, { model, again: true });
      return;
    }
    if (kind === "act" && value === "retry") {
      await answer("Trying again…");
      await this.ask(w, last, { again: true });
      return;
    }
    if (kind === "act" && value === "compare") {
      await answer("Comparing two models…");
      await this.compare(w, last);
      return;
    }
    await answer();
  }

  private async onVote(
    queryId: string,
    w: Where,
    messageId: number | undefined,
    runId: string,
    pick: string,
  ): Promise<void> {
    const { ctx } = this;
    const answer = (text: string) =>
      this.call("answerCallbackQuery", { callback_query_id: queryId, text }).catch(() => undefined);
    if (pick !== "a" && pick !== "b" && pick !== "tie") {
      await answer("Unknown vote.");
      return;
    }
    const run = await ctx.prisma.compareRun.findUnique({ where: { id: runId } });
    if (!run) {
      await answer("This comparison has expired.");
      return;
    }
    if (run.ipHash !== ctx.ipHash(`telegram:${w.person}`)) {
      await answer("Only the person who asked can vote on this comparison.");
      return;
    }
    const ageHours = (ctx.clock().getTime() - run.createdAt.getTime()) / 3_600_000;
    if (ageHours > ctx.env.VOTE_WINDOW_HOURS || !run.completedA || !run.completedB) {
      await answer("Voting on this comparison has closed.");
      return;
    }
    await ctx.prisma.vote.upsert({
      where: { compareId: run.id },
      update: { winner: pick },
      create: {
        compareId: run.id,
        modelA: run.modelA,
        modelB: run.modelB,
        winner: pick,
        blind: true,
        ipHash: run.ipHash,
      },
    });
    await answer("Thanks! Your vote counts toward the leaderboard.");
    const names = await ctx.prisma.model.findMany({ where: { id: { in: [run.modelA, run.modelB] } } });
    const name = (id: string) => esc(names.find((x) => x.id === id)?.name ?? id);
    const verdict = pick === "tie" ? "About the same" : `Answer ${pick.toUpperCase()} is better`;
    const html = [
      `🗳 You voted: <b>${verdict}</b>`,
      "",
      `🅰️ was <b>${name(run.modelA)}</b>`,
      `🅱️ was <b>${name(run.modelB)}</b>`,
    ].join("\n");
    const keyboard: Keyboard = [[{ text: "🏆 Leaderboard", url: `${brand.siteUrl}/#models` }]];
    if (messageId) await this.edit(w.chatId, messageId, html, keyboard).catch(() => undefined);
    else await this.send(w.chatId, html, { reply_markup: { inline_keyboard: keyboard } });
  }

  // ---------- loop ----------

  async handle(update: TelegramUpdate): Promise<void> {
    if (update.callback_query) return this.onButton(update.callback_query);
    const m = update.message;
    const chatId = m?.chat?.id;
    if (!m || chatId === undefined || m.from?.is_bot) return;
    const chat = String(chatId);
    if (!(await this.ctx.redis.set(keys.gap(chat), "1", "EX", REPLY_GAP_SECONDS, "NX"))) return;
    const isPrivate = (m.chat?.type ?? "private") === "private";
    const w: Where = {
      chatId,
      chat,
      person: String(m.from?.id ?? chat),
      isPrivate,
      replyTo: isPrivate ? undefined : m.message_id,
    };
    const reply = await this.onMessage(m, w);
    if (reply) await this.reply(w, reply.html, reply.keyboard);
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
