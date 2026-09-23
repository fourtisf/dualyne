import { describe, expect, it } from "vitest";
import { compareRequestSchema, MODEL_DEFS, STATIC_CATALOG, TIER_DEFAULTS, tierAllows } from "../src";

describe("tiers", () => {
  it("ranks explorer < holder < builder", () => {
    expect(tierAllows("explorer", "explorer")).toBe(true);
    expect(tierAllows("explorer", "holder")).toBe(false);
    expect(tierAllows("holder", "explorer")).toBe(true);
    expect(tierAllows("builder", "holder")).toBe(true);
  });

  it("matches the published launch limits", () => {
    expect(TIER_DEFAULTS.explorer).toMatchObject({ dailyRequests: 20, maxKeys: 1, free: true });
    expect(TIER_DEFAULTS.holder).toMatchObject({ dailyRequests: 250, maxKeys: 5, free: true });
    expect(TIER_DEFAULTS.builder).toMatchObject({ dailyRequests: null, maxKeys: null, free: false });
  });
});

describe("model catalog", () => {
  it("has unique ids and valid prices", () => {
    expect(new Set(MODEL_DEFS.map((m) => m.id)).size).toBe(MODEL_DEFS.length);
    for (const m of MODEL_DEFS) {
      expect(Number(m.promptPrice)).toBeGreaterThan(0);
      expect(Number(m.completionPrice)).toBeGreaterThan(0);
      expect(m.openrouterId.startsWith(m.openrouterFamily)).toBe(true);
    }
    expect(STATIC_CATALOG).toHaveLength(MODEL_DEFS.length);
  });

  it("has at least two free models so Compare always has a pair", () => {
    expect(MODEL_DEFS.filter((m) => m.minTier === "explorer").length).toBeGreaterThanOrEqual(2);
  });
});

describe("compareRequestSchema", () => {
  it("accepts a normal request and rejects extra fields", () => {
    expect(compareRequestSchema.safeParse({ prompt: " hi ", a: "llama", b: "mistral" }).success).toBe(true);
    expect(compareRequestSchema.safeParse({ prompt: "hi", a: "llama", b: "mistral", x: 1 }).success).toBe(
      false,
    );
    expect(compareRequestSchema.safeParse({ prompt: "   ", a: "llama", b: "mistral" }).success).toBe(false);
  });
});
