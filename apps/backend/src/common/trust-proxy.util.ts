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

/**
 * Cloudflare's published edge ranges, from https://www.cloudflare.com/ips/
 * (the plain-text lists at /ips-v4 and /ips-v6). Checked 2026-10-04. Cloudflare
 * changes these rarely and announces it; re-check that page when it does, and
 * keep Caddy's `trusted_proxies` list in step with this one.
 */
export const CLOUDFLARE_PROXY_RANGES: readonly string[] = [
    // IPv4
    '173.245.48.0/20',
    '103.21.244.0/22',
    '103.22.200.0/22',
    '103.31.4.0/22',
    '141.101.64.0/18',
    '108.162.192.0/18',
    '190.93.240.0/20',
    '188.114.96.0/20',
    '197.234.240.0/22',
    '198.41.128.0/17',
    '162.158.0.0/15',
    '104.16.0.0/13',
    '104.24.0.0/14',
    '172.64.0.0/13',
    '131.0.72.0/22',
    // IPv6
    '2400:cb00::/32',
    '2606:4700::/32',
    '2803:f800::/32',
    '2405:b500::/32',
    '2405:8100::/32',
    '2a06:98c0::/29',
    '2c0f:f248::/32',
];

/**
 * The trusted hops for this deployment.
 *
 * With Cloudflare proxying `app.erp71.com`, a request reaches Caddy from one of
 * Cloudflare's *public* addresses, so the walk above stops there and every
 * visitor is reported as one of a handful of Cloudflare edges — they would share
 * a few rate-limit buckets, and every audit-log IP would be Cloudflare's.
 * `TRUST_CLOUDFLARE_PROXY=true` adds Cloudflare's ranges to the trusted hops, so
 * the walk steps over the edge and lands on the address Cloudflare received the
 * request from. That relies on Caddy keeping Cloudflare's `X-Forwarded-For`
 * rather than replacing it, i.e. Caddy's own `trusted_proxies` naming the same
 * ranges (perceived-speed plan, P3.1).
 *
 * Off by default, and only to be set while Cloudflare really is in front.
 * Trusting these ranges means believing whatever `X-Forwarded-For` arrives from
 * a Cloudflare address, and any Cloudflare customer can send one (a Worker
 * fetching the origin directly, say). With Cloudflare in front that trade buys
 * the real client address for everyone; without it, it buys nothing and lets
 * that traffic pick its own address — a fresh rate-limit bucket per request, a
 * forged IP in the audit log. Authenticated Origin Pulls, or a firewall that
 * admits only Cloudflare, closes the residual gap once Cloudflare is in front.
 *
 * A caller cannot fake the Cloudflare hop itself: the right-most entry is the
 * peer Caddy saw, so a request that did not come through Cloudflare stops the
 * walk at its own address whatever Cloudflare-looking values it put further
 * left.
 */
export function trustedProxies(env: NodeJS.ProcessEnv = process.env): string[] {
    if (env.TRUST_CLOUDFLARE_PROXY === 'true') {
        return [...TRUSTED_PROXIES, ...CLOUDFLARE_PROXY_RANGES];
    }
    return [...TRUSTED_PROXIES];
}

/** Minimal slice of the Express app that `applyProxyTrust` needs. */
export interface ProxyTrustable {
    set(setting: string, value: unknown): unknown;
}

/** Apply {@link trustedProxies} so `req.ip` reports the real caller. */
export function applyProxyTrust(app: ProxyTrustable, env: NodeJS.ProcessEnv = process.env): void {
    app.set('trust proxy', trustedProxies(env));
}
