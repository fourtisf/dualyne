import { store } from "./storage";

const KEY = "dualyne.ref";
/** How long an invite link counts after the visit. */
const KEEP_MS = 30 * 24 * 3600 * 1000;

/** Remember ?ref=CODE from the address the visitor arrived with. */
export function captureReferral(): void {
  if (typeof window === "undefined") return;
  const code = new URLSearchParams(window.location.search).get("ref")?.trim().toUpperCase();
  if (code && /^[2-9A-Z]{8}$/.test(code)) store.set(KEY, { code, at: Date.now() });
}

/** The invite code to send when an account is created, if any. */
export function referralCode(): string | undefined {
  const r = store.get<{ code: string; at: number } | null>(KEY, null);
  return r && Date.now() - r.at < KEEP_MS ? r.code : undefined;
}
