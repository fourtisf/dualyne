import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { brand } from "@dualyne/config";
import { ProviderMark } from "@/components/ProviderMark";
import { getCatalog } from "@/lib/catalog";
import { md } from "@/lib/markdown";
import { getSharedChat } from "@/lib/shares";
import { UnshareButton } from "../../s/[id]/UnshareButton";

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const c = await getSharedChat(params.id);
  if (!c) return { title: "Shared chat", robots: { index: false } };
  const first = c.messages[0]?.content ?? c.title;
  return {
    title: c.title,
    description: `“${first.length > 150 ? `${first.slice(0, 147)}…` : first}” A chat shared from ${brand.name}.`,
    robots: { index: false, follow: true },
    alternates: { canonical: `/c/${c.id}` },
  };
}

/** A chat someone shared from the Chat page. Every answer here was written on Dualyne. */
export default async function SharedChatPage({ params }: { params: { id: string } }) {
  const c = await getSharedChat(params.id);
  if (!c) notFound();
  const { models } = await getCatalog();
  const model = models.find((m) => m.id === c.model);
  return (
    <main className="view">
      <div className="wrap shared-chat">
        <div className="head" style={{ marginBottom: 28 }}>
          <div className="kick">
            <i />
            Shared chat · {new Date(c.createdAt).toLocaleDateString("en-US", { dateStyle: "medium" })}
          </div>
          <h2>{c.title}</h2>
        </div>
        <div className="sc-log">
          {c.messages.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="msg-user">
                <div className="bubble">{m.content}</div>
              </div>
            ) : (
              <div key={i} className="msg-ai">
                {model && <ProviderMark provider={model.provider} color={model.providerColor} size={26} />}
                <div className="ai-body">
                  <div className="ai-name">{model?.name ?? c.model}</div>
                  <div className="lb" dangerouslySetInnerHTML={{ __html: md(m.content) }} />
                </div>
              </div>
            ),
          )}
        </div>
        <p className="sc-note">
          Every answer in this chat was written by an AI model on {brand.name} and checked when it was shared.
          AI answers can be wrong; check anything important.
        </p>
        <div className="ctas" style={{ justifyContent: "flex-start" }}>
          <Link className="btn lg" href="/chat">
            Ask your own question
          </Link>
          <UnshareButton id={c.id} api="/internal/chat/share/" storeKey="dualyne.chatShares" />
        </div>
      </div>
    </main>
  );
}
