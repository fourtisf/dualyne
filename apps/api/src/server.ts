import { buildApp } from "./app";
import { loadEnv } from "./env";
import { startScheduler } from "./jobs/scheduler";

async function main() {
  const env = loadEnv();
  const app = await buildApp({ env });
  const stopJobs = env.JOBS_ENABLED ? startScheduler(app) : () => undefined;

  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    app.log.info({ signal }, "shutting down");
    stopJobs();
    try {
      await app.close();
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, "error during shutdown");
      process.exit(1);
    }
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  if (env.NODE_ENV === "production" && env.OPENROUTER_API_KEY && !env.TURNSTILE_SECRET_KEY) {
    app.log.warn(
      "TURNSTILE_SECRET_KEY is empty: free comparisons have no bot check, only the per-IP limit and DAILY_BUDGET_USD",
    );
  }
  await app.listen({ host: env.HOST, port: env.API_PORT });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
