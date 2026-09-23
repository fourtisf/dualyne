import type { PrismaClient } from "@prisma/client";

export const ELO_K = 24;
export const ELO_START = 1000;
const BATCH = 5000;

/**
 * Nightly: replay every vote in order (K=24, start 1000). Votes where both lanes were the same
 * model are ignored. With `blindOnly`, only blind runs count (anti-manipulation mode).
 */
export async function recomputeElo(prisma: PrismaClient, opts: { blindOnly: boolean }) {
  const R = new Map<string, number>();
  const stats = new Map<string, { wins: number; losses: number; ties: number; games: number }>();
  const get = (id: string) => {
    if (!R.has(id)) R.set(id, ELO_START);
    if (!stats.has(id)) stats.set(id, { wins: 0, losses: 0, ties: 0, games: 0 });
    return R.get(id)!;
  };

  let counted = 0;
  let cursor: string | undefined;
  for (;;) {
    const batch = await prisma.vote.findMany({
      where: opts.blindOnly ? { blind: true } : {},
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      select: { id: true, modelA: true, modelB: true, winner: true },
    });
    if (!batch.length) break;
    for (const v of batch) {
      if (v.modelA === v.modelB) continue;
      const ra = get(v.modelA);
      const rb = get(v.modelB);
      const ea = 1 / (1 + Math.pow(10, (rb - ra) / 400));
      const sa = v.winner === "a" ? 1 : v.winner === "b" ? 0 : 0.5;
      R.set(v.modelA, ra + ELO_K * (sa - ea));
      R.set(v.modelB, rb + ELO_K * (1 - sa - (1 - ea)));
      const a = stats.get(v.modelA)!;
      const b = stats.get(v.modelB)!;
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
      counted++;
    }
    cursor = batch.at(-1)!.id;
    if (batch.length < BATCH) break;
  }

  const rows = [...R.entries()].map(([modelId, rating]) => ({ modelId, rating, ...stats.get(modelId)! }));
  await prisma.$transaction([prisma.eloRating.deleteMany(), prisma.eloRating.createMany({ data: rows })]);
  return { counted, models: rows.length };
}
