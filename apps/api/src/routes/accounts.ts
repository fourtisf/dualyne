import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { Prisma, type Wallet } from "@prisma/client";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { brand } from "@dualyne/config";
import type { AuthMethods, ReferralResponse } from "@dualyne/shared";
import { requireOwnOrigin, requireWallet, setSessionCookie } from "../auth/request";
import { SESSION_COOKIE } from "../auth/sessions";
import { webOrigins } from "../env";
import { ApiError } from "../lib/errors";
import { sha256Hex } from "../lib/hash";
import { ensureReferralCode, referrerFor } from "../referrals";
import { buildMe } from "./me";

const CODE_TTL_SECONDS = 600;
const CODE_ATTEMPTS = 5;
/** Codes one address can be sent per hour. */
const CODES_PER_HOUR = 5;
const GOOGLE_STATE_COOKIE = "dly_gstate";
const GOOGLE_STATE_TTL_SECONDS = 600;

const email = z.string().trim().toLowerCase().max(254).email("Enter a valid email address");
const ref = z.string().trim().max(20).optional();
const startBody = z.object({ email, ref }).strict();
const verifyBody = z
  .object({
    email,
    code: z
      .string()
      .trim()
      .regex(/^\d{6}$/, "The code has 6 digits"),
    ref,
  })
  .strict();
const googleStartQuery = z.object({
  ref: z.string().max(20).optional(),
  return: z.string().max(200).optional(),
});
const googleCallbackQuery = z.object({
  code: z.string().max(2000).optional(),
  state: z.string().max(200).optional(),
  error: z.string().max(200).optional(),
});

const codeKey = (address: string) => `emailcode:${sha256Hex(address)}`;
const codeHash = (address: string, code: string) => sha256Hex(`${address}\n${code}`);
/** A same-site path to return to after Google sign-in. */
const safeReturn = (p: string | undefined) => (p && /^\/(?!\/)[\w\-./?=&%#]*$/.test(p) ? p : "/chat");

/**
 * Accounts beyond wallets: sign in with a code sent by email, or with Google. An email or Google
 * account can link a wallet later (see /auth/verify), and a signed-in account can add the other
 * method. Also the referral link.
 */
export const accountRoutes: FastifyPluginAsync = async (app) => {
  const { ctx } = app;
  const { env } = ctx;
  const googleOn = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
  const apiUrl = (env.API_PUBLIC_URL || `https://api.${env.SITE_DOMAIN}`).replace(/\/$/, "");
  const site = webOrigins(env)[0]!;

  app.get("/auth/methods", async (_req, reply) => {
    reply.header("cache-control", "public, max-age=60");
    const body: AuthMethods = { wallet: true, email: ctx.mailer !== null, google: googleOn };
    return body;
  });

  /** Sign in (or create the account) and set the session cookie. */
  const signIn = async (reply: FastifyReply, wallet: Wallet) => {
    const { token } = await ctx.sessions.create(wallet.id);
    setSessionCookie(ctx, reply, token);
  };

  /**
   * The account for a verified email or Google identity: the signed-in account when it can take
   * this identity, else the existing account that has it, else a new one.
   */
  const accountFor = async (
    req: FastifyRequest,
    who: { email: string; googleSub?: string },
    refCode: string | undefined,
  ): Promise<Wallet> => {
    const byGoogle = who.googleSub
      ? await ctx.prisma.wallet.findUnique({ where: { googleSub: who.googleSub } })
      : null;
    if (byGoogle) return byGoogle;
    const byEmail = await ctx.prisma.wallet.findUnique({ where: { email: who.email } });
    const current = await ctx.sessions.get(req.cookies[SESSION_COOKIE]);
    // Signed in without this email yet (e.g. a wallet account): add it, unless another account has it.
    if (current && !byEmail && !current.email) {
      return ctx.prisma.wallet.update({
        where: { id: current.id },
        data: {
          email: who.email,
          ...(who.googleSub && !current.googleSub ? { googleSub: who.googleSub } : {}),
        },
      });
    }
    if (byEmail) {
      return who.googleSub && !byEmail.googleSub
        ? ctx.prisma.wallet.update({ where: { id: byEmail.id }, data: { googleSub: who.googleSub } })
        : byEmail;
    }
    const referredById = await referrerFor(ctx.prisma, refCode);
    try {
      return await ctx.prisma.wallet.create({
        data: { email: who.email, googleSub: who.googleSub ?? null, referredById },
      });
    } catch (e) {
      // Two sign-ins at once: the other one created it.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        return ctx.prisma.wallet.findUniqueOrThrow({ where: { email: who.email } });
      }
      throw e;
    }
  };

  // ---------- email ----------

  app.post(
    "/auth/email/start",
    { config: { rateLimit: { max: 5, timeWindow: 60_000 } } },
    async (req, reply) => {
      requireOwnOrigin(ctx, req);
      if (!ctx.mailer) throw new ApiError(404, "email_login_off", "Email sign-in isn't available.");
      const body = startBody.parse(req.body);
      const sentKey = `emailsent:${sha256Hex(body.email)}`;
      const sent = await ctx.redis.incr(sentKey);
      if (sent === 1) await ctx.redis.expire(sentKey, 3600);
      if (sent > CODES_PER_HOUR) {
        throw new ApiError(429, "too_many_codes", "Too many codes for this address. Try again in an hour.", {
          "retry-after": Math.max(1, await ctx.redis.ttl(sentKey)),
        });
      }
      const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
      await ctx.redis.set(
        codeKey(body.email),
        JSON.stringify({ h: codeHash(body.email, code), n: 0 }),
        "EX",
        CODE_TTL_SECONDS,
      );
      try {
        await ctx.mailer.send({
          to: body.email,
          subject: `${code} is your ${brand.name} sign-in code`,
          text:
            `Your ${brand.name} sign-in code is ${code}\n\n` +
            `It works for 10 minutes. If you didn't ask for it, ignore this email: nobody can sign in without the code.\n\n` +
            `${brand.name} · https://${env.SITE_DOMAIN}`,
          html:
            `<div style="font-family:system-ui,sans-serif;max-width:420px">` +
            `<p>Your ${brand.name} sign-in code is</p>` +
            `<p style="font-size:30px;font-weight:700;letter-spacing:6px;margin:8px 0">${code}</p>` +
            `<p style="color:#666">It works for 10 minutes. If you didn't ask for it, ignore this email: nobody can sign in without the code.</p>` +
            `</div>`,
        });
      } catch (e) {
        req.log.error({ err: e }, "sign-in email failed");
        await ctx.redis.del(codeKey(body.email));
        throw new ApiError(502, "email_failed", "We couldn't send the email. Try again in a minute.");
      }
      return reply.status(204).send();
    },
  );

  app.post(
    "/auth/email/verify",
    { config: { rateLimit: { max: 10, timeWindow: 60_000 } } },
    async (req, reply) => {
      requireOwnOrigin(ctx, req);
      if (!ctx.mailer) throw new ApiError(404, "email_login_off", "Email sign-in isn't available.");
      const body = verifyBody.parse(req.body);
      const key = codeKey(body.email);
      const raw = await ctx.redis.get(key);
      if (!raw) throw new ApiError(400, "code_expired", "This code has expired. Ask for a new one.");
      const rec = JSON.parse(raw) as { h: string; n: number };
      if (rec.n >= CODE_ATTEMPTS) {
        await ctx.redis.del(key);
        throw new ApiError(429, "too_many_attempts", "Too many wrong codes. Ask for a new one.");
      }
      const want = Buffer.from(rec.h, "hex");
      const got = Buffer.from(codeHash(body.email, body.code), "hex");
      if (want.length !== got.length || !timingSafeEqual(want, got)) {
        const ttl = await ctx.redis.ttl(key);
        await ctx.redis.set(key, JSON.stringify({ ...rec, n: rec.n + 1 }), "EX", Math.max(1, ttl));
        throw new ApiError(400, "wrong_code", "That code isn't right. Check the email and try again.");
      }
      await ctx.redis.del(key);
      const wallet = await accountFor(req, { email: body.email }, body.ref);
      await signIn(reply, wallet);
      return buildMe(ctx, wallet);
    },
  );

  // ---------- Google ----------

  app.get(
    "/auth/google/start",
    { config: { rateLimit: { max: 20, timeWindow: 60_000 } } },
    async (req, reply) => {
      if (!googleOn) throw new ApiError(404, "google_login_off", "Google sign-in isn't available.");
      const q = googleStartQuery.parse(req.query);
      const state = randomBytes(24).toString("base64url");
      await ctx.redis.set(
        `gstate:${state}`,
        JSON.stringify({ ref: q.ref, ret: safeReturn(q.return) }),
        "EX",
        GOOGLE_STATE_TTL_SECONDS,
      );
      reply.setCookie(GOOGLE_STATE_COOKIE, state, {
        path: "/auth/google",
        httpOnly: true,
        sameSite: "lax",
        secure: env.NODE_ENV === "production",
        maxAge: GOOGLE_STATE_TTL_SECONDS,
      });
      const url = new URL(env.GOOGLE_AUTH_URL);
      url.search = new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        redirect_uri: `${apiUrl}/auth/google/callback`,
        response_type: "code",
        scope: "openid email profile",
        state,
        prompt: "select_account",
      }).toString();
      return reply.redirect(url.toString(), 302);
    },
  );

  app.get(
    "/auth/google/callback",
    { config: { rateLimit: { max: 20, timeWindow: 60_000 } } },
    async (req, reply) => {
      const fail = (why: string) => {
        req.log.warn({ why }, "google sign-in failed");
        return reply.redirect(`${site}/chat?login_error=google`, 302);
      };
      if (!googleOn) return fail("off");
      const q = googleCallbackQuery.parse(req.query);
      const cookieState = req.cookies[GOOGLE_STATE_COOKIE];
      reply.clearCookie(GOOGLE_STATE_COOKIE, { path: "/auth/google" });
      if (q.error || !q.code || !q.state || q.state !== cookieState) return fail("state");
      const saved = await ctx.redis.getdel(`gstate:${q.state}`);
      if (!saved) return fail("state expired");
      const { ref: refCode, ret } = JSON.parse(saved) as { ref?: string; ret: string };

      let idToken: string | undefined;
      try {
        const res = await fetch(env.GOOGLE_TOKEN_URL, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            code: q.code,
            client_id: env.GOOGLE_CLIENT_ID,
            client_secret: env.GOOGLE_CLIENT_SECRET,
            redirect_uri: `${apiUrl}/auth/google/callback`,
            grant_type: "authorization_code",
          }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) return fail(`token ${res.status}`);
        idToken = ((await res.json()) as { id_token?: string }).id_token;
      } catch {
        return fail("token request");
      }
      // The ID token came straight from Google's token endpoint over TLS in exchange for our
      // client secret, so its claims can be read without checking the signature (OpenID Connect
      // Core 3.1.3.7); the audience, issuer and expiry are still checked.
      const claims = readIdToken(idToken);
      const now = ctx.clock().getTime() / 1000;
      if (
        !claims ||
        claims.aud !== env.GOOGLE_CLIENT_ID ||
        !["accounts.google.com", "https://accounts.google.com"].includes(String(claims.iss)) ||
        typeof claims.exp !== "number" ||
        claims.exp < now ||
        typeof claims.sub !== "string" ||
        typeof claims.email !== "string" ||
        claims.email_verified !== true
      ) {
        return fail("claims");
      }
      const wallet = await accountFor(
        req,
        { email: claims.email.toLowerCase(), googleSub: claims.sub },
        refCode,
      );
      await signIn(reply, wallet);
      const back = new URL(ret, site);
      back.searchParams.set("signed_in", "1");
      return reply.redirect(back.toString(), 302);
    },
  );

  // ---------- referrals ----------

  app.get("/me/referral", { config: { rateLimit: { max: 60, timeWindow: 60_000 } } }, async (req, reply) => {
    reply.header("cache-control", "no-store");
    const wallet = await requireWallet(ctx, req);
    const code = await ensureReferralCode(ctx.prisma, wallet);
    const [joined, rewards] = await Promise.all([
      ctx.prisma.wallet.count({ where: { referredById: wallet.id } }),
      ctx.prisma.referralReward.aggregate({
        where: { referrerId: wallet.id },
        _count: { _all: true },
        _sum: { days: true },
      }),
    ]);
    const body: ReferralResponse = {
      code,
      link: `https://${env.SITE_DOMAIN}/?ref=${code}`,
      joined,
      upgraded: rewards._count._all,
      daysEarned: rewards._sum.days ?? 0,
      rewardDays: env.REFERRAL_PRO_DAYS,
    };
    return body;
  });
};

function readIdToken(token: string | undefined): Record<string, unknown> | null {
  const part = token?.split(".")[1];
  if (!part) return null;
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}
