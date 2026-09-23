import type { Wallet } from "@prisma/client";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AppContext } from "../context";
import { webOrigins } from "../env";
import { ApiError } from "../lib/errors";
import { SESSION_COOKIE, SESSION_TTL_MS } from "./sessions";

/** The signed-in wallet for this request, or a 401. */
export async function requireWallet(ctx: AppContext, req: FastifyRequest): Promise<Wallet> {
  const wallet = await ctx.sessions.get(req.cookies[SESSION_COOKIE]);
  if (!wallet) throw new ApiError(401, "not_signed_in", "Sign in with your wallet first.");
  return wallet;
}

/**
 * CSRF guard for cookie-authenticated writes: the browser's Origin header must be our website.
 * (SameSite=Lax cookies already stop most cross-site requests; this closes the rest.)
 */
export function requireOwnOrigin(ctx: AppContext, req: FastifyRequest): void {
  const origin = req.headers.origin;
  if (!origin || !webOrigins(ctx.env).includes(origin)) {
    throw new ApiError(403, "bad_origin", "This request must come from the website.");
  }
}

export function setSessionCookie(ctx: AppContext, reply: FastifyReply, token: string): void {
  reply.setCookie(SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: ctx.env.NODE_ENV === "production",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

export function clearSessionCookie(ctx: AppContext, reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: ctx.env.NODE_ENV === "production",
  });
}
