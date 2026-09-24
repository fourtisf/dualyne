import type { ChatEvents, ChatMessage } from "@dualyne/shared";

export class ChatError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
  }
}

export interface ChatResult {
  /** Free messages left this hour, from the x-chat-remaining header. */
  remaining: number | null;
  /** False when the model stopped with an error part-way. */
  completed: boolean;
}

/**
 * POST /internal/chat and read the SSE stream. Throws ChatError for refusals (rate limit,
 * budget, not live) and for cancellation (code "cancelled").
 */
export async function runChat(
  apiUrl: string,
  body: { model: string; messages: ChatMessage[]; turnstileToken?: string },
  onDelta: (text: string) => void,
  signal: AbortSignal,
): Promise<ChatResult> {
  let res: Response;
  try {
    res = await fetch(`${apiUrl}/internal/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (signal.aborted) throw new ChatError("cancelled", "Stopped.");
    throw new ChatError("network", err instanceof Error ? err.message : "Network error");
  }
  const remainingHeader = res.headers.get("x-chat-remaining");
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
    throw new ChatError(code, message, Number.isFinite(retry) && retry > 0 ? retry : null);
  }

  let completed = false;
  const dispatch = (block: string) => {
    let event = "message";
    const data: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(line.startsWith("data: ") ? 6 : 5));
    }
    if (!data.length) return;
    const payload = JSON.parse(data.join("\n")) as ChatEvents[keyof ChatEvents];
    if (event === "delta") onDelta((payload as ChatEvents["delta"]).text);
    else if (event === "done") completed = true;
  };

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
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
  } catch {
    if (signal.aborted) throw new ChatError("cancelled", "Stopped.");
  }
  return { remaining, completed };
}

/** Free messages left this hour for this visitor, or null if the API can't be reached. */
export async function getChatQuota(apiUrl: string): Promise<{ limit: number; remaining: number } | null> {
  try {
    const res = await fetch(`${apiUrl}/internal/chat/quota`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const j = (await res.json()) as { limit?: unknown; remaining?: unknown };
    return typeof j.limit === "number" && typeof j.remaining === "number"
      ? { limit: j.limit, remaining: j.remaining }
      : null;
  } catch {
    return null;
  }
}
