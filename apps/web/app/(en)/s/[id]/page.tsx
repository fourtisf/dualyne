import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { brand } from "@dualyne/config";
import { getCatalog } from "@/lib/catalog";
import { md } from "@/lib/markdown";
import { UnshareButton } from "./UnshareButton";

interface Shared {
  id: string;
  prompt: string;
  a: string;
  b: string;
  answerA: string;
  answerB: string;
  createdAt: string;
}

async function getShare(id: string): Promise<Shared | null> {
  if (!/^[A-Za-z0-9]{6,20}$/.test(id)) return null;
  const base = process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL;
  if (!base) return null;
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/shares/${id}`, {
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(3000),
    });
    return res.ok ? ((await res.json()) as Shared) : null;
  } catch {
    return null;
  }
}

async function names(s: Shared) {
  const { models } = await getCatalog();
  const n = (id: string) => models.find((m) => m.id === id)?.menuName ?? id;
  return { a: n(s.a), b: n(s.b) };
}

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const s = await getShare(params.id);
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
  const s = await getShare(params.id);
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
