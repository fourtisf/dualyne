import "server-only";
import type { SharedChat } from "@dualyne/shared";

/** A comparison someone shared (GET /shares/:id). */
export interface SharedCompare {
  id: string;
  prompt: string;
  a: string;
  b: string;
  answerA: string;
  answerB: string;
  createdAt: string;
}

async function fromApi<T>(path: string): Promise<T | null> {
  const base = process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL;
  if (!base) return null;
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}${path}`, {
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(3000),
    });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

const validId = (id: string) => /^[A-Za-z0-9]{6,20}$/.test(id);

export const getSharedCompare = (id: string) =>
  validId(id) ? fromApi<SharedCompare>(`/shares/${id}`) : Promise.resolve(null);

export const getSharedChat = (id: string) =>
  validId(id) ? fromApi<SharedChat>(`/internal/chat/share/${id}`) : Promise.resolve(null);

/** Markdown to one line of plain text, cut to `max` characters. */
export function excerpt(md: string, max: number): string {
  const text = md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#*_>~|]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
