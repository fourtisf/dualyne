import { en, type Dict, type Locale } from "./en";
import { id } from "./id";

export type { Dict, Locale };

const DICTS: Record<Locale, Dict> = { en, id };

export const getDict = (locale: Locale): Dict => DICTS[locale];

/** Pages that exist in both languages (the Indonesian copy lives under /id). */
const TRANSLATED = ["/dashboard", "/models", "/status"];
const isTranslated = (p: string) => TRANSLATED.some((t) => p === t || p.startsWith(`${t}/`));

/**
 * Link to a page in the given language. The home page, dashboard, model pages and status page
 * are translated; other pages (docs, legal, shared results) exist in English only.
 * `href("id", "/#faq")` → "/id#faq", `href("id", "/models/gpt")` → "/id/models/gpt",
 * `href("id", "/?a=llama#compare")` → "/id?a=llama#compare".
 */
export function href(locale: Locale, path: string): string {
  if (locale === "en") return path;
  const m = /^([^?#]*)(.*)$/.exec(path)!;
  const p = m[1] || "/";
  const rest = m[2] ?? "";
  if (p === "/") return `/id${rest}`;
  return isTranslated(p) ? `/id${p}${rest}` : path;
}

/** The same page in the other language, for the language switch. */
export function switchPath(pathname: string): string {
  if (pathname === "/id" || pathname.startsWith("/id/")) return pathname.slice(3) || "/";
  return isTranslated(pathname) ? `/id${pathname}` : "/id";
}

/** Human wait time, e.g. "12 minutes" / "12 menit". */
export function formatWait(t: Dict, seconds: number): string {
  if (seconds < 90) return t.wait.seconds(Math.max(1, Math.round(seconds)));
  const m = Math.round(seconds / 60);
  return m < 90 ? t.wait.minutes(m) : t.wait.hours(Math.round(m / 60));
}

/** Text for an API error: the translated message for its code, else the API's own message. */
export const apiErrorText = (t: Dict, code: string, message: string): string => t.apiErrors[code] ?? message;
