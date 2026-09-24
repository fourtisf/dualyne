# X Article: introducing Dualyne

Cover image: `banners/png/01-introduction.png` (or `07-docs.png` once the API is open).
Only publish the API section once `API_OPEN=true` is live.

---

## Title

We built Dualyne because picking an AI model shouldn't take five subscriptions

## Subtitle

One place to ask, compare and build with the world's best AI models. Free to start, no signup.

---

There are more good AI models today than ever. Claude writes beautifully. Llama is fast and open. DeepSeek reasons through hard problems. Mistral is quick and precise.

And yet, using more than one of them is still a chore.

Each lives behind its own website, its own account, its own subscription and its own API. If you want to know which model answers _your_ question best, you open four tabs, paste the same prompt four times, and try to remember which answer came from where.

We thought that was backwards. So we built **Dualyne**.

## What Dualyne is

Dualyne is one home for many AI models. You can use it in three ways:

**1. Chat.** Pick a model, type your question, press Enter. No account, no email, no card. Answers stream in as they're written, and you can switch models mid-conversation to get a second opinion.

**2. Compare.** Send one prompt to two models and read the answers side by side. Turn on blind mode and you won't know which model wrote which answer until you vote. Every vote feeds a public leaderboard, so the rankings come from real people with real prompts, not from benchmarks.

**3. Build.** Developers get one OpenAI-compatible API. If your code already calls OpenAI, you change two lines, the base URL and the key, and everything else keeps working. Start with the free models today; the full catalog opens with paid credits.

And if you live in Telegram, Dualyne is there too: **@dualynebot** answers in any language, right inside your chats and groups.

## Why "compare" matters

Every model has a personality. One is better at code, another at tone, another at saying "I'm not sure" instead of making something up. Which one is "best" depends entirely on what you ask.

The only honest way to choose is to test with your own prompts. Dualyne makes that a ten-second habit instead of a research project: one prompt, two answers, one vote.

## How it works, in plain words

When you send a message, Dualyne passes it through OpenRouter to the model's own provider (Anthropic, Meta, DeepSeek, Mistral and others) and streams the answer back to you. We don't train models, and we don't sell data.

A few choices we made on purpose:

- **Your chats stay in your browser.** The text of your website conversations isn't stored on our servers. If you share a chat, you choose to publish it, and you can delete the link.
- **No tracking cookies.** We count visits without cookies and without storing IP addresses.
- **Your wallet is your account.** Developers sign in by signing one message with a wallet. There's no password to leak, and API keys are stored only as hashes. We show each key once.
- **Answers you share are real.** A shared chat on dualyne.com can only contain answers a model actually gave, so nobody can put invented words in a model's mouth.

## What's free

- **Chat:** 10 free messages a day with Claude, Llama, DeepSeek and Mistral.
- **Compare:** side-by-side and blind comparisons, with votes that build the public leaderboard.
- **Telegram:** the same free models in @dualynebot.
- **API:** 20 free requests a day to get started.

We pay for the free tier ourselves, within a daily budget. On a very busy day free chat can pause until midnight UTC. We'd rather tell you that up front than pretend it's unlimited.

## What's coming

- **Dualyne Pro:** every model in the catalog, including GPT-5, Gemini 2.5 Pro and Claude Sonnet and Opus, with more messages and longer answers for a flat monthly price. No auto-renew: nothing is ever charged without you choosing to pay.
- **Paid API credits:** keep building past the free allowance and pay only for what you use.
- More models as they launch, added to the catalog and the leaderboard.

## Try it

Ask something you actually care about. Then ask a second model. You'll see the difference in the first minute.

→ **dualyne.com**
→ Telegram: **@dualynebot**
→ Docs: **dualyne.com/docs**

Follow **@DualyneAi** for updates. And if something breaks or could be better, tell us. We read every message.
