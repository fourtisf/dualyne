/**
 * Splits an SSE byte stream into complete events without altering them, so events can be
 * forwarded byte-for-byte while also being inspected.
 */
export class SseEventSplitter {
  private buf = "";
  private readonly decoder = new TextDecoder();

  /** Feed a chunk; returns the complete events it finished (each includes its trailing blank line). */
  push(chunk: Uint8Array): string[] {
    this.buf += this.decoder.decode(chunk, { stream: true });
    return this.drain();
  }

  /** Flush whatever is left at end of stream. */
  end(): string[] {
    this.buf += this.decoder.decode();
    const out = this.drain();
    if (this.buf.length) out.push(this.buf);
    this.buf = "";
    return out;
  }

  private drain(): string[] {
    const out: string[] = [];
    for (;;) {
      const m = /\r?\n\r?\n/.exec(this.buf);
      if (!m) break;
      const end = m.index + m[0].length;
      out.push(this.buf.slice(0, end));
      this.buf = this.buf.slice(end);
    }
    return out;
  }
}

/** The joined `data:` payload of one SSE event, or null for comment-only events. */
export function eventData(event: string): string | null {
  const lines = event.split(/\r?\n/);
  const data: string[] = [];
  for (const line of lines) {
    if (line.startsWith("data:")) data.push(line.slice(line.startsWith("data: ") ? 6 : 5));
  }
  return data.length ? data.join("\n") : null;
}

export interface UsageInfo {
  promptTokens: number;
  completionTokens: number;
  /** USD as reported by OpenRouter, when present. */
  costUsd: number | null;
}

interface ChunkLike {
  id?: unknown;
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; cost?: unknown } | null;
  choices?: { delta?: Record<string, unknown>; message?: Record<string, unknown> }[];
  error?: { code?: unknown; message?: unknown };
}

export function readUsage(json: ChunkLike): UsageInfo | null {
  const u = json.usage;
  if (!u || typeof u !== "object") return null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return {
    promptTokens: num(u.prompt_tokens),
    completionTokens: num(u.completion_tokens),
    costUsd: typeof u.cost === "number" && Number.isFinite(u.cost) ? u.cost : null,
  };
}

/** Tracks what we need from a completion stream: generation id, usage, first-token time, errors. */
export class StreamInspector {
  generationId: string | null = null;
  usage: UsageInfo | null = null;
  firstTokenAt: number | null = null;
  errorCode: string | null = null;
  /** Content text of the most recent delta (used by Compare). */
  lastDelta = "";
  /** Characters of output seen so far, for estimating cost when usage never arrives. */
  outputChars = 0;
  /** Web pages cited by the answer (OpenRouter web search annotations), in order, no repeats. */
  readonly sources: { url: string; title: string }[] = [];

  constructor(private readonly now: () => number = Date.now) {}

  /**
   * Inspect one event. Returns "drop" for the usage-only chunk that we asked OpenRouter to add
   * when the client did not request it, otherwise "keep".
   */
  inspect(event: string, clientWantsUsage: boolean): "keep" | "drop" {
    this.lastDelta = "";
    const data = eventData(event);
    if (data === null || data === "[DONE]") return "keep";
    let json: ChunkLike;
    try {
      json = JSON.parse(data) as ChunkLike;
    } catch {
      return "keep";
    }
    if (typeof json.id === "string" && !this.generationId) this.generationId = json.id;
    if (json.error) this.errorCode = String(json.error.code ?? "upstream_error");
    const delta = json.choices?.[0]?.delta;
    if (delta) {
      const content = typeof delta.content === "string" ? delta.content : "";
      this.lastDelta = content;
      this.outputChars += content.length;
      const hasOutput =
        content.length > 0 ||
        (Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0) ||
        (typeof delta.reasoning === "string" && delta.reasoning.length > 0);
      if (hasOutput && this.firstTokenAt === null) this.firstTokenAt = this.now();
    }
    for (const c of json.choices ?? []) this.collectSources(c.delta?.annotations ?? c.message?.annotations);
    const usage = readUsage(json);
    if (usage) {
      this.usage = usage;
      const noChoices = !Array.isArray(json.choices) || json.choices.length === 0;
      if (!clientWantsUsage && noChoices) return "drop";
    }
    return "keep";
  }

  private collectSources(annotations: unknown): void {
    if (!Array.isArray(annotations)) return;
    for (const a of annotations as { type?: unknown; url_citation?: { url?: unknown; title?: unknown } }[]) {
      const c = a?.type === "url_citation" ? a.url_citation : undefined;
      if (!c || !isHttpUrl(c.url) || this.sources.length >= SOURCES_MAX) continue;
      if (this.sources.some((s) => s.url === c.url)) continue;
      const title =
        typeof c.title === "string" && c.title.trim()
          ? c.title.trim().slice(0, 200)
          : new URL(c.url).hostname;
      this.sources.push({ url: c.url, title });
    }
  }
}

const SOURCES_MAX = 10;

function isHttpUrl(v: unknown): v is string {
  if (typeof v !== "string" || v.length > 2000) return false;
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

/** Yield complete raw SSE events from a fetch Response body. */
export async function* readEvents(res: Response): AsyncGenerator<string> {
  if (!res.body) return;
  const splitter = new SseEventSplitter();
  const reader = res.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const ev of splitter.push(value)) yield ev;
    }
    for (const ev of splitter.end()) yield ev;
  } finally {
    reader.releaseLock();
  }
}
