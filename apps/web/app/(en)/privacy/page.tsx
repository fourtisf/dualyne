import type { Metadata } from "next";
import Link from "next/link";
import { brand } from "@dualyne/config";
import { publicConfig } from "@/lib/config";

// Drafted to match what the code actually does. Have it reviewed by a lawyer before public launch.
export const metadata: Metadata = {
  title: "Privacy Policy",
  description: `What ${brand.name} collects, what it doesn't, and who processes your data.`,
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  const contact = brand.contactEmail;
  return (
    <main className="view">
      <div className="wrap">
        <article className="prose legal">
          <h1 className="grad">Privacy Policy</h1>
          <p className="upd">Last updated September 24, 2026</p>
          <p>
            This policy explains what {brand.legalName} (&quot;{brand.name}&quot;, &quot;we&quot;) collects
            when you use {brand.domain}, Chat, the Compare tool, the Telegram bot and the {brand.name} API.
            The short version: we don&apos;t keep the text of your prompts or the answers unless you choose to
            share them (the Telegram bot keeps your last few messages for one hour), we don&apos;t use
            tracking cookies or ads, and we keep only what we need to run limits and prevent abuse
            {brand.tokenEnabled ? " and publish the treasury ledger" : ""}.
          </p>

          <h2>What we collect</h2>
          <p>
            <strong>Chat.</strong> Your messages are sent to the model you picked so it can answer. The
            conversation is saved only in your browser&apos;s local storage; our servers don&apos;t store the
            text. For each message we record the model, token counts, cost, timing and the same one-way keyed
            hash of your IP address described below, which runs the daily limit. So that a shared chat
            can&apos;t put invented words in a model&apos;s mouth, we also keep a fingerprint of each answer
            (a one-way hash of the answer and your IP hash, not the text) for 24 hours. If you click{" "}
            <em>Share</em>, the conversation is saved and anyone with the link can read it, until you remove
            the link from the same browser.
          </p>
          <p>
            <strong>Files, web search and voice in Chat.</strong> Images, PDFs and text files you attach are
            sent with your message to the model (PDFs are turned into text by OpenRouter first). We don&apos;t
            store them, and your browser keeps only their names after a reload. When you turn on web search,
            your question is used to search the web through OpenRouter&apos;s search partner, and the pages
            found are passed to the model. Custom instructions are kept in your browser and sent with each
            message. Voice input and read-aloud use your browser&apos;s own speech features; some browsers
            (such as Chrome) send the audio to their maker to turn it into text. We never receive the audio.
          </p>
          <p>
            <strong>Telegram bot.</strong> When you message @dualynebot, Telegram delivers your messages to
            us. So the bot can follow the conversation, we keep your last 10 messages and its answers for one
            hour (in our cache, not in the database), and delete them sooner if you send /new. We also keep
            the model you picked for up to 30 days. Usage records store a one-way hash of your Telegram user
            id, never the id itself, your name or your username.
          </p>
          <p>
            <strong>Compare tool.</strong> Your prompt is sent to the two models you picked so they can
            answer. The prompt and both answers are held in memory for up to one hour so you can choose to
            share them, then deleted. If you click <em>Share</em>, they are saved and anyone with the link can
            read them, until you remove the link from the same browser. For each run we record which models
            ran, token counts, cost, timing, and a one-way keyed hash of your IP address that we use for the
            hourly limit and to stop abuse. We never store your raw IP address.
          </p>
          <p>
            <strong>API.</strong> For each request we record the key that made it (as a hash, never the key
            itself), the wallet address it belongs to, the model, token counts, cost, response time and
            status. We don&apos;t store request or response bodies.
          </p>
          <p>
            <strong>Wallet.</strong> When you sign in, you sign a message with your wallet. We store your
            public address, your API keys (as hashes) and a session record. Your wallet never shares private
            keys with us, and signing in doesn&apos;t send any transaction. To check eligibility for the free
            tier we read your wallet&apos;s public balance and age from the blockchain.
          </p>
          <p>
            <strong>Votes.</strong> When you pick the better answer, we store your vote, the two models and
            the same keyed hash of your IP address used for the hourly limit (and your wallet address if you
            are signed in). Votes build the public leaderboard, which shows only totals per model.
          </p>
          <p>
            <strong>Payments.</strong> For Pro and for API credits we record the transaction hash, the token
            and amount, and the wallet that paid, and for Pro the date it runs until. This information is
            public on the blockchain anyway. Pro chats are counted against your wallet instead of your IP
            address, the same way (model, token counts, cost, never the text).
          </p>
          <p>
            <strong>Your browser.</strong> Your connected address, your Compare votes and a count of your
            recent comparisons are saved in your browser&apos;s local storage so the site can show them to
            you. They stay on your device. You can delete them at any time by clearing this site&apos;s data
            in your browser.
          </p>
          <p>
            <strong>Visit statistics.</strong> To know how many people use the site, we count page views,
            daily unique visitors, the pages visited and the website that sent you (its domain only). A
            visitor is counted with a hash of the IP address and browser that changes every day and can&apos;t
            be reversed; we don&apos;t store the IP address, set cookies or use any third-party analytics.
            Counts are kept for 90 days.
          </p>
          <p>
            <strong>Server logs.</strong> Our servers log the method, path, status and timing of requests to
            keep the service running. We configure them not to log IP addresses, keys or request bodies.
          </p>

          <h2>Who else processes data</h2>
          <ul>
            <li>
              <strong>OpenRouter and the model providers</strong> (for example Anthropic, OpenAI, Google,
              Meta, DeepSeek and Mistral) receive your prompts in order to generate answers. Their own privacy
              policies and data retention rules apply to that content, including files you attach. When web
              search is on, OpenRouter&apos;s search partner (Exa) receives the search query.
            </li>
            <li>
              <strong>Telegram</strong> delivers messages between you and the bot when you use it.
              Telegram&apos;s own privacy policy applies to your account and messages there.
            </li>
            {publicConfig.turnstileSiteKey && (
              <li>
                <strong>Cloudflare Turnstile</strong>, the bot check on Chat and Compare, processes your IP
                address and browser details to tell people from bots.
              </li>
            )}
            <li>
              <strong>Our hosting provider</strong> runs the servers and database that hold the records
              described above.
            </li>
          </ul>
          <p>We don&apos;t sell personal data, and we don&apos;t use it for advertising.</p>

          <h2>How long we keep it</h2>
          <p>
            Rate-limit counters expire within 48 hours. Sessions end after 30 days or when you disconnect.
            Usage records (models, token counts, cost, timing) are kept for as long as we need them to operate
            limits and billing{brand.tokenEnabled ? " and the public ledger" : ""}. Telegram conversations are
            forgotten after one hour, visit statistics after 90 days. Database backups are deleted after 14
            days.
          </p>

          <h2>Cookies</h2>
          <p>
            We use one essential cookie, <code>dly_session</code>, to keep you signed in for up to 30 days. It
            is HttpOnly, is only sent to our API and contains a random value, not your address. We don&apos;t
            use tracking or advertising cookies.
          </p>

          <h2>What you should not send</h2>
          <p>
            Don&apos;t put passwords, private keys, seed phrases or other sensitive personal information in
            prompts. Model providers process everything you send.
          </p>

          <h2>Your rights</h2>
          <p>
            Depending on where you live, you may have the right to access or delete data about you.{" "}
            {contact ? (
              <>
                Email <a href={`mailto:${contact}`}>{contact}</a> and we&apos;ll respond within 30 days.
              </>
            ) : (
              "Contact us through the channels listed on the site and we'll respond within 30 days."
            )}{" "}
            Because we don&apos;t store prompt text or raw IP addresses, there is usually very little we can
            link to you.
          </p>

          <h2>Changes</h2>
          <p>
            If we change this policy, we&apos;ll update the date at the top. Significant changes will be
            announced on the site. See also the <Link href="/terms">Terms of Service</Link>.
          </p>
        </article>
      </div>
    </main>
  );
}
