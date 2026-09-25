import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { brand } from "@dualyne/config";
import { getCatalog } from "@/lib/catalog";
import { md } from "@/lib/markdown";
import { getSharedCompare, type SharedCompare } from "@/lib/shares";
import { UnshareButton } from "./UnshareButton";

async function names(s: SharedCompare) {
  const { models } = await getCatalog();
  const n = (id: string) => models.find((m) => m.id === id)?.menuName ?? id;
  return { a: n(s.a), b: n(s.b) };
}

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const s = await getSharedCompare(params.id);
  if (!s) return { title: "Shared comparison", robots: { index: false } };
  const { a, b } = await names(s);
  const prompt = s.prompt.length > 150 ? `${s.prompt.slice(0, 147)}…` : s.prompt;
  return {
    title: `${a} vs ${b}`,
    description: `“${prompt}” Two AI models, one prompt, side by side on ${brand.name}.`,
    robots: { index: false, follow: true },
    alternates: { canonical: `/s/${s.id}` },
  };
}

export default async function SharedPage({ params }: { params: { id: string } }) {
  const s = await getSharedCompare(params.id);
  if (!s) notFound();
  const { a, b } = await names(s);
  return (
    <main className="view">
      <div className="wrap">
        <div className="head" style={{ marginBottom: 28 }}>
          <div className="kick">
            <i />
            Shared comparison · {new Date(s.createdAt).toLocaleDateString("en-US", { dateStyle: "medium" })}
          </div>
          <h2>
            {a} vs {b}
          </h2>
        </div>
        <div className="console">
          <div className="composer">
            <p className="shared-prompt">{s.prompt}</p>
          </div>
          <div className="lanes">
            {(
              [
                ["a", a, s.answerA],
                ["b", b, s.answerB],
              ] as const
            ).map(([L, name, answer]) => (
              <div className="lane" data-lane={L} key={L}>
                <div className="lh">
                  <span className="sw" />
                  <span className="blind-name">{name}</span>
                </div>
                <div className="lb" dangerouslySetInnerHTML={{ __html: md(answer) }} />
              </div>
            ))}
          </div>
        </div>
        <div className="ctas" style={{ justifyContent: "flex-start", margin: "28px 0 96px" }}>
          <Link className="btn lg" href="/#compare">
            Run your own comparison
          </Link>
          <UnshareButton id={s.id} />
        </div>
      </div>
    </main>
  );
}
