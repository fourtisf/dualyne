export type Clock = () => Date;
export const systemClock: Clock = () => new Date();

/** "2026-09-23" for the UTC day of `d`. */
export const utcDay = (d: Date): string => d.toISOString().slice(0, 10);

/** Start of the UTC day of `d`. */
export const utcDayStart = (d: Date): Date =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/** Whole seconds until the next 00:00 UTC (at least 1). */
export const secondsUntilUtcMidnight = (d: Date): number => {
  const next = utcDayStart(d).getTime() + 86_400_000;
  return Math.max(1, Math.ceil((next - d.getTime()) / 1000));
};
