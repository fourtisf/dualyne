import { describe, expect, it } from "vitest";
import { en } from "../lib/i18n/en";
import { apiErrorText, formatWait, href } from "../lib/i18n";

describe("links", () => {
  it("keeps every path as it is (the site is English only)", () => {
    expect(href("en", "/#faq")).toBe("/#faq");
    expect(href("en", "/models/gpt")).toBe("/models/gpt");
    expect(href("en", "/?a=llama#compare")).toBe("/?a=llama#compare");
  });
});

describe("helpers", () => {
  it("formats waits", () => {
    expect(formatWait(en, 30)).toBe("30 seconds");
    expect(formatWait(en, 600)).toBe("10 minutes");
    expect(formatWait(en, 3 * 3600)).toBe("3 hours");
  });

  it("shows the API's own message for error codes", () => {
    expect(apiErrorText(en, "key_limit", "Explorer wallets can have 1 key.")).toBe(
      "Explorer wallets can have 1 key.",
    );
  });
});
