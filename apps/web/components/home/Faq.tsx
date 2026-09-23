import Link from "next/link";
import type { ReactNode } from "react";
import { brand } from "@refract/config";

const FAQ: [string, ReactNode][] = [
  [
    `Is ${brand.name} really free?`,
    "Yes. Comparing models in the browser is free with no account. Wallets get a daily allowance through the API, paid for by the treasury.",
  ],
  [
    "Why do I need a wallet for API keys?",
    "Your wallet works as your account, so there's no email or password to leak. It also lets us raise your limits automatically when you hold the token.",
  ],
  [
    "Which models can I use?",
    "The API routes to models from Anthropic, OpenAI, Google, Meta, Mistral, DeepSeek and more. Every model in the catalog is live, in the Compare tool and through the API.",
  ],
  [
    "What happens to my prompts?",
    <>
      {brand.name} does not store the text of your prompts or the answers. We keep only what&apos;s needed to
      run limits and publish the ledger: which model you used, token counts, cost and timing. Requests pass
      through OpenRouter to the model&apos;s provider, whose own data policy applies. Details are in the{" "}
      <Link href="/privacy">Privacy Policy</Link>.
    </>,
  ],
  [
    "What happens when my daily allowance runs out?",
    "Your requests pause until the next day, or you can top up credits in USDG or ETH and keep going at model cost plus 15%.",
  ],
  [
    "Where does the treasury money come from?",
    "A 1% fee on every token trade goes to a public treasury wallet. The ledger shows what comes in and what is spent on inference, every day.",
  ],
  [
    "Why not call OpenRouter or the providers directly?",
    `You can, and for heavy paid use it's cheaper. ${brand.name} adds what they don't: a free daily allowance paid for by the treasury, a side-by-side Compare tool, and keys tied to a wallet instead of an email and a card.`,
  ],
  [
    `Can I use ${brand.name} with my existing code?`,
    `Yes. ${brand.name} speaks the OpenAI API format. Change the base URL and the API key, and existing SDKs, bots and agents keep working.`,
  ],
];

export function Faq() {
  return (
    <section className="block" id="faq">
      <div className="wrap">
        <div className="head">
          <div className="kick">
            <i />
            FAQ
          </div>
          <h2>Questions, answered.</h2>
        </div>
        <div className="faq">
          {FAQ.map(([q, a]) => (
            <details key={q}>
              <summary>{q}</summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
