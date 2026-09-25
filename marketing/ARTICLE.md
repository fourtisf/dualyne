# X Article: introducing Dualyne (long version)

**Cover image:** `banners/png/article-cover-1500x600.png` (5:2, what X recommends). Only one image: the
cover. The article itself is text.

Lines in _[brackets]_ are only true once a setting is on. Delete them if it's still off.
In the X editor, use **Body → Heading** for the `##` lines and **Subheading** for the `###` lines.

---

# Every AI model, one place: meet Dualyne

## Why we built it, what it does today, and where it's going

A year ago, "which AI should I use?" had a simple answer. Today it doesn't.

Claude writes with care and nuance. Llama is fast, open and surprisingly capable. DeepSeek reasons through
problems step by step. Mistral is quick, precise and multilingual. GPT and Gemini each have their own
strengths. New versions arrive every few weeks, and each one is better at something.

That's good news. But it created a new problem: to actually use more than one of these models, you need
more than one of everything. More accounts. More subscriptions. More tabs. More copying and pasting the
same question into different boxes, and more trying to remember which answer came from where.

Most people give up and stick with whichever app they opened first. Not because it's the best for them,
but because comparing is too much work.

We thought that was backwards. Choosing the right model should take seconds, not an afternoon. So we built
**Dualyne**.

## What Dualyne is

Dualyne is one home for many AI models. You open **dualyne.com**, pick a model and start typing. No
account, no email, no card.

It does three things, and it tries to do each of them well:

1. **Chat** with any model, the way you'd use any chat app.
2. **Compare** models side by side on the same question, and vote for the better answer.
3. **Build** with one API that speaks to every model in the catalog.

And if you'd rather not open a browser at all, the same models live in Telegram as **@dualynebot**.

## Chat: one conversation, any model

The Chat page looks like the chat apps you already know: your conversations on the left, the model picker
at the top, the message box at the bottom. Answers stream in word by word as they're written.

The difference is the row of models at the top. Claude, Llama, DeepSeek, Mistral: one tap switches
between them, even in the middle of a conversation. If an answer doesn't feel right, ask another model
the same thing and see what it says. The conversation carries over.

Chat also does more than plain text.

### Ask about images and documents

Attach a photo, a screenshot, a receipt or a chart and ask about it: "What does this error mean?",
"Summarize this slide", "Which of these two is cheaper?". Models that can see images are marked with a
small eye, so you always know which ones will understand your picture.

PDFs work too. Drop in a report, a contract or a paper and ask for a summary, the key numbers, or the
three things you should know before signing. Text files like notes, CSVs and code can be attached the
same way.

Files are sent with your message to the model, and that's it: we don't store them.

### Search the web when you need today's answer

Every model has a knowledge cut-off. Ask about last night's match or this morning's news and most models
will either guess or apologise.

Turn on **Web** before you send, and the model searches the web first, then answers with the pages it used
listed underneath. You can click any source and check it yourself. Free users get a few web searches a
day, because each search has a real cost behind it.

### Templates, instructions and voice

Some questions come up again and again. **Templates** turn them into one tap: translate this, fix my
writing, summarise in five bullet points, explain this code, write a caption, reply to this email.

**Custom instructions** let you tell every model, once, how you like your answers. "Answer in Indonesian."
"Keep it short." "I'm a beginner, explain the jargon." They're sent with every message, to every model.

And if typing isn't convenient, tap the microphone and speak. Every answer also has a **Read aloud**
button.

## Ask several: the feature we're proudest of

Here's the part that changes how you use AI.

Switch on **Ask several**, pick two, three or four models, and ask your question once. The answers appear
side by side, streaming at the same time. Read them, pick the one you like best, and keep chatting with
that model. The others stay there for reference.

It sounds simple. In practice it's eye-opening. You'll notice that one model is more careful with facts,
another writes in a warmer tone, another gets to the point faster, and another quietly handles your
language better than the rest. None of that shows up in a benchmark. All of it shows up when you ask
your own questions.

After a week of this, you stop asking "which AI is best?" and start knowing which one is best for you, for
each kind of task.

## Compare, blind votes and a leaderboard from real people

Compare is Ask several's more serious sibling. You write one prompt, two models answer it side by side,
and you vote for the better answer.

Turn on **blind mode** and you won't know which model wrote which answer until after you vote. No brand
bias, no expectations: just two answers and your judgement.

Every vote feeds a public **leaderboard**. It's split by the kind of question people asked: **Coding,
Writing, Reasoning, non-English** and general questions. A model that's brilliant at code can be average
at writing, and the leaderboard shows that. We only keep the category of each question, never the
question itself.

When you share a comparison or a chat, the link comes with a preview card showing the question and the
start of the answers, so it reads well when you post it on X or send it on Telegram.

## Dualyne in Telegram

Not everyone wants another website. Message **@dualynebot** and you get the same models inside Telegram.

- It answers in any language, and the answer appears as it's being written.
- Buttons under each answer let you try again, ask another model, or compare.
- `/compare` runs a blind comparison right in the chat, with voting buttons.
- It works in groups: use `/ask`, mention the bot, or reply to it.

## For developers: one API for every model

_[Only once API_OPEN=true is live on the server.]_

Behind the website is the same API you can use in your own apps. Dualyne speaks the **OpenAI API
format**, so if your code already calls OpenAI, you change two values, the base URL and the key, and
everything else keeps working: streaming, tools, JSON mode.

Switching models is changing one string. Free keys use the free models (paid credits will open the
whole catalog), errors come
back in the format your SDK already understands, and every response tells you how much of your daily
allowance is left. You can start with 20 free requests a day. The docs are at **dualyne.com/docs**.

## How it works, in plain words

When you send a message, Dualyne passes it through OpenRouter to the model's own provider (Anthropic,
Meta, DeepSeek, Mistral and others) and streams the answer back to you. We don't train models, and we
don't sell data.

We made a few choices on purpose, and we want to be upfront about them:

- **Your chats stay in your browser.** By default, the text of your conversations is saved on your own
  device, not on our servers.
- **Sync is your choice.** Sign in and tick "Sync chats to my account" if you want your chats on your
  phone and your laptop. Turn it off and the synced copies are deleted.
- **Files are never stored.** They travel with your message to the model, and nowhere else.
- **No tracking cookies.** We count visits without cookies and without storing IP addresses.
- **Shared answers are real.** A shared chat can only contain answers a model actually gave on Dualyne, so
  nobody can put invented words in a model's mouth and pass them off as real.
- **Sign in your way.** A wallet, _[once configured:]_ or Google, or a code sent to your email. No
  passwords to leak.

## What's free, and what isn't

We believe AI should be easy to try, so the core of Dualyne is free:

- 10 chat messages a day with Claude, Llama, DeepSeek and Mistral
- Images, PDFs and text files in Chat
- 3 web searches a day
- Ask several, Compare, blind votes and the leaderboard
- The Telegram bot

We pay for the free tier ourselves, within a daily budget. On a very busy day, free chat can pause until
midnight UTC. We'd rather tell you that than pretend it's unlimited.

## What's next

**Dualyne Pro** is coming soon. It adds the premium models, GPT-5, Gemini 2.5 Pro and Claude Sonnet and
Opus, with more messages a day, more web searches and longer answers, for one flat monthly price. It
won't renew by itself, ever: nothing is charged unless you choose to pay again.

After that: more models as they launch, and more of the small things that make an AI app pleasant to use
every day. We build in public, so follow along.

## Try it

Ask something you actually care about. Then ask a second model the same thing. You'll see the difference
in the first minute.

→ **dualyne.com**
→ Telegram: **@dualynebot**
→ Follow **@DualyneAi** for updates

If something breaks, or could be better, tell us. We read every message.

---

## Post to share the article

> We wrote down why we built Dualyne, and what it can do today.
>
> Every AI model, one place: chat, compare side by side, images, PDFs, web search. Free to start.
>
> 👇

## Short reply for the thread

> TL;DR: ask Claude, Llama, DeepSeek and Mistral at once, pick the best answer, keep chatting. No signup.
> dualyne.com
