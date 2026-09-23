import { Prisma, type PrismaClient } from "@prisma/client";
import type { Address } from "viem";
import type { ChainReader } from "./chain/types";
import type { Clock } from "./lib/time";
import { utcDayStart } from "./lib/time";

const CURSOR = "treasury-inflows";
const CHUNK = 2_000n; // blocks per eth_getLogs call (most RPCs cap the range)
const INITIAL_LOOKBACK = 10_000n;
const DAY_MS = 86_400_000;

export interface TreasuryConfig {
  chain: ChainReader;
  treasury: Address;
  stable: Address;
  confirmations: number;
  startBlock?: number;
}

/** Convert token units to micro-USD for a $1 stablecoin. */
const toMicro = (units: bigint, decimals: number): bigint =>
  decimals >= 6 ? units / 10n ** BigInt(decimals - 6) : units * 10n ** BigInt(6 - decimals);

/**
 * Hourly: record new stablecoin transfers into the treasury (resuming from the last scanned
 * block) and take a balance snapshot. Conversions to stable and OpenRouter top-ups are done by
 * people; this only records what the chain shows.
 */
export async function syncTreasury(prisma: PrismaClient, cfg: TreasuryConfig, now: Clock) {
  const decimals = await cfg.chain.tokenDecimals(cfg.stable);
  const head = (await cfg.chain.blockNumber()) - BigInt(cfg.confirmations);
  const cursor = await prisma.chainCursor.findUnique({ where: { name: CURSOR } });
  let from =
    cursor !== null
      ? cursor.block + 1n
      : cfg.startBlock !== undefined
        ? BigInt(cfg.startBlock)
        : head > INITIAL_LOOKBACK
          ? head - INITIAL_LOOKBACK
          : 0n;

  let inserted = 0;
  const blockTime = new Map<bigint, number>();
  while (from <= head) {
    const to = from + CHUNK - 1n < head ? from + CHUNK - 1n : head;
    const logs = await cfg.chain.erc20TransfersTo(cfg.stable, cfg.treasury, from, to);
    for (const l of logs) {
      if (!blockTime.has(l.blockNumber))
        blockTime.set(l.blockNumber, await cfg.chain.blockTimestamp(l.blockNumber));
    }
    if (logs.length) {
      const r = await prisma.treasuryTransfer.createMany({
        data: logs.map((l) => ({
          id: `${l.txHash}:${l.logIndex}`,
          txHash: l.txHash,
          blockNumber: l.blockNumber,
          timestamp: new Date(blockTime.get(l.blockNumber)! * 1000),
          fromAddress: l.from.toLowerCase(),
          amountMicroUsd: toMicro(l.value, decimals),
        })),
        skipDuplicates: true,
      });
      inserted += r.count;
    }
    await prisma.chainCursor.upsert({
      where: { name: CURSOR },
      update: { block: to },
      create: { name: CURSOR, block: to },
    });
    from = to + 1n;
  }

  const balance = await cfg.chain.tokenBalance(cfg.stable, cfg.treasury);
  await prisma.treasurySnapshot.create({
    data: { takenAt: now(), balanceMicroUsd: toMicro(balance, decimals) },
  });
  return { inserted, scannedTo: head };
}

export interface TreasurySummary {
  configured: true;
  updatedAt: string | null;
  balanceUsd: number | null;
  inflowTodayUsd: number;
  runwayDays: number | null;
  runwayChangeDays: number | null;
  requests7d: number;
  requestsChangePct: number | null;
  /** Last 30 UTC days, oldest first. Balance is carried forward on days without a snapshot. */
  days: { day: string; inUsd: number; outUsd: number; balanceUsd: number | null }[];
}

const usd = (micro: bigint | number | null | undefined) => Number(micro ?? 0) / 1_000_000;
const dayKey = (d: Date) => d.toISOString().slice(0, 10);

/** Everything the Treasury section shows, from recorded transfers, snapshots and the usage log. */
export async function treasurySummary(prisma: PrismaClient, now: Date): Promise<TreasurySummary> {
  const today = utcDayStart(now);
  const start = new Date(today.getTime() - 29 * DAY_MS);
  const prevWeekStart = new Date(today.getTime() - 13 * DAY_MS);

  const [inflows, outflows, snapshots, before, req7, reqPrev] = await Promise.all([
    prisma.$queryRaw<{ day: Date; micro: bigint }[]>(
      Prisma.sql`SELECT date_trunc('day', "timestamp") AS day, sum("amountMicroUsd") AS micro
                 FROM "TreasuryTransfer" WHERE "timestamp" >= ${start} GROUP BY 1`,
    ),
    // Outflow = inference paid by the treasury (free tiers). Builder requests are paid from credits.
    prisma.$queryRaw<{ day: Date; micro: bigint }[]>(
      Prisma.sql`SELECT date_trunc('day', "createdAt") AS day, sum("costMicroUsd") AS micro
                 FROM "UsageLog" WHERE "createdAt" >= ${start} AND "chargedMicroUsd" = 0 GROUP BY 1`,
    ),
    prisma.treasurySnapshot.findMany({ where: { takenAt: { gte: start } }, orderBy: { takenAt: "asc" } }),
    prisma.treasurySnapshot.findFirst({ where: { takenAt: { lt: start } }, orderBy: { takenAt: "desc" } }),
    prisma.usageLog.count({ where: { createdAt: { gte: new Date(today.getTime() - 6 * DAY_MS) } } }),
    prisma.usageLog.count({
      where: { createdAt: { gte: prevWeekStart, lt: new Date(today.getTime() - 6 * DAY_MS) } },
    }),
  ]);

  const inBy = new Map(inflows.map((r) => [dayKey(r.day), usd(r.micro)]));
  const outBy = new Map(outflows.map((r) => [dayKey(r.day), usd(r.micro)]));
  const snapBy = new Map<string, number>();
  for (const s of snapshots) snapBy.set(dayKey(s.takenAt), usd(s.balanceMicroUsd)); // last one per day wins

  let carry: number | null = before ? usd(before.balanceMicroUsd) : null;
  const days = Array.from({ length: 30 }, (_, i) => {
    const key = dayKey(new Date(start.getTime() + i * DAY_MS));
    if (snapBy.has(key)) carry = snapBy.get(key)!;
    return { day: key, inUsd: inBy.get(key) ?? 0, outUsd: outBy.get(key) ?? 0, balanceUsd: carry };
  });

  const latest = snapshots.at(-1) ?? before;
  const balanceUsd = latest ? usd(latest.balanceMicroUsd) : null;
  // Runway = balance ÷ average daily treasury spend over the 7 complete days before `endIdx`.
  const runway = (balance: number | null, endIdx: number): number | null => {
    const window = days.slice(Math.max(0, endIdx - 7), endIdx);
    const avg = window.reduce((a, d) => a + d.outUsd, 0) / (window.length || 1);
    return balance !== null && avg > 0 ? balance / avg : null;
  };
  const runwayDays = runway(balanceUsd, 29);
  const runwayWeekAgo = runway(days[22]?.balanceUsd ?? null, 22);

  return {
    configured: true,
    updatedAt: latest ? latest.takenAt.toISOString() : null,
    balanceUsd,
    inflowTodayUsd: days[29]!.inUsd,
    runwayDays: runwayDays === null ? null : Math.floor(runwayDays),
    runwayChangeDays:
      runwayDays !== null && runwayWeekAgo !== null ? Math.round(runwayDays - runwayWeekAgo) : null,
    requests7d: req7,
    requestsChangePct: reqPrev > 0 ? Math.round(((req7 - reqPrev) / reqPrev) * 100) : null,
    days,
  };
}
