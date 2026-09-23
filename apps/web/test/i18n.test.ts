import { MODEL_DEFS } from "@refract/shared";
import { describe, expect, it } from "vitest";
import { en } from "../lib/i18n/en";
import { id } from "../lib/i18n/id";
import { apiErrorText, formatWait, href, switchPath } from "../lib/i18n";

/** Every key path in a dictionary, with the kind of value found there. */
function shape(o: unknown, path = ""): string[] {
  if (typeof o === "function") return [`${path}:fn`];
  if (Array.isArray(o))
    return [`${path}:array(${o.length})`, ...o.flatMap((v, i) => shape(v, `${path}[${i}]`))];
  if (o && typeof o === "object") {
    return Object.keys(o)
      .sort()
      .flatMap((k) => shape((o as Record<string, unknown>)[k], `${path}.${k}`));
  }
  return [`${path}:${typeof o}`];
}

// Maps that are empty in English by design (the catalog / API supply the English text).
const OPEN_MAPS = [".models.bestFor", ".apiErrors", ".wallet.eligibility"];
const fixed = (keys: string[]) => keys.filter((k) => !OPEN_MAPS.some((m) => k.startsWith(m)));

describe("dictionaries", () => {
  it("Indonesian has exactly the same keys and list lengths as English", () => {
    expect(fixed(shape(id))).toEqual(fixed(shape(en)));
  });

  it("translates every model's 'best for' text", () => {
    for (const m of MODEL_DEFS) expect(id.models.bestFor[m.id], m.id).toBeTruthy();
  });

  it("has no untranslated English left in the Indonesian strings it overrides", () => {
    const strings = (o: unknown): string[] =>
      typeof o === "string" ? [o] : o && typeof o === "object" ? Object.values(o).flatMap(strings) : [];
    const english = new Set(strings(en).filter((s) => s.length > 24));
    const same = strings(id).filter((s) => english.has(s));
    expect(same).toEqual([]);
  });
});

describe("links", () => {
  it("localizes the translated pages and leaves English-only pages alone", () => {
    expect(href("en", "/#faq")).toBe("/#faq");
    expect(href("id", "/#faq")).toBe("/id#faq");
    expect(href("id", "/")).toBe("/id");
    expect(href("id", "/dashboard")).toBe("/id/dashboard");
    expect(href("id", "/docs")).toBe("/docs");
  });

  it("switches to the same page in the other language", () => {
    expect(switchPath("/")).toBe("/id");
    expect(switchPath("/dashboard")).toBe("/id/dashboard");
    expect(switchPath("/docs")).toBe("/id");
    expect(switchPath("/id")).toBe("/");
    expect(switchPath("/id/dashboard")).toBe("/dashboard");
  });
});

describe("helpers", () => {
  it("formats waits in each language", () => {
    expect(formatWait(en, 30)).toBe("30 seconds");
    expect(formatWait(en, 600)).toBe("10 minutes");
    expect(formatWait(id, 600)).toBe("10 menit");
    expect(formatWait(id, 3 * 3600)).toBe("3 jam");
  });

  it("keeps the API's English message in English and translates known codes", () => {
    expect(apiErrorText(en, "key_limit", "Explorer wallets can have 1 key.")).toBe(
      "Explorer wallets can have 1 key.",
    );
    expect(apiErrorText(id, "key_limit", "x")).toMatch(/kunci/);
    expect(apiErrorText(id, "some_new_code", "Server text")).toBe("Server text");
  });
});
