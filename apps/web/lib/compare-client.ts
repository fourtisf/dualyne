import type { CompareEvents, Lane } from "@refract/shared";

export class CompareError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
  }
}

export interface CompareHandlers {
  onMeta?(m: CompareEvents["meta"]): void;
  onDelta(lane: Lane, text: string): void;
  onDone(d: CompareEvents["done"]): void;
  onLaneError(lane: Lane, code: string): void;
}

export interface CompareResult {
  /** Free comparisons left this hour, from the x-compare-remaining header. */
  remaining: number | null;
}

/**
 * POST /internal/compare and read the multiplexed SSE stream. Throws CompareError for
 * refusals (rate limit, budget, Turnstile) and for cancellation (code "cancelled").
 */
export async function runCompare(
  apiUrl: string,
  body: { prompt: string; a: string; b: string; turnstileToken?: string },
  handlers: CompareHandlers,
  signal: AbortSignal,
): Promise<CompareResult> {
  let res: Response;
  try {
    res = await fetch(`${apiUrl}/internal/compare`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (signal.aborted) throw new CompareError("cancelled", "Stopped.");
    throw new CompareError("network", err instanceof Error ? err.message : "Network error");
  }
  const remainingHeader = res.headers.get("x-compare-remaining");
  const remaining = remainingHeader === null ? null : Number(remainingHeader);

  if (!res.ok) {
    let code = "http_" + res.status;
    let message = "";
    try {
      const j = (await res.json()) as { error?: { code?: string; message?: string } };
      code = j.error?.code ?? code;
      message = j.error?.message ?? "";
    } catch {
      /* not JSON */
    }
    const retry = Number(res.headers.get("retry-after"));
    throw new CompareError(code, message, Number.isFinite(retry) && retry > 0 ? retry : null);
  }

  const finished = new Set<Lane>();
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const dispatch = (block: string) => {
    let event = "message";
    const data: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(line.startsWith("data: ") ? 6 : 5));
    }
    if (!data.length) return;
    const payload = JSON.parse(data.join("\n"));
    if (event === "meta") handlers.onMeta?.(payload);
    else if (event === "delta") handlers.onDelta(payload.lane, payload.text);
    else if (event === "done") {
      finished.add(payload.lane);
      handlers.onDone(payload);
    } else if (event === "error") {
      finished.add(payload.lane);
      handlers.onLaneError(payload.lane, payload.code);
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let m: RegExpExecArray | null;
      while ((m = /\r?\n\r?\n/.exec(buf))) {
        const block = buf.slice(0, m.index);
        buf = buf.slice(m.index + m[0].length);
        if (block.trim()) dispatch(block);
      }
    }
  } catch (err) {
    if (signal.aborted) throw new CompareError("cancelled", "Stopped.");
    for (const lane of ["a", "b"] as const)
      if (!finished.has(lane)) handlers.onLaneError(lane, "stream_interrupted");
    return { remaining };
  }
  for (const lane of ["a", "b"] as const)
    if (!finished.has(lane)) handlers.onLaneError(lane, "stream_interrupted");
  return { remaining };
}
