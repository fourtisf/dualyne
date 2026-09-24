/**
 * Cloudflare Turnstile, loaded lazily and run invisibly ("interaction-only"): the widget only
 * shows itself if Cloudflare needs the visitor to click. Each comparison gets a fresh token.
 */
interface TurnstileApi {
  render(el: HTMLElement, opts: Record<string, unknown>): string;
  execute(id: string): void;
  reset(id: string): void;
}
declare global {
  interface Window {
    turnstile?: TurnstileApi;
    __rfTurnstileReady?: () => void;
  }
}

const SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=__rfTurnstileReady";
const TOKEN_TIMEOUT_MS = 60_000;

let loading: Promise<TurnstileApi> | null = null;

export function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (loading) return loading;
  loading = new Promise<TurnstileApi>((resolve, reject) => {
    window.__rfTurnstileReady = () =>
      window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile"));
    const s = document.createElement("script");
    s.src = SCRIPT_SRC;
    s.async = true;
    s.defer = true;
    s.onerror = () => {
      loading = null;
      reject(new Error("turnstile_load_failed"));
    };
    document.head.appendChild(s);
  });
  return loading;
}

export class TurnstileRunner {
  private widgetId: string | null = null;
  private pending: { resolve: (t: string) => void; reject: (e: Error) => void } | null = null;

  constructor(
    private readonly siteKey: string,
    private readonly container: HTMLElement,
    /** Must match the action the API checks for the route ("compare" or "chat"). */
    private readonly action: "compare" | "chat" = "compare",
  ) {}

  async token(): Promise<string> {
    const ts = await loadTurnstile();
    this.pending?.reject(new Error("superseded"));
    const promise = new Promise<string>((resolve, reject) => {
      this.pending = { resolve, reject };
      setTimeout(() => reject(new Error("turnstile_timeout")), TOKEN_TIMEOUT_MS);
    });
    if (this.widgetId === null) {
      this.widgetId = ts.render(this.container, {
        sitekey: this.siteKey,
        action: this.action,
        execution: "execute",
        appearance: "interaction-only",
        theme: "dark",
        callback: (t: string) => this.pending?.resolve(t),
        "error-callback": () => this.pending?.reject(new Error("turnstile_error")),
        "expired-callback": () => this.pending?.reject(new Error("turnstile_expired")),
      });
    } else {
      ts.reset(this.widgetId);
    }
    ts.execute(this.widgetId);
    return promise.finally(() => {
      this.pending = null;
    });
  }
}
