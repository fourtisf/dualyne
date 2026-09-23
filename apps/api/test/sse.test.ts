import { describe, expect, it } from "vitest";
import { eventData, SseEventSplitter, StreamInspector } from "../src/openrouter/sse";

const enc = new TextEncoder();

describe("SseEventSplitter", () => {
  it("reassembles events split across arbitrary chunk boundaries, including inside UTF-8", () => {
    const text = 'data: {"a":"✓ ok"}\n\n: comment\n\ndata: [DONE]\n\n';
    const bytes = enc.encode(text);
    const s = new SseEventSplitter();
    const out: string[] = [];
    for (let i = 0; i < bytes.length; i += 3) out.push(...s.push(bytes.subarray(i, i + 3)));
    out.push(...s.end());
    expect(out).toEqual(['data: {"a":"✓ ok"}\n\n', ": comment\n\n", "data: [DONE]\n\n"]);
    expect(out.join("")).toBe(text);
  });

  it("flushes a trailing partial event at end of stream", () => {
    const s = new SseEventSplitter();
    expect(s.push(enc.encode("data: x"))).toEqual([]);
    expect(s.end()).toEqual(["data: x"]);
  });
});

describe("StreamInspector", () => {
  it("drops only a usage-only chunk the client did not request", () => {
    const i = new StreamInspector();
    const usageOnly = 'data: {"choices":[],"usage":{"prompt_tokens":1,"completion_tokens":2,"cost":0.5}}\n\n';
    expect(i.inspect(usageOnly, false)).toBe("drop");
    expect(i.inspect(usageOnly, true)).toBe("keep");
    expect(i.usage).toEqual({ promptTokens: 1, completionTokens: 2, costUsd: 0.5 });
    const withContent = 'data: {"choices":[{"delta":{"content":"x"}}],"usage":{"prompt_tokens":1}}\n\n';
    expect(i.inspect(withContent, false)).toBe("keep");
  });

  it("records the first output time and error chunks", () => {
    let now = 100;
    const i = new StreamInspector(() => now);
    i.inspect('data: {"choices":[{"delta":{"role":"assistant","content":""}}]}\n\n', false);
    expect(i.firstTokenAt).toBeNull();
    now = 250;
    i.inspect('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n', false);
    expect(i.firstTokenAt).toBe(250);
    i.inspect('data: {"error":{"code":"server_error"}}\n\n', false);
    expect(i.errorCode).toBe("server_error");
  });

  it("joins multi-line data fields", () => {
    expect(eventData("event: x\ndata: a\ndata: b\n\n")).toBe("a\nb");
    expect(eventData(": only a comment\n\n")).toBeNull();
  });
});
