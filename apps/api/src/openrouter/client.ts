/** The only module that sees OPENROUTER_API_KEY. */
export interface OpenRouterOptions {
  baseUrl: string;
  apiKey: string;
  appUrl: string;
  appTitle: string;
}

export interface OpenRouterModel {
  id: string;
  name?: string;
  created?: number;
  context_length?: number | null;
  pricing?: { prompt?: string; completion?: string };
}

export class OpenRouter {
  constructor(private readonly opts: OpenRouterOptions) {}

  private headers(): Record<string, string> {
    return {
      // The public model list works without a key (preview mode keeps prices up to date).
      ...(this.opts.apiKey ? { authorization: `Bearer ${this.opts.apiKey}` } : {}),
      "content-type": "application/json",
      "http-referer": this.opts.appUrl,
      "x-title": this.opts.appTitle,
    };
  }

  /** POST /chat/completions. Returns the raw Response so the caller can stream the body. */
  chat(body: Record<string, unknown>, signal: AbortSignal): Promise<Response> {
    return fetch(`${this.opts.baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
      signal,
    });
  }

  async models(): Promise<OpenRouterModel[]> {
    const res = await fetch(`${this.opts.baseUrl}/models`, {
      headers: this.headers(),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`OpenRouter /models returned ${res.status}`);
    const json = (await res.json()) as { data?: OpenRouterModel[] };
    if (!Array.isArray(json.data)) throw new Error("OpenRouter /models returned no data array");
    return json.data;
  }

  /**
   * USD left to spend: the account balance (GET /credits) and, if the key has its own credit
   * limit, what is left of that (GET /key); the smaller of the two. Null when neither answers.
   */
  async creditsLeft(): Promise<number | null> {
    const read = async (path: string) => {
      try {
        const res = await fetch(`${this.opts.baseUrl}${path}`, {
          headers: this.headers(),
          signal: AbortSignal.timeout(15_000),
        });
        return res.ok ? ((await res.json()) as { data?: Record<string, unknown> }).data : undefined;
      } catch {
        return undefined;
      }
    };
    const [credits, key] = await Promise.all([read("/credits"), read("/key")]);
    const left: number[] = [];
    if (typeof credits?.total_credits === "number" && typeof credits.total_usage === "number") {
      left.push(credits.total_credits - credits.total_usage);
    }
    if (typeof key?.limit_remaining === "number") left.push(key.limit_remaining);
    return left.length ? Math.min(...left) : null;
  }
}
