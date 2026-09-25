import type { PrismaClient } from "@prisma/client";
import { COMPARE_CATEGORIES, type LeaderboardCategory } from "@dualyne/shared";

export const ELO_K = 24;
export const ELO_START = 1000;
const BATCH = 5000;

type Stats = { wins: number; losses: number; ties: number; games: number };

/** Ratings for one set of votes, replayed in order. */
class Table {
  readonly R = new Map<string, number>();
  readonly stats = new Map<string, Stats>();
  counted = 0;

  private get(id: string) {
    if (!this.R.has(id)) this.R.set(id, ELO_START);
    if (!this.stats.has(id)) this.stats.set(id, { wins: 0, losses: 0, ties: 0, games: 0 });
    return this.R.get(id)!;
  }

  add(v: { modelA: string; modelB: string; winner: string }) {
    const ra = this.get(v.modelA);
    const rb = this.get(v.modelB);
    const ea = 1 / (1 + Math.pow(10, (rb - ra) / 400));
    const sa = v.winner === "a" ? 1 : v.winner === "b" ? 0 : 0.5;
    this.R.set(v.modelA, ra + ELO_K * (sa - ea));
    this.R.set(v.modelB, rb + ELO_K * (1 - sa - (1 - ea)));
    const a = this.stats.get(v.modelA)!;
    const b = this.stats.get(v.modelB)!;
    a.games++;
    b.games++;
    if (v.winner === "a") {
      a.wins++;
      b.losses++;
    } else if (v.winner === "b") {
      b.wins++;
      a.losses++;
    } else {
      a.ties++;
      b.ties++;
    }
    this.counted++;
  }

  rows(category: LeaderboardCategory) {
    return [...this.R.entries()].map(([modelId, rating]) => ({
      category,
      modelId,
      rating,
      ...this.stats.get(modelId)!,
    }));
  }
}

/**
 * Nightly: replay every vote in order (K=24, start 1000), once over all votes and once per
 * category. Votes where both lanes were the same model are ignored. With `blindOnly`, only blind
 * runs count (anti-manipulation mode).
 */
export async function recomputeElo(prisma: PrismaClient, opts: { blindOnly: boolean }) {
  const all = new Table();
  const byCategory = new Map(COMPARE_CATEGORIES.map((c) => [c as string, new Table()]));

  let cursor: string | undefined;
  for (;;) {
    const batch = await prisma.vote.findMany({
      where: opts.blindOnly ? { blind: true } : {},
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      select: { id: true, modelA: true, modelB: true, winner: true, category: true },
    });
    if (!batch.length) break;
    for (const v of batch) {
      if (v.modelA === v.modelB) continue;
      all.add(v);
      (byCategory.get(v.category) ?? byCategory.get("general")!).add(v);
    }
    cursor = batch.at(-1)!.id;
    if (batch.length < BATCH) break;
  }

  const rows = [
    ...all.rows("all"),
    ...[...byCategory.entries()].flatMap(([c, table]) => table.rows(c as LeaderboardCategory)),
  ];
  await prisma.$transaction([prisma.eloRating.deleteMany(), prisma.eloRating.createMany({ data: rows })]);
  return { counted: all.counted, models: all.R.size };
}
