import type { ServerResponse } from "node:http";

/** Write to a raw response, waiting for 'drain' when needed. Resolves false if the client went away. */
export function writeRaw(raw: ServerResponse, data: string): Promise<boolean> {
  if (raw.destroyed || raw.writableEnded) return Promise.resolve(false);
  if (raw.write(data)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const done = (ok: boolean) => {
      raw.off("drain", onDrain);
      raw.off("close", onClose);
      resolve(ok);
    };
    const onDrain = () => done(true);
    const onClose = () => done(false);
    raw.once("drain", onDrain);
    raw.once("close", onClose);
  });
}

/** Headers for a server-sent-events response that must not be buffered by Nginx or Cloudflare. */
export const SSE_HEADERS = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache, no-transform",
  "x-accel-buffering": "no",
  connection: "keep-alive",
} as const;

/** Flatten Fastify reply headers into a plain object for raw.writeHead. */
export function plainHeaders(h: Record<string, unknown>): Record<string, string | number | string[]> {
  const out: Record<string, string | number | string[]> = {};
  for (const [k, v] of Object.entries(h)) {
    if (v === undefined) continue;
    out[k] = Array.isArray(v) ? v.map(String) : typeof v === "number" ? v : String(v);
  }
  return out;
}
