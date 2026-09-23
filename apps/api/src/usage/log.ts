import type { PrismaClient } from "@prisma/client";
import type { FastifyBaseLogger } from "fastify";

export interface UsageRow {
  source: "api" | "compare";
  apiKeyId?: string | null;
  walletId?: string | null;
  walletAddress?: string | null;
  modelId: string;
  openrouterId: string;
  generationId?: string | null;
  inputTokens: number;
  outputTokens: number;
  costMicroUsd: number;
  latencyMs: number;
  ttftMs?: number | null;
  status: number;
  errorCode?: string | null;
  stream: boolean;
  ipHash?: string | null;
  compareId?: string | null;
}

/** Write one usage row. Never throws: logging must not break a response that already succeeded. */
export async function logUsage(prisma: PrismaClient, log: FastifyBaseLogger, row: UsageRow): Promise<void> {
  try {
    await prisma.usageLog.create({
      data: { ...row, costMicroUsd: BigInt(Math.max(0, Math.round(row.costMicroUsd))) },
    });
  } catch (err) {
    log.error({ err, modelId: row.modelId }, "failed to write usage log");
  }
}
