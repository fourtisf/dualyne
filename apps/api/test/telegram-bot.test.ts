import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { brand } from "@dualyne/config";
import { TelegramBot, type BotConfig } from "../src/telegram/bot";
import { splitMarkdown, toTelegramHtml } from "../src/telegram/format";
import { createTestContext, type TestContext } from "./helpers";

const TOKEN = `123456:${"B".repeat(35)}`;
let t: TestContext;
let bot: TelegramBot;
let cfg: BotConfig;

beforeEach(async () => {
  if (!t) {
    t = await createTestContext({ OPENROUTER_LOW_BALANCE_USD: "2", CHAT_LIMIT_PER_DAY: "5" });
    cfg = { token: TOKEN, ownerChatId: "42", apiUrl: t.upstream.url };
    bot = new TelegramBot(t.app.ctx, t.app.log, cfg);
    await bot.setUpProfile(); // learns its username (@dualynebot) for group mentions
  }
  await t.reset();
  t.upstream.mode = "stream";
});
afterAll(async () => t?.close());

type Body = Record<string, unknown> & {
  text?: string;
  reply_markup?: {
    inline_keyboard: { text: string; callback_data?: string; web_app?: unknown; url?: string }[][];
  };
};

let nextId = 1;
const msg = (chat: number, text: string | undefined, extra: Record<string, unknown> = {}) => ({
  update_id: nextId++,
  message: { message_id: nextId, chat: { id: chat, type: "private" }, from: { id: chat }, text, ...extra },
});
const group = (text: string, from = 5, extra: Record<string, unknown> = {}) =>
  msg(-100, text, { chat: { id: -100, type: "supergroup" }, from: { id: from }, ...extra });
const press = (chat: number, data: string, from = chat, messageId = 777) => ({
  update_id: nextId++,
  callback_query: {
    id: `cb${nextId}`,
    from: { id: from },
    data,
    message: { message_id: messageId, chat: { id: chat, type: chat < 0 ? "group" : "private" } },
  },
});
const calls = (method: string) =>
  t.upstream.telegram.filter((m) => m.method === method).map((m) => m.body as Body);
const sent = () => calls("sendMessage");
const texts = () => sent().map((m) => String(m.text));
const toasts = () => calls("answerCallbackQuery").map((b) => b.text);
const buttons = (b: Body | undefined) =>
  b?.reply_markup?.inline_keyboard.flat().map((x) => x.callback_data ?? x.text);
const asked = () =>
  t.upstream.requests.map((r) => (r.body.messages as { role: string; content: string }[]).slice(1));
/** Send one message as a fresh update (skips the one-reply-a-second guard). */
async function say(update: ReturnType<typeof msg>) {
  await t.redis.del(`tgbot:gap:${update.message.chat.id}`);
  await bot.handle(update);
}

describe("Telegram bot: chat", () => {
  it("welcomes people on /start, with a button that opens the app inside Telegram", async () => {
    await say(msg(7, "/start"));
    const [welcome] = sent();
    expect(welcome!.text).toContain("<b>Welcome to Dualyne</b>");
    expect(welcome!.text).toContain("Claude Swift, Llama, DeepSeek, Mistral");
    expect(welcome!.text).toContain("/compare");
    expect(welcome!.reply_markup!.inline_keyboard[0]![0]).toEqual({
      text: "🌐 Open Dualyne",
      web_app: { url: "https://dualyne.com/chat" },
    });
  });

  it("answers with the default model, a system prompt, the model name and buttons", async () => {
    await say(msg(7, "What is an API?"));
    const [req] = t.upstream.requests;
    expect(req!.body).toMatchObject({ model: "anthropic/claude-haiku-4.5", max_tokens: 1000, stream: true });
    const [system, user] = req!.body.messages as { role: string; content: string }[];
    expect(system!.role).toBe("system");
    expect(system!.content).toContain("Reply in the language of the user's latest message");
    expect(system!.content).toContain("this answer comes from Claude Swift");
    expect(system!.content).toContain("isn't professional advice");
    expect(user).toEqual({ role: "user", content: "What is an API?" });

    const [answer] = sent();
    expect(answer!.text).toBe("Hello ✓\n\n<i>Claude Swift</i> · <i>4 free messages left today</i>");
    expect(buttons(answer)).toEqual(["act:retry", "act:other", "act:compare", "act:new"]);
    expect(calls("sendChatAction")[0]).toMatchObject({ chat_id: 7, action: "typing" });

    const row = await t.prisma.usageLog.findFirstOrThrow();
    expect(row).toMatchObject({ source: "telegram", modelId: "claude-swift", status: 200, stream: true });
    expect(row.costMicroUsd).toBe(1230n);
    expect(row.ipHash).toMatch(/^[0-9a-f]{32}$/); // a hash, never the Telegram user id
  });

  it("shows the answer while it is being written, then the final text in the same message", async () => {
    const live = new TelegramBot(t.app.ctx, t.app.log, cfg, { firstUpdateMs: 0, updateEveryMs: 0 });
    await live.handle(msg(7, "Hi"));
    const [partial] = sent();
    expect(partial!.text).toMatch(/ ▍$/);
    const edits = calls("editMessageText");
    const final = edits.at(-1)!;
    // The stand-in numbers messages 1000 + its call count.
    const partialId = 1001 + t.upstream.telegram.findIndex((m) => m.method === "sendMessage");
    expect(final).toMatchObject({ chat_id: 7, message_id: partialId });
    expect(final.text).toBe("Hello ✓\n\n<i>Claude Swift</i> · <i>4 free messages left today</i>");
    expect(buttons(final)).toEqual(["act:retry", "act:other", "act:compare", "act:new"]);
    expect(sent()).toHaveLength(1);
  });

  it("remembers the conversation until /new", async () => {
    await say(msg(7, "My name is Ana."));
    await say(msg(7, "What is my name?"));
    expect(asked()[1]).toEqual([
      { role: "user", content: "My name is Ana." },
      { role: "assistant", content: "Hello ✓" },
      { role: "user", content: "What is my name?" },
    ]);
    await say(msg(7, "/new"));
    expect(texts().at(-1)).toMatch(/^Started a new conversation/);
    await say(msg(7, "Hi again"));
    expect(asked()[2]).toEqual([{ role: "user", content: "Hi again" }]);
  });

  it("answer buttons: try again, ask another model, new chat", async () => {
    await say(msg(7, "Tell me a joke"));
    await bot.handle(press(7, "act:retry"));
    // Same question again, without the first answer in the history.
    expect(asked()[1]).toEqual([{ role: "user", content: "Tell me a joke" }]);
    expect(toasts()).toContain("Trying again…");

    await bot.handle(press(7, "act:other"));
    const picker = sent().at(-1)!;
    expect(picker.text).toContain("<b>Ask another model</b>");
    expect(buttons(picker)).toEqual(["alt:llama", "alt:deepseek", "alt:mistral"]);

    await bot.handle(press(7, "alt:llama"));
    expect(t.upstream.requests[2]!.body.model).toBe("meta-llama/llama-3.3-70b-instruct");
    expect(asked()[2]).toEqual([{ role: "user", content: "Tell me a joke" }]);
    expect(texts().at(-1)).toContain("<i>Llama</i>");
    expect(await t.redis.get("tgbot:model:7")).toBe("llama");

    await bot.handle(press(7, "act:new"));
    expect(await t.redis.get("tgbot:hist:7")).toBeNull();
    await bot.handle(press(7, "act:retry"));
    expect(toasts().at(-1)).toBe("This conversation has expired. Send your question again.");
    expect(t.upstream.requests).toHaveLength(3);
  });

  it("/model picks a free model with buttons and refuses the rest", async () => {
    await say(msg(7, "/model"));
    const picker = sent()[0]!;
    expect(picker.text).toContain("✅ <b>Claude Swift</b>");
    expect(buttons(picker)).toEqual(["model:claude-swift", "model:llama", "model:deepseek", "model:mistral"]);

    await bot.handle(press(7, "model:mistral"));
    expect(toasts()).toContain("Now answering with Mistral.");
    expect(calls("editMessageText").at(-1)!.text).toContain("✅ <b>Mistral</b>");

    await say(msg(7, "/model gpt"));
    expect(texts().at(-1)).toMatch(/There's no free model called "gpt"/);
    await bot.handle(press(7, "model:gpt"));
    expect(await t.redis.get("tgbot:model:7")).toBe("mistral");
  });

  it("stops at the daily limit per person, and a failed answer doesn't count", async () => {
    t.upstream.mode = "error";
    await say(msg(8, "one"));
    expect(texts()[0]).toMatch(/Claude Swift didn't answer this time/);
    expect(buttons(sent()[0])).toEqual(["act:retry", "act:other"]);
    t.upstream.mode = "stream";
    for (const q of ["two", "three", "four", "five", "six"]) await say(msg(8, q));
    await say(msg(8, "seven"));
    expect(texts().at(-1)).toMatch(/You've used your 5 free messages for today\. Try again in 24 hours\./);
    expect(t.upstream.requests).toHaveLength(6);
  });

  it("pauses when the daily budget is used up", async () => {
    await t.redis.set(`spend:2026-09-23`, String(10 ** 12));
    await say(msg(7, "Hi"));
    expect(texts()[0]).toBe("Free chat is paused for today. It comes back at 00:00 UTC.");
    expect(t.upstream.requests).toHaveLength(0);
  });

  it("says the models open soon when there is no OpenRouter key", async () => {
    const preview = await createTestContext({ OPENROUTER_API_KEY: "" });
    try {
      const b = new TelegramBot(preview.app.ctx, preview.app.log, { ...cfg, apiUrl: preview.upstream.url });
      await b.handle(msg(7, "Hi"));
      const reply = preview.upstream.telegram.find((m) => m.method === "sendMessage")!;
      expect(String(reply.body.text)).toMatch(/open soon/);
      expect(preview.upstream.requests).toHaveLength(0);
    } finally {
      await preview.close();
    }
  });

  it("explains that it reads text only when it gets a photo or voice note", async () => {
    await say(msg(7, undefined, { photo: [{ file_id: "x" }] }));
    expect(texts()[0]).toMatch(/^I can read text messages only for now/);
    await say(group(undefined as unknown as string, 5, { voice: { file_id: "y" } }));
    expect(sent()).toHaveLength(1); // groups: quiet
  });

  it("in groups, answers /ask, mentions and replies to itself, and ignores the rest", async () => {
    await say(group("just chatting among ourselves"));
    await say(group("/start@otherbot"));
    expect(sent()).toHaveLength(0);

    await say(group("/ask@dualynebot What is Rust?"));
    await say(group("@dualynebot and Go?", 6));
    await say(
      group("and Zig?", 5, { reply_to_message: { from: { id: 1, is_bot: true, username: "dualynebot" } } }),
    );
    expect(asked().map((m) => m.at(-1)!.content)).toEqual(["What is Rust?", "and Go?", "and Zig?"]);
    expect(sent()[0]).toMatchObject({ reply_parameters: { allow_sending_without_reply: true } });
    // No Mini App buttons in groups: a normal link instead.
    await say(group("/start"));
    expect(sent().at(-1)!.reply_markup!.inline_keyboard[0]![0]).toMatchObject({
      url: "https://dualyne.com/chat",
    });
  });

  it("/token stays quiet while the token is hidden (the default)", async () => {
    expect(brand.tokenEnabled).toBe(false);
    await say(msg(7, "/token"));
    expect(texts()[0]).toBe("I don't know that command. Send /help to see what I can do.");
    await say(msg(7, "/help"));
    expect(texts()[1]).not.toContain("/token");
  });

  it("/token shows the contract address when set, with a copy button (token shown)", async () => {
    const flags = brand as { tokenEnabled: boolean };
    flags.tokenEnabled = true;
    try {
      await tokenCommand();
    } finally {
      flags.tokenEnabled = false;
    }
  });

  async function tokenCommand() {
    await say(msg(7, "/token"));
    expect(texts()[0]).toContain("Contract address: <b>coming soon</b>");
    expect(sent()[0]!.reply_markup).toBeUndefined();

    const env = t.app.ctx.env as { DLYN_TOKEN_ADDRESS?: string };
    const address = `0x${"ab".repeat(20)}`;
    env.DLYN_TOKEN_ADDRESS = address;
    try {
      await say(msg(7, "/ca"));
      expect(texts()[1]).toContain(`<code>${address}</code>`);
      expect(sent()[1]!.reply_markup!.inline_keyboard[0]![0]).toEqual({
        text: "📋 Copy address",
        copy_text: { text: address },
      });
    } finally {
      delete env.DLYN_TOKEN_ADDRESS;
    }
  }

  it("sends plain text when Telegram refuses the formatting", async () => {
    t.upstream.telegramRejectHtml = true;
    await say(msg(7, "/help"));
    const [first, second] = sent();
    expect(first!.parse_mode).toBe("HTML");
    expect(second!.parse_mode).toBeUndefined();
    expect(String(second!.text)).toMatch(/^Dualyne AI\n\nChat\n/);
  });

  it("replies at most once a second per chat, and answers one question at a time", async () => {
    await bot.handle(msg(9, "/start"));
    await bot.handle(msg(9, "/start"));
    expect(sent()).toHaveLength(1);

    await t.redis.set("tgbot:busy:9", "1");
    await say(msg(9, "Hi"));
    expect(texts().at(-1)).toBe("I'm still answering your last message. One moment, please.");
    expect(t.upstream.requests).toHaveLength(0);
  });

  it("answers an unknown command with a pointer to /help", async () => {
    await say(msg(7, "/status"));
    expect(texts()[0]).toBe("I don't know that command. Send /help to see what I can do.");
  });
});

describe("Telegram bot: compare and vote", () => {
  it("two models answer blind; the asker votes, then sees the names", async () => {
    await say(msg(7, "/compare Explain inflation"));
    expect(t.upstream.requests).toHaveLength(2);
    const models = t.upstream.requests.map((r) => r.body.model);
    expect(new Set(models).size).toBe(2);
    for (const r of t.upstream.requests) {
      const [system, user] = r.body.messages as { content: string }[];
      expect(system!.content).toContain("blind comparison");
      expect(system!.content).not.toMatch(/Claude Swift|Llama|DeepSeek|Mistral/);
      expect(user!.content).toBe("Explain inflation");
    }
    const [a, b, vote] = sent();
    expect(a!.text).toBe("🅰️ <b>Answer A</b>\n\nHello ✓");
    expect(b!.text).toBe("🅱️ <b>Answer B</b>\n\nHello ✓");
    expect(vote!.text).toContain("Which answer is better?");
    const run = await t.prisma.compareRun.findFirstOrThrow();
    expect(run).toMatchObject({ blind: true, completedA: true, completedB: true });
    expect(buttons(vote)).toEqual([`vote:${run.id}:a`, `vote:${run.id}:b`, `vote:${run.id}:tie`]);
    expect(await t.prisma.usageLog.count({ where: { compareId: run.id, source: "telegram" } })).toBe(2);
    // Two messages from the hourly allowance.
    expect(await t.app.ctx.chatLimiter.remaining("tg:7")).toBe(3);

    await bot.handle(press(7, `vote:${run.id}:b`, 99));
    expect(toasts().at(-1)).toBe("Only the person who asked can vote on this comparison.");
    expect(await t.prisma.vote.count()).toBe(0);

    await bot.handle(press(7, `vote:${run.id}:b`));
    expect(toasts().at(-1)).toBe("Thanks! Your vote counts toward the leaderboard.");
    expect(await t.prisma.vote.findFirstOrThrow()).toMatchObject({
      compareId: run.id,
      modelA: run.modelA,
      modelB: run.modelB,
      winner: "b",
      blind: true,
    });
    const reveal = calls("editMessageText").at(-1)!;
    expect(reveal.text).toMatch(/You voted: <b>Answer B is better<\/b>[\s\S]*🅰️ was <b>\w[\w ]*<\/b>/);
    expect(reveal.reply_markup!.inline_keyboard[0]![0]).toMatchObject({ url: "https://dualyne.com/#models" });
  });

  it("the Compare button compares the last question", async () => {
    await say(msg(7, "Best pizza topping?"));
    await bot.handle(press(7, "act:compare"));
    expect(
      asked()
        .slice(1)
        .map((m) => m.at(-1)!.content),
    ).toEqual(["Best pizza topping?", "Best pizza topping?"]);
    expect(texts().at(-1)).toContain("Which answer is better?");
  });

  it("needs two messages left in the hour", async () => {
    for (const q of ["1", "2", "3", "4"]) await say(msg(7, q));
    await say(msg(7, "/compare Hi"));
    expect(texts().at(-1)).toMatch(/^A comparison uses two messages, and you have one left/);
    expect(t.upstream.requests).toHaveLength(4);
    expect(await t.app.ctx.chatLimiter.remaining("tg:7")).toBe(1);
  });

  it("/compare without a question explains how", async () => {
    await say(msg(7, "/compare"));
    expect(texts()[0]).toMatch(/^Add your question after \/compare/);
  });
});

describe("Telegram bot: owner", () => {
  it("gives the owner a status report", async () => {
    t.upstream.credits = { total_credits: 10, total_usage: 2.5 };
    await say(msg(42, "/status"));
    const text = texts()[0]!;
    expect(text).toContain("<b>Dualyne status</b>");
    expect(text).toContain("database ok · cache ok");
    expect(text).toContain("Models live: 8");
    expect(text).toContain("0 web chats · 0 Telegram · 0 comparisons · 0 API calls");
    expect(text).toContain("OpenRouter credit: $7.50 left");
  });

  it("answers /credit with a warning below the alert level", async () => {
    t.upstream.credits = { total_credits: 10, total_usage: 9 };
    await say(msg(42, "/credit@dualynebot"));
    expect(texts()[0]).toMatch(/\$1\.00 left[\s\S]*Top up/);
  });

  it("the owner can chat too, and /help shows the admin commands", async () => {
    await say(msg(42, "Hi"));
    await say(msg(42, "/help"));
    expect(texts()[0]).toContain("Hello");
    expect(texts()[1]).toContain("<b>Admin (only in this chat)</b>");
  });

  it("sets its menus and profile: public commands for all, admin ones only in the owner chat", async () => {
    await bot.setUpProfile();
    const methods = t.upstream.telegram.map((m) => m.method);
    expect(methods).toEqual([
      "getMe",
      "setMyCommands",
      "setMyCommands",
      "setMyShortDescription",
      "setMyDescription",
    ]);
    const [pub, own] = calls("setMyCommands");
    const names = (c: Body | undefined) => (c!.commands as { command: string }[]).map((x) => x.command);
    expect(names(pub)).toEqual(["start", "compare", "model", "new", "ask", "help", "about"]);
    expect(own).toMatchObject({ scope: { type: "chat", chat_id: "42" } });
    expect(names(own)).toContain("status");
  });

  it("without an owner chat, no admin menu is set", async () => {
    const b = new TelegramBot(t.app.ctx, t.app.log, { ...cfg, ownerChatId: "" });
    await b.setUpProfile();
    expect(calls("setMyCommands")).toHaveLength(1);
  });

  it("polls for messages and answers them", async () => {
    t.upstream.telegramUpdates.push(msg(11, "/about"));
    const polling = new TelegramBot(t.app.ctx, t.app.log, cfg);
    polling.start();
    for (let i = 0; i < 50 && !sent().length; i++) await new Promise((r) => setTimeout(r, 20));
    polling.stop();
    expect(sent()[0]).toMatchObject({ chat_id: 11 });
    expect(calls("getUpdates")[0]).toMatchObject({
      offset: 0,
      timeout: 25,
      allowed_updates: ["message", "callback_query"],
    });
  });
});

describe("Telegram formatting", () => {
  it("turns Markdown into Telegram HTML and escapes everything else", () => {
    const md = [
      "## Steps",
      "- use **bold** and *italic* and `a<b>`",
      "1 < 2 && snake_case_name stays",
      "[docs](https://dualyne.com/docs?a=1&b=2)",
      "```ts",
      "const x = a < b;",
      "```",
    ].join("\n");
    expect(toTelegramHtml(md)).toBe(
      [
        "<b>Steps</b>",
        "• use <b>bold</b> and <i>italic</i> and <code>a&lt;b&gt;</code>",
        "1 &lt; 2 &amp;&amp; snake_case_name stays",
        '<a href="https://dualyne.com/docs?a=1&amp;b=2">docs</a>',
        '<pre><code class="language-ts">const x = a &lt; b;</code></pre>',
      ].join("\n"),
    );
  });

  it("splits long answers and keeps code blocks closed in every part", () => {
    const code = "```py\n" + "print('x')\n".repeat(500) + "```";
    const parts = splitMarkdown(`Intro\n\n${code}`, 1000);
    expect(parts.length).toBeGreaterThan(4);
    for (const p of parts) {
      expect(p.length).toBeLessThanOrEqual(1000 + 20);
      expect((p.match(/```/g) ?? []).length % 2).toBe(0);
    }
    expect(parts[1]!.startsWith("```py\n")).toBe(true);
  });
});

describe("Telegram bot: suggested questions", () => {
  it("offers crypto starter questions on /ask, /new and /start, and a tap asks one", async () => {
    await say(msg(7, "/ask"));
    expect(buttons(sent().at(-1))).toEqual([
      "start:0",
      "start:1",
      "start:2",
      "start:3",
      "start:4",
      "start:5",
    ]);
    await say(msg(7, "/new"));
    expect(buttons(sent().at(-1))).toContain("start:0");
    await say(msg(7, "/start"));
    expect(buttons(sent().at(-1))).toContain("start:5");

    await bot.handle(press(7, "start:0"));
    expect(texts()).toContain("❓ <b>What is Bitcoin, in simple words?</b>");
    expect(asked().at(-1)!.at(-1)).toEqual({ role: "user", content: "What is Bitcoin, in simple words?" });
  });

  it("adds follow-up questions under an answer, and a tap asks them", async () => {
    const env = t.app.ctx.env as { CHAT_SUGGEST_MODEL: string };
    env.CHAT_SUGGEST_MODEL = "mistral";
    t.upstream.jsonForNonStream = true;
    t.upstream.jsonContent = '["How does mining work?", "Is Bitcoin safe?", "How do I buy Bitcoin?"]';
    try {
      await say(msg(7, "What is Bitcoin?"));
      await Promise.all([...t.app.ctx.inflight]);
      const edited = calls("editMessageText").at(-1);
      expect(buttons(edited)!.slice(0, 3)).toEqual(["sug:0", "sug:1", "sug:2"]);
      expect(edited!.reply_markup!.inline_keyboard[0]![0]!.text).toBe("💬 How does mining work?");

      const answerId = edited!.message_id as number;
      await bot.handle(press(7, "sug:1", 7, answerId));
      expect(texts()).toContain("❓ <b>Is Bitcoin safe?</b>");
      // An old or unknown message: the suggestion is gone.
      await bot.handle(press(7, "sug:0", 7, 999_999));
      expect(toasts()).toContain("This suggestion has expired. Type your question instead.");
    } finally {
      env.CHAT_SUGGEST_MODEL = "";
    }
  });
});
