export interface TurnstileOptions {
  secret: string;
  verifyUrl: string;
  /** Hostnames the token must have been issued on. Empty = do not check (development). */
  hostnames: string[];
  action: string;
}

/** Verify a Cloudflare Turnstile token. Tokens are single use. */
export async function verifyTurnstile(
  opts: TurnstileOptions,
  token: string | undefined,
  ip: string,
): Promise<boolean> {
  if (!token) return false;
  const form = new URLSearchParams({ secret: opts.secret, response: token, remoteip: ip });
  try {
    const res = await fetch(opts.verifyUrl, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return false;
    const json = (await res.json()) as { success?: boolean; hostname?: string; action?: string };
    if (json.success !== true) return false;
    if (opts.hostnames.length && !opts.hostnames.includes(json.hostname ?? "")) return false;
    if (json.action && json.action !== opts.action) return false;
    return true;
  } catch {
    return false;
  }
}
