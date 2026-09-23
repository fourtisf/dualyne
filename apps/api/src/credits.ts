import { Prisma, type PrismaClient } from "@prisma/client";

/**
 * Prepaid Builder credit, in micro-USD. Requests reserve their worst-case charge up front with an
 * atomic conditional decrement, then settle to the real charge (model cost × markup).
 */
export class Credits {
  constructor(
    private readonly prisma: PrismaClient,
    readonly markup: number,
    readonly enabled: boolean,
  ) {}

  async balance(walletId: string): Promise<bigint> {
    const acc = await this.prisma.creditAccount.findUnique({ where: { walletId } });
    return acc?.balanceMicroUsd ?? 0n;
  }

  /** Model cost → what the Builder pays. */
  charge(costMicro: number): number {
    return Math.ceil(costMicro * this.markup);
  }

  /** Take `micro` from the balance only if it is all there. */
  async reserve(walletId: string, micro: number): Promise<boolean> {
    const n = await this.prisma.$executeRaw(
      Prisma.sql`UPDATE "CreditAccount"
                 SET "balanceMicroUsd" = "balanceMicroUsd" - ${BigInt(micro)}, "updatedAt" = now()
                 WHERE "walletId" = ${walletId} AND "balanceMicroUsd" >= ${BigInt(micro)}`,
    );
    return n === 1;
  }

  /** Return the unused part of a reservation (or take the extra if the real charge was higher). */
  async settle(walletId: string, reservedMicro: number, actualMicro: number): Promise<void> {
    const delta = BigInt(reservedMicro - actualMicro);
    if (delta === 0n) return;
    await this.prisma.$executeRaw(
      Prisma.sql`UPDATE "CreditAccount"
                 SET "balanceMicroUsd" = "balanceMicroUsd" + ${delta}, "updatedAt" = now()
                 WHERE "walletId" = ${walletId}`,
    );
  }

  async add(tx: Prisma.TransactionClient, walletId: string, micro: bigint): Promise<bigint> {
    const acc = await tx.creditAccount.upsert({
      where: { walletId },
      update: { balanceMicroUsd: { increment: micro } },
      create: { walletId, balanceMicroUsd: micro },
    });
    return acc.balanceMicroUsd;
  }
}
