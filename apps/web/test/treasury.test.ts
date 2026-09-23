import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { balancePaths, fmt } = await import("../lib/treasury");

describe("treasury formatting", () => {
  it("formats signed amounts, including zero", () => {
    expect(fmt.signed(1284.4)).toBe("+1,284");
    expect(fmt.signed(-452)).toBe("−452");
    expect(fmt.signed(-0.006)).toBe("0");
    expect(fmt.usd(18420.2)).toBe("$18,420");
    expect(fmt.day("2026-09-22")).toBe("Sep 22");
  });

  it("builds chart paths inside the 400×170 viewBox, skipping days without a balance", () => {
    const days = Array.from({ length: 30 }, (_, i) => ({
      day: `d${i}`,
      inUsd: 0,
      outUsd: 0,
      balanceUsd: i < 5 ? null : 1000 + i * 10,
    }));
    const p = balancePaths(days)!;
    const nums = p.line.match(/-?\d+/g)!.map(Number);
    expect(Math.min(...nums)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...nums)).toBeLessThanOrEqual(400);
    expect(p.line.startsWith("M")).toBe(true);
    expect(p.area.endsWith("Z")).toBe(true);
    expect(balancePaths(days.map((d) => ({ ...d, balanceUsd: null })))).toBeNull();
  });
});
