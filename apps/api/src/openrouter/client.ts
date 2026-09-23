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
}
