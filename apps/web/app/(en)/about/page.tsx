import type { Metadata } from "next";
import Link from "next/link";
import { brand } from "@dualyne/config";
import { publicConfig } from "@/lib/config";

export const metadata: Metadata = {
  title: "About",
  description: `Who runs ${brand.name}, how it works, how it makes money and how to reach us.`,
  alternates: { canonical: "/about" },
};

/** Plain facts about the service, matching what the code does. */
export default function AboutPage() {
  const contact = brand.contactEmail;
  return (
    <main className="view">
      <div className="wrap">
        <article className="prose legal">
          <h1 className="grad">About {brand.name}</h1>
          <p className="upd">Every AI model, one prompt away.</p>
          <p>
            {brand.name} is a small, independent product built by the {brand.name} team. We made it because
            picking an AI model shouldn&apos;t take five accounts and five subscriptions: you should be able
            to ask a question, see how different models answer, and use the one that works for you.
          </p>

          <h2>What you can do</h2>
          <ul>
            <li>
              <strong>Chat</strong> with Claude, Llama, DeepSeek and Mistral for free, with no signup, in the
              browser or on Telegram (<a href="https://t.me/dualynebot">@dualynebot</a>). Pro adds GPT-5,
              Gemini 2.5 Pro and Claude Sonnet and Opus.
            </li>
            <li>
              <strong>Compare</strong> two models on the same prompt, side by side, and vote for the better
              answer. Votes build a public leaderboard.
            </li>
            <li>
              <strong>Build</strong> with one OpenAI-compatible API key for every model in the catalog.
            </li>
          </ul>

          <h2>How it works</h2>
          <p>
            Your message goes from {brand.name} to{" "}
            <a href="https://openrouter.ai" rel="noopener">
              OpenRouter
            </a>
            , which passes it to the model&apos;s provider (Anthropic, Meta, DeepSeek, Mistral, OpenAI,
            Google) and streams the answer back. We don&apos;t train models and we don&apos;t sell data.
          </p>

          <h2>How we make money</h2>
          <p>
            Free chat and comparisons run on the smaller models, paid for by us within a daily budget. To keep
            it fair, each person gets a number of free messages a day, and on a very busy day free chat can
            pause until 00:00 UTC. <Link href="/#pricing">Pro</Link> is a flat ${publicConfig.proPriceUsd} for{" "}
            {publicConfig.proDays} days, paid in crypto, and unlocks the premium models. Developers pay model
            cost plus 15% through the API. That&apos;s the whole business: no ads, no selling data.
          </p>

          <h2>Your privacy, in short</h2>
          <ul>
            <li>Chats on the website stay in your browser. We don&apos;t store the text on our servers.</li>
            <li>
              The Telegram bot remembers your last 10 messages for one hour so it can follow the conversation.
            </li>
            <li>We count visits without cookies and without storing IP addresses.</li>
          </ul>
          <p>
            The details are in the <Link href="/privacy">Privacy Policy</Link> and the{" "}
            <Link href="/terms">Terms of Service</Link>. You can check that everything is running on the{" "}
            <Link href="/status">status page</Link>.
          </p>

          <h2>Contact</h2>
          <p>
            Questions, bugs, partnerships or data requests: <a href={`mailto:${contact}`}>{contact}</a>.
            {brand.social.x && (
              <>
                {" "}
                News and updates on{" "}
                <a href={brand.social.x} rel="noopener">
                  X
                </a>
                {brand.social.telegram && (
                  <>
                    {" "}
                    and our{" "}
                    <a href={brand.social.telegram} rel="noopener">
                      Telegram channel
                    </a>
                  </>
                )}
                .
              </>
            )}
          </p>
        </article>
      </div>
    </main>
  );
}
