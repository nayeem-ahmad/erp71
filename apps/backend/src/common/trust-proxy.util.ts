/**
 * Express `trust proxy` configuration for the API.
 *
 * The app never faces the internet directly: in production Caddy terminates
 * TLS and proxies to `backend:4000` over the compose network, and in local dev
 * the Next.js dev server proxies `/api/v1/*` through its rewrite. Either way
 * the socket peer is the proxy, not the caller.
 *
 * That matters because `ThrottlerGuard.getTracker()` keys its rate-limit
 * buckets off `req.ip`. With `trust proxy` left at its default (disabled),
 * `req.ip` is the socket address — identical for every request — so every
 * client on the platform shares one bucket and `/auth/login`'s limit of 10/min
 * becomes 10/min *in total*, for everyone.
 */

/**
 * Trust proxies on private networks only, rather than a fixed hop count.
 *
 * `uniquelocal` covers the RFC1918 ranges that Docker bridge networks live in
 * (Caddy reaches the backend from 172.16/12), `loopback` covers local dev and
 * supertest. Real callers arrive with public addresses, which stay untrusted.
 *
 * This is deliberately not `true`. Trusting every hop would make `req.ip` the
 * left-most `X-Forwarded-For` entry, which is attacker-controlled: a client
 * could rotate that header to get a fresh rate-limit bucket per request and
 * defeat login throttling entirely. Because Caddy *appends* the real peer to
 * `X-Forwarded-For`, walking in from the right past only private addresses
 * lands on the genuine client even when the caller sent a forged prefix.
 *
 * A hop count would also work, but would need revisiting whenever the proxy
 * chain changes (the compose `caddy` service vs. the shared Hermes Caddy);
 * this does not.
 */
export const TRUSTED_PROXIES = ['loopback', 'linklocal', 'uniquelocal'];

/** Minimal slice of the Express app that `applyProxyTrust` needs. */
export interface ProxyTrustable {
    set(setting: string, value: unknown): unknown;
}

/** Apply {@link TRUSTED_PROXIES} so `req.ip` reports the real caller. */
export function applyProxyTrust(app: ProxyTrustable): void {
    app.set('trust proxy', TRUSTED_PROXIES);
}
