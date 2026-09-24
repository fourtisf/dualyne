import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { TelegramBot, type BotConfig } from "../src/telegram/bot";
import { createTestContext, type TestContext } from "./helpers";

const TOKEN = `123456:${"B".repeat(35)}`;
let t: TestContext;
let bot: TelegramBot;
let cfg: BotConfig;

beforeEach(async () => {
  if (!t) {
    t = await createTestContext({ OPENROUTER_LOW_BALANCE_USD: "2" });
    cfg = { token: TOKEN, ownerChatId: "42", apiUrl: t.upstream.url };
    bot = new TelegramBot(t.app.ctx, t.app.log, cfg);
  }
  await t.reset();
});
afterAll(async () => t?.close());

let nextId = 1;
const msg = (chat: number, text: string) => ({ update_id: nextId++, message: { chat: { id: chat }, text } });
const sent = () => t.upstream.telegram.filter((m) => m.method === "sendMessage");

describe("Telegram bot", () => {
  it("gives the owner a status report", async () => {
    t.upstream.credits = { total_credits: 10, total_usage: 2.5 };
    await bot.handle(msg(42, "/status"));
    const [reply] = sent();
    expect(reply!.body).toMatchObject({ chat_id: 42, parse_mode: "HTML" });
    const text = String(reply!.body.text);
    expect(text).toContain("<b>Dualyne status</b>");
    expect(text).toContain("database ok · cache ok");
    expect(text).toContain("Models live: 8");
    expect(text).toContain("0 chats · 0 comparisons · 0 API calls");
    expect(text).toContain("OpenRouter credit: $7.50 left");
  });

  it("answers /credit with a warning below the alert level", async () => {
    t.upstream.credits = { total_credits: 10, total_usage: 9 };
    await bot.handle(msg(42, "/credit@dualynebot"));
    expect(String(sent()[0]!.body.text)).toMatch(/\$1\.00 left[\s\S]*Top up/);
  });

  it("shows the owner the command list for anything else", async () => {
    await bot.handle(msg(42, "hello"));
    expect(String(sent()[0]!.body.text)).toContain("/status: site, API, usage and spend today");
  });

  it("welcomes anyone else and keeps admin commands private", async () => {
    await bot.handle(msg(7, "/start"));
    await t.redis.del("tgbot:gap:7");
    await bot.handle(msg(7, "/status"));
    const [welcome, refused] = sent().map((m) => String(m.body.text));
    expect(welcome).toContain("every AI model, one prompt away");
    expect(welcome).toContain("https://dualyne.com/chat");
    expect(refused).toMatch(/^This command is for the Dualyne team\./);
    expect(refused).not.toContain("Spend today");
  });

  it("replies at most once every two seconds per chat", async () => {
    await bot.handle(msg(9, "/start"));
    await bot.handle(msg(9, "/start"));
    expect(sent()).toHaveLength(1);
  });

  it("sets its command menus and profile", async () => {
    await bot.setUpProfile();
    const calls = t.upstream.telegram.map((m) => m.method);
    expect(calls).toEqual(["setMyCommands", "setMyCommands", "setMyShortDescription", "setMyDescription"]);
    expect(t.upstream.telegram[1]!.body).toMatchObject({ scope: { type: "chat", chat_id: "42" } });
  });

  it("polls for messages and answers them", async () => {
    t.upstream.telegramUpdates.push(msg(11, "/about"));
    const polling = new TelegramBot(t.app.ctx, t.app.log, cfg);
    polling.start();
    for (let i = 0; i < 50 && !sent().length; i++) await new Promise((r) => setTimeout(r, 20));
    polling.stop();
    expect(sent()[0]!.body).toMatchObject({ chat_id: 11 });
    const polls = t.upstream.telegram.filter((m) => m.method === "getUpdates");
    expect(polls[0]!.body).toMatchObject({ offset: 0, timeout: 25 });
  });
});
