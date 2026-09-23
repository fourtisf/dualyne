import { afterEach, describe, expect, it, vi } from "vitest";
import { CompareError, runCompare } from "../lib/compare-client";

const enc = new TextEncoder();
function sseResponse(chunks: string[], headers: Record<string, string> = {}) {
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream", ...headers } });
}

afterEach(() => vi.unstubAllGlobals());

describe("runCompare", () => {
  it("dispatches multiplexed lane events, even when split mid-event", async () => {
    const stream =
      'event: meta\ndata: {"compareId":"c1","a":"x","b":"y"}\n\n' +
      ": ping\n\n" +
      'event: delta\ndata: {"lane":"a","text":"Hel"}\n\n' +
      'event: delta\ndata: {"lane":"b","text":"Yo ✓"}\n\n' +
      'event: delta\ndata: {"lane":"a","text":"lo"}\n\n' +
      'event: done\ndata: {"lane":"a","ttftMs":1,"totalMs":2,"outputTokens":3,"costUsd":0.001}\n\n' +
      'event: error\ndata: {"lane":"b","code":"upstream_failed"}\n\n' +
      "event: end\ndata: {}\n\n";
    const parts = [stream.slice(0, 37), stream.slice(37, 120), stream.slice(120)];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse(parts, { "x-compare-remaining": "7" })),
    );

    const text = { a: "", b: "" };
    const done: string[] = [];
    const errors: string[] = [];
    let meta = "";
    const r = await runCompare(
      "http://api",
      { prompt: "p", a: "x", b: "y" },
      {
        onMeta: (m) => (meta = m.compareId),
        onDelta: (l, t) => (text[l] += t),
        onDone: (d) => done.push(d.lane),
        onLaneError: (l, c) => errors.push(`${l}:${c}`),
      },
      new AbortController().signal,
    );
    expect(meta).toBe("c1");
    expect(text).toEqual({ a: "Hello", b: "Yo ✓" });
    expect(done).toEqual(["a"]);
    expect(errors).toEqual(["b:upstream_failed"]);
    expect(r.remaining).toBe(7);
  });

  it("marks lanes as failed when the stream ends early", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse(['event: delta\ndata: {"lane":"a","text":"x"}\n\n'])),
    );
    const errors: string[] = [];
    await runCompare(
      "http://api",
      { prompt: "p", a: "x", b: "y" },
      { onDelta: () => {}, onDone: () => {}, onLaneError: (l, c) => errors.push(`${l}:${c}`) },
      new AbortController().signal,
    );
    expect(errors).toEqual(["a:stream_interrupted", "b:stream_interrupted"]);
  });

  it("turns refusals into CompareError with code and Retry-After", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { code: "rate_limited", message: "used up" } }), {
            status: 429,
            headers: { "retry-after": "1200", "x-compare-remaining": "0" },
          }),
      ),
    );
    const err = await runCompare(
      "http://api",
      { prompt: "p", a: "x", b: "y" },
      { onDelta: () => {}, onDone: () => {}, onLaneError: () => {} },
      new AbortController().signal,
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CompareError);
    expect(err).toMatchObject({ code: "rate_limited", retryAfterSeconds: 1200 });
  });
});
