import { brand } from "@dualyne/config";
import type { Model } from "@prisma/client";
import type { AppContext } from "../context";
import { esc } from "./format";

/** Everything @dualynebot says that isn't a model's answer. */

const usd = (micro: number) => `$${(micro / 1_000_000).toFixed(2)}`;

/**
 * The system message sent with every question (never stored in the conversation). In a blind
 * comparison the model must not name itself, or the vote would not be blind.
 */
export function systemPrompt(model: Pick<Model, "name" | "provider" | "upstreamName"> | null): string {
  return [
    `You are the ${brand.name} AI assistant, answering in a Telegram chat. ${brand.name} (${brand.siteUrl}) lets people chat with and compare AI models.`,
    model
      ? `This answer is written by ${model.name} (${model.upstreamName} by ${model.provider}). If someone asks who you are, say you are ${brand.name}'s assistant and that this answer comes from ${model.name}.`
      : "This is a blind comparison between two models: never say which model, company or product you are.",
    "Rules:",
    "- Reply in the language of the user's latest message.",
    "- Keep it short and easy to read on a phone: short paragraphs and simple lists. No tables, no HTML.",
    "- For investment, medical or legal questions, give balanced information and add one short line saying it isn't professional advice.",
    "- If you don't know, say so. Never invent links.",
  ].join("\n");
}

export function welcomeText(models: Pick<Model, "name">[], limit: number): string {
  const names = models.map((m) => m.name).join(", ");
  return [
    `<b>Welcome to ${brand.name}</b> 👋`,
    "",
    `Ask me anything and a free AI model answers${names ? `: ${esc(names)}` : ""}. You can write in any language.`,
    "",
    "Just type your question. For example:",
    "<i>Explain blockchains in three sentences</i>",
    "<i>Write a polite email asking for a refund</i>",
    "",
    "⚖️ /compare <i>question</i>: two models answer, you pick the better one",
    "🤖 /model: choose the AI model",
    "🆕 /new: start a new conversation",
    "❓ /help: limits, privacy and all commands",
    "",
    `Free: ${limit} messages an hour.`,
  ].join("\n");
}

export function helpText(limit: number, owner: boolean): string {
  const lines = [
    `<b>${brand.name} AI</b>`,
    "",
    "<b>Chat</b>",
    "Send a message and the bot answers. It remembers the conversation for an hour, so you can ask follow-up questions. The buttons under each answer let you try again, ask another model, compare, or start over.",
    "",
    "/compare <i>question</i>: two models answer blind; vote, then see who wrote which",
    "/model: choose the AI model",
    "/new: forget this conversation and start fresh",
    "/ask <i>question</i>: ask in a group (or mention the bot, or reply to it)",
    `/token: $${brand.tokenSymbol} token and contract address`,
    "/about: website and links",
    "",
    "<b>Limits</b>",
    `${limit} free messages an hour per person (a comparison counts as two). Answers are kept short. The bot reads text only.`,
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
    `• Leaderboard from community votes: ${site}/#models`,
    `• One API key for every model: ${site}/docs`,
  ];
  if (brand.social.x) lines.push(`• X: ${brand.social.x}`);
  if (brand.social.telegram) lines.push(`• Community: ${brand.social.telegram}`);
  return lines.join("\n");
}

export function tokenText(address: string | undefined): string {
  const lines = [
    `<b>$${brand.tokenSymbol}</b>: ${brand.tokenName}`,
    "",
    address
      ? `Contract address (tap to copy):\n<code>${esc(address)}</code>`
      : "Contract address: <b>coming soon</b>. It will be posted here, on the website and in our official channels.",
    "",
    "Holders unlock premium models and higher limits on the website and the API.",
    "",
    "⚠️ Only trust the address shown here and on the website. The team will never DM you first or ask for your seed phrase.",
  ];
  if (brand.social.x) lines.push("", `X: ${brand.social.x}`);
  if (brand.social.telegram) lines.push(`Community: ${brand.social.telegram}`);
  return lines.join("\n");
}

export const NOT_TEXT =
  "I can read text messages only for now. Please type your question, and I'll answer right away.";

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

export function retryIn(seconds: number): string {
  if (seconds < 90) return `${seconds} seconds`;
  const min = Math.ceil(seconds / 60);
  return min < 90 ? `${min} minutes` : `${Math.ceil(min / 60)} hours`;
}
