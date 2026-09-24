import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { TelegramBot, type BotConfig } from "../src/telegram/bot";
import { splitMarkdown, toTelegramHtml } from "../src/telegram/format";
import { createTestContext, type TestContext } from "./helpers";

const TOKEN = `123456:${"B".repeat(35)}`;
let t: TestContext;
let bot: TelegramBot;
let cfg: BotConfig;

beforeEach(async () => {
  if (!t) {
    t = await createTestContext({ OPENROUTER_LOW_BALANCE_USD: "2", CHAT_LIMIT_PER_HOUR: "3" });
    cfg = { token: TOKEN, ownerChatId: "42", apiUrl: t.upstream.url };
    bot = new TelegramBot(t.app.ctx, t.app.log, cfg);
    await bot.setUpProfile(); // learns its username (@dualynebot) for group mentions
  }
  await t.reset();
  t.upstream.mode = "json";
});
afterAll(async () => t?.close());

let nextId = 1;
const msg = (chat: number, text: string, extra: Record<string, unknown> = {}) => ({
  update_id: nextId++,
  message: { message_id: nextId, chat: { id: chat, type: "private" }, from: { id: chat }, text, ...extra },
});
const group = (text: string, from = 5, extra: Record<string, unknown> = {}) =>
  msg(-100, text, { chat: { id: -100, type: "supergroup" }, from: { id: from }, ...extra });
const sent = () => t.upstream.telegram.filter((m) => m.method === "sendMessage");
const texts = () => sent().map((m) => String(m.body.text));
/** Send one message as a fresh update (skips the one-reply-a-second guard). */
async function say(update: ReturnType<typeof msg>) {
  await t.redis.del(`tgbot:gap:${update.message.chat.id}`);
  await bot.handle(update);
}

describe("Telegram bot: public chat", () => {
  it("welcomes people on /start with how to use it", async () => {
    await say(msg(7, "/start"));
    const [welcome] = texts();
    expect(welcome).toContain("<b>Welcome to Dualyne</b>");
    expect(welcome).toContain("Claude Swift, Llama, DeepSeek, Mistral");
    expect(welcome).toContain("Free: 3 messages an hour");
    expect(sent()[0]!.body).toMatchObject({ chat_id: 7, parse_mode: "HTML" });
  });

  it("answers a question with the default free model and logs the usage", async () => {
    await say(msg(7, "What is an API?"));
    const [req] = t.upstream.requests;
    expect(req!.path).toBe("/v1/chat/completions");
    expect(req!.body).toMatchObject({
      model: "anthropic/claude-haiku-4.5",
      messages: [{ role: "user", content: "What is an API?" }],
      max_tokens: 1000,
    });
    expect(req!.body.stream).toBeUndefined();
    expect(texts()[0]).toBe("Hello\n\n<i>Claude Swift</i> · <i>2 free messages left this hour</i>");
    expect(t.upstream.telegram.some((m) => m.method === "sendChatAction")).toBe(true);

    const row = await t.prisma.usageLog.findFirstOrThrow();
    expect(row).toMatchObject({ source: "telegram", modelId: "claude-swift", status: 200, stream: false });
    expect(row.costMicroUsd).toBe(500n);
    expect(row.ipHash).toMatch(/^[0-9a-f]{32}$/); // a hash, never the Telegram user id
  });

  it("remembers the conversation until /new", async () => {
    await say(msg(7, "My name is Ana."));
    await say(msg(7, "What is my name?"));
    expect(t.upstream.requests[1]!.body.messages).toEqual([
      { role: "user", content: "My name is Ana." },
      { role: "assistant", content: "Hello" },
      { role: "user", content: "What is my name?" },
    ]);
    await say(msg(7, "/new"));
    expect(texts().at(-1)).toMatch(/^Started a new conversation/);
    await say(msg(7, "Hi again"));
    expect(t.upstream.requests[2]!.body.messages).toEqual([{ role: "user", content: "Hi again" }]);
  });

  it("lets people pick a free model with buttons", async () => {
    await say(msg(7, "/model"));
    const picker = sent()[0]!.body as {
      text: string;
      reply_markup: { inline_keyboard: { callback_data: string }[][] };
    };
    expect(picker.text).toContain("✅ <b>Claude Swift</b>");
    expect(picker.reply_markup.inline_keyboard.flat().map((b) => b.callback_data)).toEqual([
      "model:claude-swift",
      "model:llama",
      "model:deepseek",
      "model:mistral",
    ]);

    await bot.handle({
      update_id: nextId++,
      callback_query: { id: "cb1", data: "model:llama", message: { message_id: 3, chat: { id: 7 } } },
    });
    const answered = t.upstream.telegram.find((m) => m.method === "answerCallbackQuery")!;
    expect(answered.body).toMatchObject({
      callback_query_id: "cb1",
      text: "Now answering with Llama. Send your question.",
    });
    const edited = t.upstream.telegram.find((m) => m.method === "editMessageText")!;
    expect(String(edited.body.text)).toContain("✅ <b>Llama</b>");

    await say(msg(7, "Hi"));
    expect(t.upstream.requests[0]!.body.model).toBe("meta-llama/llama-3.3-70b-instruct");
    expect(texts().at(-1)).toContain("<i>Llama</i>");
  });

  it("refuses premium models and unknown names", async () => {
    await say(msg(7, "/model gpt"));
    expect(texts()[0]).toMatch(/There's no free model called "gpt"/);
    await bot.handle({
      update_id: nextId++,
      callback_query: { id: "cb2", data: "model:gpt", message: { message_id: 3, chat: { id: 7 } } },
    });
    expect(await t.redis.get("tgbot:model:7")).toBeNull();
  });

  it("stops at the hourly limit per person, and a failed answer doesn't count", async () => {
    t.upstream.mode = "error";
    await say(msg(8, "one"));
    expect(texts()[0]).toMatch(/Claude Swift didn't answer this time/);
    t.upstream.mode = "json";
    for (const q of ["two", "three", "four"]) await say(msg(8, q));
    await say(msg(8, "five"));
    expect(texts().at(-1)).toMatch(
      /You've used your 3 free messages for this hour\. Try again in 60 minutes\./,
    );
    expect(t.upstream.requests).toHaveLength(4);
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

  it("in groups, answers /ask, mentions and replies to itself, and ignores the rest", async () => {
    await say(group("just chatting among ourselves"));
    await say(group("/start@otherbot"));
    expect(sent()).toHaveLength(0);

    await say(group("/ask@dualynebot What is Rust?"));
    await say(group("@dualynebot and Go?", 6));
    await say(
      group("and Zig?", 5, { reply_to_message: { from: { id: 1, is_bot: true, username: "dualynebot" } } }),
    );
    expect(
      t.upstream.requests.map((r) => (r.body.messages as { content: string }[]).at(-1)!.content),
    ).toEqual(["What is Rust?", "and Go?", "and Zig?"]);
    expect(sent()[0]!.body).toMatchObject({ reply_parameters: { allow_sending_without_reply: true } });
  });

  it("sends plain text when Telegram refuses the formatting", async () => {
    t.upstream.telegramRejectHtml = true;
    await say(msg(7, "/help"));
    const [first, second] = sent();
    expect(first!.body.parse_mode).toBe("HTML");
    expect(second!.body.parse_mode).toBeUndefined();
    expect(String(second!.body.text)).toMatch(/^Dualyne bot\n\nChat\n/);
  });

  it("replies at most once a second per chat", async () => {
    await bot.handle(msg(9, "/start"));
    await bot.handle(msg(9, "/start"));
    expect(sent()).toHaveLength(1);
  });

  it("answers an unknown command with a pointer to /help", async () => {
    await say(msg(7, "/status"));
    expect(texts()[0]).toBe("I don't know that command. Send /help to see what I can do.");
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
    const calls = t.upstream.telegram.map((m) => m.method);
    expect(calls).toEqual([
      "getMe",
      "setMyCommands",
      "setMyCommands",
      "setMyShortDescription",
      "setMyDescription",
    ]);
    const [pub, own] = t.upstream.telegram.filter((m) => m.method === "setMyCommands");
    const names = (c: typeof pub) => (c!.body.commands as { command: string }[]).map((x) => x.command);
    expect(names(pub)).toEqual(["start", "model", "new", "ask", "help", "about"]);
    expect(names(pub)).not.toContain("status");
    expect(own!.body).toMatchObject({ scope: { type: "chat", chat_id: "42" } });
    expect(names(own)).toContain("status");
  });

  it("without an owner chat, no admin menu is set", async () => {
    const b = new TelegramBot(t.app.ctx, t.app.log, { ...cfg, ownerChatId: "" });
    await b.setUpProfile();
    expect(t.upstream.telegram.filter((m) => m.method === "setMyCommands")).toHaveLength(1);
  });

  it("polls for messages and answers them", async () => {
    t.upstream.telegramUpdates.push(msg(11, "/about"));
    const polling = new TelegramBot(t.app.ctx, t.app.log, cfg);
    polling.start();
    for (let i = 0; i < 50 && !sent().length; i++) await new Promise((r) => setTimeout(r, 20));
    polling.stop();
    expect(sent()[0]!.body).toMatchObject({ chat_id: 11 });
    const polls = t.upstream.telegram.filter((m) => m.method === "getUpdates");
    expect(polls[0]!.body).toMatchObject({
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
