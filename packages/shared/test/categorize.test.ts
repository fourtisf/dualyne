import { describe, expect, it } from "vitest";
import { categorize } from "../src/compare";

describe("categorize", () => {
  it.each([
    ["Why does my Python loop never end?", "coding"],
    ["Fix this bug:\n```js\nconst a = [1,2\n```", "coding"],
    ["Write a short, friendly email to my landlord about the heating", "writing"],
    ["Summarize the pros and cons of remote work", "writing"],
    ["If a train leaves at 3pm going 60 km/h, how many km by 5pm?", "reasoning"],
    ["What is 17 * 23?", "reasoning"],
    ["Jelaskan apa itu inflasi dengan bahasa yang mudah", "multilingual"],
    ["¿Qué es la fotosíntesis y por qué es importante?", "multilingual"],
    ["東京でおすすめのラーメン屋は？", "multilingual"],
    ["Tell me a fun fact about octopuses", "general"],
  ])("%s → %s", (prompt, want) => {
    expect(categorize(prompt)).toBe(want);
  });
});
