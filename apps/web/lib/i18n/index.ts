import { en, type Dict, type Locale } from "./en";

export type { Dict, Locale };

const DICTS: Record<Locale, Dict> = { en };

export const getDict = (locale: Locale): Dict => DICTS[locale];

/** Link to a page in the given language. The site is English only, so paths stay as they are. */
export function href(_locale: Locale, path: string): string {
  return path;
}

/** Human wait time, e.g. "12 minutes". */
export function formatWait(t: Dict, seconds: number): string {
  if (seconds < 90) return t.wait.seconds(Math.max(1, Math.round(seconds)));
  const m = Math.round(seconds / 60);
  return m < 90 ? t.wait.minutes(m) : t.wait.hours(Math.round(m / 60));
}

/** Text for an API error: the translated message for its code, else the API's own message. */
export const apiErrorText = (t: Dict, code: string, message: string): string => t.apiErrors[code] ?? message;
