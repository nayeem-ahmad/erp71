import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { ThrottlerOptions } from '@nestjs/throttler';

/**
 * The platform's default rate limit, keyed on the signed-in user, with a
 * per-address ceiling beside it.
 *
 * The default used to be 20 a minute per address, and this platform's customers
 * share addresses: a shop's tills leave through one office line, and a phone on
 * Grameenphone or Robi sits behind a carrier NAT with a crowd of strangers. One
 * dashboard load is about 18 calls, so twenty a minute *between everyone on the
 * line* was spent by one person opening two screens, and the next till got a
 * 429 for doing nothing unusual.
 *
 * Signed-in traffic carries a better key than its address — the access token —
 * so the default budget moves onto the user:
 *
 *  - `default`: {@link DEFAULT_THROTTLE_LIMIT} a minute per *verified* user.
 *    A request without a valid access token keeps the old key, its address.
 *  - `ip`: {@link IP_THROTTLE_LIMIT} a minute per address, on every request
 *    whatever its token. A whole shop floor fits inside it; one host hammering
 *    the API with many accounts does not.
 *
 * Both run on every route, and a request has to clear both. Like every
 * throttler here, each budget is per route: `GET /products` and `GET /sales`
 * have separate buckets, as they always had.
 *
 * Keys come from a *verified* token, never a decoded one. The `sub` claim of an
 * unverified token is whatever the caller typed, so trusting it would let one
 * host mint a fresh bucket per request just by varying a garbage
 * `Authorization` header. A token that fails verification — forged, tampered,
 * expired, or not a JWT at all — is ignored and the request is keyed on its
 * address, so junk tokens all land in the one bucket their sender already has.
 */
export const IP_THROTTLER = 'ip';

/** How long both budgets run for. */
export const DEFAULT_THROTTLE_TTL_MS = 60_000;
/** Per signed-in user (per address for a request without a valid token), per route. */
export const DEFAULT_THROTTLE_LIMIT = 120;
/** Per address, per route, whatever the request's token. */
export const IP_THROTTLE_LIMIT = 600;

/**
 * Metadata keys `@Throttle()` and `@SkipThrottle()` write, from
 * `@nestjs/throttler`'s `throttler.constants` (6.x), which the package does not
 * export. `default-throttle` specs fail if a library upgrade renames them: a
 * route's own budget would stop reaching the per-address dimension.
 */
const THROTTLER_LIMIT = 'THROTTLER:LIMIT';
const THROTTLER_TTL = 'THROTTLER:TTL';
const THROTTLER_SKIP = 'THROTTLER:SKIP';

/** Throttler options get no injector, so the guard's own `Reflector` is out of reach. */
const reflector = new Reflector();

/**
 * No module options: the secret is passed per call, so it is read when a request
 * arrives rather than whenever this file happened to be imported.
 */
const verifier = new JwtService();

/**
 * The access-token secret. Must match `JwtModule.register` in `auth.module.ts`
 * and `JwtStrategy`, which sign and verify every access token with it, fallback
 * included — a mismatch would quietly put every signed-in user back on the
 * address key.
 */
function accessTokenSecret(): string {
    return process.env.JWT_SECRET || 'fallback-secret-for-dev-only';
}

/** Longest id worth a bucket. Ours are UUIDs; anything far longer is not one. */
const MAX_SUBJECT_LENGTH = 128;

/** The bearer token on a request, or `null`. Same parsing as passport-jwt's extractor. */
function bearerToken(req: Record<string, any>): string | null {
    const header = req.headers?.authorization;
    if (typeof header !== 'string') return null;
    const match = /^\s*(\S+)\s+(\S+)\s*$/.exec(header);
    if (!match || match[1].toLowerCase() !== 'bearer') return null;
    return match[2];
}

/**
 * The user a request's access token was issued to — but only if the token
 * verifies: our secret, HS256 (what `JwtModule` signs with, pinned so an
 * `alg: none` token is refused), and not expired.
 *
 * This proves the token was issued by this server, not that the session is
 * still live: a token revoked by a logout or password change keeps its owner's
 * bucket until it expires (an hour at most). That is fine for a rate-limit key
 * — it still names one real account, and only its owner can have it — while
 * the revocation itself is enforced where it always was, in `JwtStrategy`.
 */
export function verifiedUserId(req: Record<string, any>): string | null {
    const token = bearerToken(req);
    if (!token) return null;
    try {
        const payload = verifier.verify<{ sub?: unknown }>(token, {
            secret: accessTokenSecret(),
            algorithms: ['HS256'],
        });
        const sub = payload?.sub;
        if (typeof sub !== 'string' || !sub || sub.length > MAX_SUBJECT_LENGTH) return null;
        return sub;
    } catch {
        return null;
    }
}

/** `getTracker` for the default throttler: the verified user, else the address. */
export const trackUserOrAddress = (req: Record<string, any>): string => {
    const userId = verifiedUserId(req);
    return userId ? `user:${userId}` : `ip:${req.ip}`;
};

/** `getTracker` for the per-address ceiling. */
export const trackAddress = (req: Record<string, any>): string => `ip:${req.ip}`;

/** A positive number from the environment, or the fallback for anything else. */
function envNumber(value: string | undefined, fallback: number): number {
    const parsed = Number(value);
    return value !== undefined && value.trim() !== '' && Number.isFinite(parsed) && parsed > 0
        ? parsed
        : fallback;
}

/** What a route declared for the `default` throttler with `@Throttle`/`@SkipThrottle`. */
async function routeDefault<T>(context: ExecutionContext, key: string): Promise<T | undefined> {
    const value = reflector.getAllAndOverride<T | ((context: ExecutionContext) => T | Promise<T>)>(
        `${key}default`,
        [context.getHandler(), context.getClass()],
    );
    return typeof value === 'function'
        ? await (value as (context: ExecutionContext) => T | Promise<T>)(context)
        : value;
}

/**
 * The default throttler, for `ThrottlerModule.forRoot`. `THROTTLE_TTL_MS` and
 * `THROTTLE_LIMIT` still override it, as they did when it was per address.
 */
export function defaultThrottler(env: NodeJS.ProcessEnv = process.env): ThrottlerOptions {
    return {
        name: 'default',
        ttl: envNumber(env.THROTTLE_TTL_MS, DEFAULT_THROTTLE_TTL_MS),
        limit: envNumber(env.THROTTLE_LIMIT, DEFAULT_THROTTLE_LIMIT),
        getTracker: trackUserOrAddress,
    };
}

/**
 * The per-address ceiling, for `ThrottlerModule.forRoot`.
 *
 * `THROTTLE_IP_LIMIT` overrides the 600. Left unset, it is never below the
 * per-user limit: an environment that raises `THROTTLE_LIMIT` (the e2e stacks
 * run with 100000) means "throttle less", and a ceiling under the per-user
 * budget would make that budget unreachable even for one user on their own.
 *
 * **A route that sets its own budget sets it here too.** `@Throttle({ default:
 * … })` and `@SkipThrottle()` name only the default throttler, so on their own
 * they would leave this one at 600 everywhere. Most of those routes are where a
 * per-address budget is the point — sign-in, sign-up, password reset, the
 * contact and enquiry forms — and a few are expensive (AI chat, photo uploads,
 * SMS credit). Keyed on the user alone, a caller holding a handful of valid
 * tokens would get a handful of budgets from one host, up to 600 a minute: ten
 * times what `/auth/login` allows an address, a hundred and twenty times what
 * sign-up does. So the route's own `ttl` and `limit` become this dimension's
 * too, which keeps what each of those routes promised — N a minute per address
 * — and adds N a minute per user beside it; a skipped route skips both. A route
 * that wants something else for the address can still say so with
 * `@Throttle({ ip: … })` or `@SkipThrottle({ ip: true })`, which take
 * precedence.
 */
export function ipThrottler(env: NodeJS.ProcessEnv = process.env): ThrottlerOptions {
    const ttl = envNumber(env.THROTTLE_TTL_MS, DEFAULT_THROTTLE_TTL_MS);
    const limit = envNumber(
        env.THROTTLE_IP_LIMIT,
        Math.max(IP_THROTTLE_LIMIT, envNumber(env.THROTTLE_LIMIT, DEFAULT_THROTTLE_LIMIT)),
    );
    return {
        name: IP_THROTTLER,
        ttl: async (context) => (await routeDefault<number>(context, THROTTLER_TTL)) ?? ttl,
        limit: async (context) => (await routeDefault<number>(context, THROTTLER_LIMIT)) ?? limit,
        getTracker: trackAddress,
        skipIf: (context) =>
            reflector.getAllAndOverride<boolean>(`${THROTTLER_SKIP}default`, [
                context.getHandler(),
                context.getClass(),
            ]) === true,
    };
}
