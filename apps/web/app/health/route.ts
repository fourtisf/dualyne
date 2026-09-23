export const dynamic = "force-dynamic";

/** Liveness check for Docker and the deploy script. */
export function GET() {
  return Response.json({ status: "ok" }, { headers: { "cache-control": "no-store" } });
}
