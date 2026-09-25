import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createTestContext,
  DONE_EVENT,
  parseSse,
  SAMPLE_STREAM,
  USAGE_EVENT,
  type TestContext,
} from "./helpers";

let t: TestContext;
beforeEach(async () => {
  t ??= await createTestContext({ WEB_SEARCH_FREE_PER_DAY: "1", WEB_SEARCH_RESULTS: "3" });
  await t.reset();
  t.upstream.mode = "stream";
  t.upstream.streamBody = SAMPLE_STREAM + USAGE_EVENT + DONE_EVENT;
});
afterAll(async () => t?.close());

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const PDF =
  "data:application/pdf;base64,JVBERi0xLjQKJcfsj6IKMSAwIG9iago8PD4+CmVuZG9iagp0cmFpbGVyCjw8Pj4KJSVFT0YK";
const send = (payload: Record<string, unknown>) =>
  t.app.inject({
    method: "POST",
    url: "/internal/chat",
    payload: { turnstileToken: "good-chat", ...payload },
  });
const ask = (attachments: unknown[], model = "claude-swift", content = "What is this?") =>
  send({ model, messages: [{ role: "user", content, attachments }] });

describe("chat attachments", () => {
  it("sends an image to a vision model as an image part", async () => {
    const res = await ask([{ kind: "image", name: "dot.png", data: PNG }]);
    expect(res.statusCode).toBe(200);
    const body = t.upstream.requests[0]!.body as { messages: { content: unknown }[]; plugins?: unknown };
    expect(body.messages[0]!.content).toEqual([
      { type: "text", text: "What is this?" },
      { type: "image_url", image_url: { url: PNG } },
    ]);
    expect(body.plugins).toBeUndefined();
  });

  it("refuses images for models that can't see them", async () => {
    const res = await ask([{ kind: "image", name: "dot.png", data: PNG }], "llama");
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("model_no_vision");
    expect(t.upstream.requests).toHaveLength(0);
  });

  it("reads PDFs with the file parser, on any model", async () => {
    const res = await ask([{ kind: "pdf", name: "report.pdf", data: PDF }], "llama", "");
    expect(res.statusCode).toBe(200);
    const body = t.upstream.requests[0]!.body as { messages: { content: unknown }[]; plugins: unknown };
    expect(body.messages[0]!.content).toEqual([
      { type: "text", text: "(see the attached file)" },
      { type: "file", file: { filename: "report.pdf", file_data: PDF } },
    ]);
    expect(body.plugins).toEqual([{ id: "file-parser", pdf: { engine: "pdf-text" } }]);
  });

  it("adds text files to the message text", async () => {
    await ask([{ kind: "text", name: "notes.md", text: "# Plan\nShip it" }], "llama", "Summarize");
    const body = t.upstream.requests[0]!.body as { messages: { content: unknown }[] };
    expect(body.messages[0]!.content).toBe('Summarize\n\n<file name="notes.md">\n# Plan\nShip it\n</file>');
  });

  it("rejects wrong file types and files on answers", async () => {
    expect(
      (await ask([{ kind: "image", name: "x.svg", data: "data:image/svg+xml;base64,AAAA" }])).statusCode,
    ).toBe(400);
    expect((await ask([{ kind: "exe", name: "x.exe", data: "MZ" }])).statusCode).toBe(400);
    const res = await send({
      model: "llama",
      messages: [
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Hello", attachments: [{ kind: "text", name: "a.txt", text: "x" }] },
        { role: "user", content: "Again" },
      ],
    });
    expect(res.statusCode).toBe(400);
    expect(t.upstream.requests).toHaveLength(0);
  });

  it("sends custom instructions as the system message", async () => {
    await send({
      model: "llama",
      instructions: "Answer in Indonesian.",
      messages: [{ role: "user", content: "Hi" }],
    });
    const body = t.upstream.requests[0]!.body as { messages: { role: string; content: string }[] };
    expect(body.messages[0]!.role).toBe("system");
    expect(body.messages[0]!.content).toContain("Answer in Indonesian.");
    expect(body.messages[1]).toEqual({ role: "user", content: "Hi" });
  });
});

describe("web search", () => {
  const annotated =
    'data: {"id":"gen-1","choices":[{"index":0,"delta":{"content":"Rain today [1]."}}]}\n\n' +
    'data: {"id":"gen-1","choices":[{"index":0,"delta":{"annotations":[' +
    '{"type":"url_citation","url_citation":{"url":"https://weather.example/today","title":"Weather today"}},' +
    '{"type":"url_citation","url_citation":{"url":"https://weather.example/today","title":"Again"}},' +
    '{"type":"url_citation","url_citation":{"url":"javascript:alert(1)","title":"Bad"}}]},"finish_reason":"stop"}]}\n\n';

  it("adds the web plugin, streams the sources and has its own daily limit", async () => {
    t.upstream.streamBody = annotated + USAGE_EVENT + DONE_EVENT;
    const payload = { model: "llama", webSearch: true, messages: [{ role: "user", content: "Weather?" }] };
    const res = await send(payload);
    expect(res.statusCode).toBe(200);
    expect(t.upstream.requests[0]!.body.plugins).toEqual([{ id: "web", max_results: 3 }]);
    const sources = parseSse(res.body).find((e) => e.event === "sources");
    expect(JSON.parse(sources!.data)).toEqual({
      sources: [{ url: "https://weather.example/today", title: "Weather today" }],
    });

    const quota = (await t.app.inject({ method: "GET", url: "/internal/chat/quota" })).json();
    expect(quota).toMatchObject({ webLimit: 1, webRemaining: 0 });
    const second = await send(payload);
    expect(second.statusCode).toBe(429);
    expect(second.json().error.code).toBe("web_search_limit");
    // Without web search the free messages still work.
    expect((await send({ ...payload, webSearch: false })).statusCode).toBe(200);
  });
});
