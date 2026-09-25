import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { parseSuggestions } from "../src/routes/chatSuggest";
import { createTestContext, parseSse, type TestContext } from "./helpers";

let t: TestContext;
beforeEach(async () => {
  t ??= await createTestContext({ CHAT_SUGGEST_MODEL: "mistral" });
  await t.reset();
  t.upstream.mode = "stream";
});
afterAll(async () => t?.close());

/** Ask one question in Chat and return the streamed answer. */
async function answer(question: string): Promise<string> {
  const res = await t.app.inject({
    method: "POST",
    url: "/internal/chat",
    payload: { model: "llama", messages: [{ role: "user", content: question }], turnstileToken: "good-chat" },
  });
  return parseSse(res.body)
    .filter((e) => e.event === "delta")
    .map((e) => JSON.parse(e.data).text)
    .join("");
}
const suggest = (payload: Record<string, unknown>) =>
  t.app.inject({ method: "POST", url: "/internal/chat/suggest", payload });

describe("follow-up suggestions", () => {
  it("suggests 3 questions for an answer written here, with a small model, cached", async () => {
    const text = await answer("What is Bitcoin?");
    t.upstream.mode = "json";
    t.upstream.jsonContent =
      'Sure:\n["How does Bitcoin mining work?", "Is Bitcoin a good investment?", "What is a Bitcoin wallet?"]';
    const res = await suggest({ question: "What is Bitcoin?", answer: text });
    expect(res.statusCode).toBe(200);
    expect(res.json().questions).toEqual([
      "How does Bitcoin mining work?",
      "Is Bitcoin a good investment?",
      "What is a Bitcoin wallet?",
    ]);
    const call = t.upstream.requests.at(-1)!.body as { model: string; max_tokens: number };
    expect(call.model).toBe("mistralai/mistral-small-3.2-24b-instruct");
    expect(call.max_tokens).toBeLessThanOrEqual(160);

    const calls = t.upstream.requests.length;
    expect((await suggest({ question: "What is Bitcoin?", answer: text })).json().questions).toHaveLength(3);
    expect(t.upstream.requests).toHaveLength(calls);
    // Doesn't use a free message.
    const quota = (await t.app.inject({ method: "GET", url: "/internal/chat/quota" })).json();
    expect(quota.remaining).toBe(quota.limit - 1);
  });

  it("refuses answers that weren't written here", async () => {
    const res = await suggest({ question: "Hi", answer: "Some text I made up" });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("answer_not_verified");
    expect(t.upstream.requests).toHaveLength(0);
  });

  it("returns no suggestions when the model fails", async () => {
    const text = await answer("Hi");
    t.upstream.mode = "error";
    const res = await suggest({ question: "Hi", answer: text });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ questions: [] });
  });
});

describe("parseSuggestions", () => {
  it("reads JSON or numbered lines and cleans them", () => {
    expect(parseSuggestions('["A good question?", "A good question?", "Another one here?"]')).toEqual([
      "A good question?",
      "Another one here?",
    ]);
    expect(
      parseSuggestions("1. Apa itu blockchain?\n2) Bagaimana cara membeli Bitcoin?\n- Kenapa harganya naik?"),
    ).toEqual(["Apa itu blockchain?", "Bagaimana cara membeli Bitcoin?", "Kenapa harganya naik?"]);
  });
});
