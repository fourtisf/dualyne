import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  chat,
  createKey,
  createTestContext,
  DONE_EVENT,
  hello,
  SAMPLE_STREAM,
  USAGE_EVENT,
  type TestContext,
} from "./helpers";

let t: TestContext;
beforeEach(async () => {
  if (!t) t = await createTestContext();
  await t.reset();
  t.upstream.mode = "stream";
  t.upstream.streamBody = SAMPLE_STREAM + USAGE_EVENT + DONE_EVENT;
});
afterAll(async () => t?.close());

describe("SSE streaming pass-through", () => {
  it("streams OpenRouter's events back byte-for-byte (minus the usage chunk nobody asked for)", async () => {
    const { key } = await createKey(t.prisma, "explorer");
    const res = await chat(t.app, key, hello("claude-swift", { stream: true }));
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/event-stream; charset=utf-8");
    expect(res.headers["cache-control"]).toBe("no-cache, no-transform");
    expect(res.headers["x-accel-buffering"]).toBe("no");
    expect(res.headers["x-dualyne-remaining"]).toBe("19");
    expect(res.body).toBe(SAMPLE_STREAM + DONE_EVENT);
  });

  it("keeps the usage chunk when the client asks for stream_options.include_usage", async () => {
    const { key } = await createKey(t.prisma, "explorer");
    const res = await chat(
      t.app,
      key,
      hello("claude-swift", { stream: true, stream_options: { include_usage: true } }),
    );
    expect(res.body).toBe(SAMPLE_STREAM + USAGE_EVENT + DONE_EVENT);
  });

  it("passes CRLF-delimited events through unchanged", async () => {
    t.upstream.streamBody = (SAMPLE_STREAM + DONE_EVENT).replace(/\n/g, "\r\n");
    const { key } = await createKey(t.prisma, "explorer");
    const res = await chat(t.app, key, hello("claude-swift", { stream: true }));
    expect(res.body).toBe(t.upstream.streamBody);
  });

  it("logs tokens, cost, latency, TTFT, model and wallet for the request", async () => {
    const { key, keyId, address } = await createKey(t.prisma, "explorer");
    await chat(t.app, key, hello("claude-swift", { stream: true }));
    await Promise.all([...t.app.ctx.inflight]); // the log is written after the stream closes
    const log = await t.prisma.usageLog.findFirstOrThrow();
    expect(log).toMatchObject({
      source: "api",
      apiKeyId: keyId,
      walletAddress: address,
      modelId: "claude-swift",
      openrouterId: "anthropic/claude-haiku-4.5",
      generationId: "gen-1",
      inputTokens: 7,
      outputTokens: 3,
      costMicroUsd: 1230n,
      status: 200,
      stream: true,
      errorCode: null,
    });
    expect(log.latencyMs).toBeGreaterThanOrEqual(0);
    expect(log.ttftMs).not.toBeNull();
  });

  it("maps the model id, clamps max_tokens to the tier and strips routing overrides", async () => {
    const { key } = await createKey(t.prisma, "explorer");
    await chat(
      t.app,
      key,
      hello("claude-swift", {
        stream: true,
        max_tokens: 50_000,
        models: ["openai/gpt-5"],
        plugins: [{ id: "web" }],
        temperature: 0.2,
        tools: [{ type: "function", function: { name: "f", parameters: {} } }],
      }),
    );
    const sent = t.upstream.requests.at(-1)!.body;
    expect(sent.model).toBe("anthropic/claude-haiku-4.5");
    expect(sent.max_tokens).toBe(1000);
    expect(sent.models).toBeUndefined();
    expect(sent.plugins).toBeUndefined();
    expect(sent.temperature).toBe(0.2);
    expect(sent.tools).toHaveLength(1);
    expect(sent.usage).toEqual({ include: true });
  });

  it("returns non-streaming JSON unchanged", async () => {
    t.upstream.mode = "json";
    const { key } = await createKey(t.prisma, "explorer");
    const res = await chat(t.app, key, hello("claude-swift"));
    expect(res.statusCode).toBe(200);
    expect(res.json().choices[0].message.content).toBe("Hello");
    expect(res.json().model).toBe("anthropic/claude-haiku-4.5");
  });

  it("maps a provider failure to 502 in OpenAI error shape", async () => {
    t.upstream.mode = "error";
    t.upstream.errorStatus = 500;
    const { key } = await createKey(t.prisma, "explorer");
    const res = await chat(t.app, key, hello("claude-swift", { stream: true }));
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({
      error: {
        message: "The model provider failed. Retry once, or switch models.",
        type: "api_error",
        code: "upstream_error",
      },
    });
  });

  it("passes a provider 400 back as 400 with the provider's message", async () => {
    t.upstream.mode = "error";
    t.upstream.errorStatus = 400;
    const { key } = await createKey(t.prisma, "explorer");
    const res = await chat(t.app, key, hello("claude-swift"));
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toBe("upstream says no");
  });

  it("validates the body with zod", async () => {
    const { key } = await createKey(t.prisma, "explorer");
    const bad = await chat(t.app, key, { model: "claude-swift", messages: [] });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe("invalid_request");
    const n = await chat(t.app, key, hello("claude-swift", { n: 3 }));
    expect(n.statusCode).toBe(400);
  });

  it("cancels the upstream request when the client disconnects", async () => {
    t.upstream.mode = "hang";
    const { key } = await createKey(t.prisma, "explorer");
    const address = await t.app.listen({ port: 0, host: "127.0.0.1" });
    const ac = new AbortController();
    const res = await fetch(`${address}/v1/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify(hello("claude-swift", { stream: true })),
      signal: ac.signal,
    });
    const reader = res.body!.getReader();
    await reader.read(); // first bytes arrived
    ac.abort();
    await expect.poll(() => t.upstream.aborted, { timeout: 5000 }).toBe(1);
    await expect
      .poll(async () => (await t.prisma.usageLog.findFirst())?.errorCode, { timeout: 5000 })
      .toBe("cancelled");
  });
});
