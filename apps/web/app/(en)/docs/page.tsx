import type { Metadata } from "next";
import Link from "next/link";
import { brand } from "@refract/config";
import { TIER_DEFAULTS } from "@refract/shared";
import { getCatalog } from "@/lib/catalog";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Documentation",
  description: `Use every major AI model through one OpenAI-compatible endpoint. Quickstart, authentication, streaming, limits and errors for the ${brand.name} API.`,
  alternates: { canonical: "/docs" },
};

const envName = `${brand.name.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_KEY`;
const base = brand.apiBaseUrl;
const ex = TIER_DEFAULTS.explorer;
const ho = TIER_DEFAULTS.holder;

export default async function DocsPage() {
  const { models } = await getCatalog();
  return (
    <main className="view" id="view-docs">
      <div className="wrap doc">
        <nav className="toc" aria-label="Docs">
          <span className="h">Getting started</span>
          <a href="#d-quick">Quickstart</a>
          <a href="#d-auth">Authentication</a>
          <span className="h">API reference</span>
          <a href="#d-chat">Chat completions</a>
          <a href="#d-models">Models</a>
          <a href="#d-stream">Streaming</a>
          <span className="h">Operations</span>
          <a href="#d-limits">Limits and billing</a>
          <a href="#d-errors">Errors</a>
        </nav>
        <article className="prose">
          <h1 className="grad">{brand.name} documentation</h1>
          <p>
            {brand.name} gives you every major AI model through one OpenAI-compatible endpoint. If your code
            already calls OpenAI, you only change two values.
          </p>
          <div className="call">
            Base URL: <code>{base}</code>
          </div>

          <h2 id="d-quick">Quickstart</h2>
          <p>
            1. Connect a wallet and create a key in the <Link href="/dashboard">dashboard</Link>. 2. Set it as
            an environment variable. 3. Point your SDK at {brand.name}.
          </p>
          <pre>
            <code>{`export ${envName}="${brand.keyPrefix}..."

import os
from openai import OpenAI
client = OpenAI(base_url="${base}", api_key=os.environ["${envName}"])
reply = client.chat.completions.create(
    model="claude-swift",
    messages=[{"role": "user", "content": "Hello"}],
)
print(reply.choices[0].message.content)`}</code>
          </pre>

          <h2 id="d-auth">Authentication</h2>
          <p>
            Send your key as a bearer token on every request. Keys belong to the wallet that created them and
            stop working the moment you revoke them.
          </p>
          <pre>
            <code>{`Authorization: Bearer ${brand.keyPrefix}...`}</code>
          </pre>
          <p>
            Never put a key in front-end code or a public repository. If a key leaks, revoke it in the
            dashboard and create a new one. {brand.name} stores only a hash of each key, so a lost key
            can&apos;t be shown again.
          </p>

          <h2 id="d-chat">Chat completions</h2>
          <p>
            <span className="meth">POST</span>
            <code>/v1/chat/completions</code>
          </p>
          <div className="tblw">
            <table>
              <thead>
                <tr>
                  <th>Field</th>
                  <th>Type</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <code>model</code>
                  </td>
                  <td>string</td>
                  <td>
                    Model id from the models list, for example <code>gemini</code>
                  </td>
                </tr>
                <tr>
                  <td>
                    <code>messages</code>
                  </td>
                  <td>array</td>
                  <td>
                    Conversation turns with <code>role</code> and <code>content</code>
                  </td>
                </tr>
                <tr>
                  <td>
                    <code>stream</code>
                  </td>
                  <td>boolean</td>
                  <td>Send tokens as they are generated</td>
                </tr>
                <tr>
                  <td>
                    <code>max_tokens</code>
                  </td>
                  <td>integer</td>
                  <td>Upper limit on the answer length (capped per tier, see below)</td>
                </tr>
                <tr>
                  <td>
                    <code>tools</code>
                  </td>
                  <td>array</td>
                  <td>Function definitions the model may call</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p>
            Other OpenAI fields such as <code>temperature</code>, <code>response_format</code> and{" "}
            <code>stream_options</code> pass through unchanged. Tool calling and JSON mode work on models
            whose provider supports them. The response&apos;s <code>model</code> field names the exact model
            version that answered. <code>n</code> must be 1.
          </p>

          <h2 id="d-models">Models</h2>
          <p>
            <span className="meth get">GET</span>
            <code>/v1/models</code> returns every model your key can use. Explorer wallets see fast models;
            Holder and Builder see the full catalog.
          </p>
          <div className="tblw">
            <table>
              <thead>
                <tr>
                  <th>Model id</th>
                  <th>Provider</th>
                  <th>Runs on</th>
                  <th>Tier</th>
                </tr>
              </thead>
              <tbody>
                {models.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <code>{m.id}</code>
                    </td>
                    <td>{m.provider}</td>
                    <td>{m.upstreamName}</td>
                    <td>{TIER_DEFAULTS[m.minTier].label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Each id is a stable name for a model family. When a newer version replaces the one listed under
            &quot;Runs on&quot;, this table and the catalog update, and your code keeps working without
            changes.
          </p>

          <h2 id="d-stream">Streaming</h2>
          <p>
            Set <code>&quot;stream&quot;: true</code> to receive server-sent events. Each event carries a
            small piece of the answer; the last one is <code>data: [DONE]</code>. Lines starting with{" "}
            <code>:</code> are keep-alive comments and can be ignored (the OpenAI SDKs do this for you).
          </p>
          <pre>
            <code>{`for chunk in client.chat.completions.create(model="gpt", messages=msgs, stream=True):
    print(chunk.choices[0].delta.content or "", end="")`}</code>
          </pre>
          <pre>
            <code>{`curl -N ${base}/chat/completions \\
  -H "Authorization: Bearer $${envName}" \\
  -H "Content-Type: application/json" \\
  -d '{"model": "claude-swift", "stream": true,
       "messages": [{"role": "user", "content": "Hello"}]}'`}</code>
          </pre>
          <p>
            To get token counts at the end of a stream, send{" "}
            <code>
              &quot;stream_options&quot;: {"{"}&quot;include_usage&quot;: true{"}"}
            </code>
            . The final chunk then carries <code>usage</code> and an empty <code>choices</code> list, so check
            the list before reading from it.
          </p>

          <h2 id="d-limits">Limits and billing</h2>
          <div className="tblw">
            <table>
              <thead>
                <tr>
                  <th>Tier</th>
                  <th>Requests per day</th>
                  <th>Max answer length</th>
                  <th>Keys</th>
                  <th>Cost</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Explorer</td>
                  <td>{ex.dailyRequests}</td>
                  <td>{ex.maxTokens?.toLocaleString("en-US")} tokens</td>
                  <td>{ex.maxKeys}</td>
                  <td>Free</td>
                </tr>
                <tr>
                  <td>Holder</td>
                  <td>{ho.dailyRequests}</td>
                  <td>{ho.maxTokens?.toLocaleString("en-US")} tokens</td>
                  <td>{ho.maxKeys}</td>
                  <td>Free, funded by the treasury</td>
                </tr>
                <tr>
                  <td>Builder</td>
                  <td>No cap</td>
                  <td>Model limit</td>
                  <td>Unlimited</td>
                  <td>Model cost + 15%, prepaid in USDG or ETH</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p>
            Allowances reset at 00:00 UTC. Explorer and Holder responses include{" "}
            <code>x-refract-remaining</code> so your app can see how many requests are left today. A larger{" "}
            <code>max_tokens</code> than your tier allows is lowered to the cap. Each key can send up to 120
            requests a minute.
          </p>
          <p>
            Builder wallets top up with USDG or ETH from the dashboard. Each request reserves its worst-case
            cost (model price + 15%) and is then charged the real amount; the difference goes straight back to
            your balance. The dashboard lists every top-up and what each key spent.
          </p>
          <p>
            Free tiers share a daily budget paid for by the treasury. On the rare day it runs out, free
            requests return <code>429</code> until 00:00 UTC; Builder requests keep working.
          </p>

          <h2 id="d-errors">Errors</h2>
          <div className="tblw">
            <table>
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Meaning</th>
                  <th>What to do</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <code>400</code>
                  </td>
                  <td>The request body is invalid</td>
                  <td>Read the message; it names the field</td>
                </tr>
                <tr>
                  <td>
                    <code>401</code>
                  </td>
                  <td>Key missing, wrong or revoked</td>
                  <td>Check the key or create a new one</td>
                </tr>
                <tr>
                  <td>
                    <code>402</code>
                  </td>
                  <td>Builder credit too low for this request</td>
                  <td>
                    Top up in the dashboard, or lower <code>max_tokens</code>
                  </td>
                </tr>
                <tr>
                  <td>
                    <code>403</code>
                  </td>
                  <td>Model not in your tier</td>
                  <td>Hold the token or top up credits</td>
                </tr>
                <tr>
                  <td>
                    <code>404</code>
                  </td>
                  <td>Unknown model id</td>
                  <td>
                    Use an id from <code>GET /v1/models</code>
                  </td>
                </tr>
                <tr>
                  <td>
                    <code>429</code>
                  </td>
                  <td>Daily allowance used up, or too many requests per minute</td>
                  <td>
                    Wait for the time in the <code>Retry-After</code> header, or top up credits
                  </td>
                </tr>
                <tr>
                  <td>
                    <code>502</code>
                  </td>
                  <td>The model provider failed</td>
                  <td>Retry once, or switch models</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p>Errors use the OpenAI format, so SDKs raise them as normal exceptions:</p>
          <pre>
            <code>{`{
  "error": {
    "message": "Daily allowance used up (20 requests for Explorer). It resets at 00:00 UTC.",
    "type": "rate_limit_error",
    "code": "quota_exceeded"
  }
}`}</code>
          </pre>
        </article>
      </div>
    </main>
  );
}
