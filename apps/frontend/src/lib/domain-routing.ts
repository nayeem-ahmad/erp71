/**
 * Which public domain a request arrived on, and what to do about it.
 *
 * ERP71 is one Next.js deployment serving two audiences on two hosts:
 *
 *  - **`erp71.com` / `www.erp71.com`** — the marketing site. Anonymous
 *    visitors, crawlers, the blog, pricing and the legal pages.
 *  - **`app.erp71.com`** — the signed-in product. Its front door is the
 *    dashboard (or the account chooser), never the marketing homepage.
 *
 * Two rules follow from that, and both live here so they can be tested as
 * plain functions rather than through the middleware they drive:
 *
 *  1. **An app path on the marketing host moves to the app host.** This is not
 *     cosmetic. The session lives in `localStorage`/`sessionStorage`, which is
 *     scoped to an origin, so signing in at `erp71.com/login` would leave the
 *     credentials on a host the app is not served from — the user would land on
 *     `app.erp71.com` and look signed out. One origin owns the session.
 *  2. **`/` on the app host is the app's entry point**, rewritten to
 *     `APP_ENTRY_PATH`, which resolves the session in the browser and continues
 *     to the dashboard or the login page. It cannot be decided here: the tokens
 *     are in web storage, which the server never sees.
 *
 * Everything is inert until `NEXT_PUBLIC_MARKETING_URL` names the marketing
 * origin. Unset — every dev machine, and production until DNS and the reverse
 * proxy are ready — `resolveHostRoute` passes every request through and the app
 * behaves exactly as it did on a single domain. That is the deploy switch: the
 * code can ship before the domain does.
 */

/** Where `/` on the app host is served from. Rewritten, so the URL stays `/`. */
export const APP_ENTRY_PATH = '/app-entry';

export type HostKind = 'marketing' | 'app' | 'unknown';

export type DomainConfig = {
    /** Canonical marketing origin, e.g. `https://erp71.com`. Null disables host routing. */
    marketingOrigin: string | null;
    /** Origin the signed-in app is served from, e.g. `https://app.erp71.com`. */
    appOrigin: string;
};

export type IncomingRequest = {
    /** Host header, `x-forwarded-host`, or a full origin — all are normalised. */
    hostname: string;
    pathname: string;
    /** Query string including the leading `?`, or empty. */
    search?: string;
};

export type HostRoute =
    | { kind: 'pass' }
    | { kind: 'redirect'; url: string; status: 308 }
    | { kind: 'rewrite'; pathname: string };

/**
 * Paths that belong to the app host.
 *
 * The `(app)` route group — every signed-in page — plus the auth flows, which
 * end by writing credentials into the origin's storage and so must run on the
 * origin that will read them back. `/demo` is in the list for the same reason:
 * it signs the visitor into a sandbox tenant on arrival, and `/w/*` because it
 * reads the session to pick a workspace before forwarding into the app.
 *
 * Deliberately absent: `/store/*` (a shop's public storefront), `/q/*` and
 * `/s/*` (the quotation shortener) and `/r/*` (referral links, which forward to
 * `/signup` with a relative `Location` and so pick up this redirect anyway).
 * Those are public, session-free, and correct on either host.
 */
const APP_ONLY_PREFIXES = [
    '/accounting',
    '/admin',
    '/ai-credits',
    '/billing',
    '/chat',
    '/crm',
    '/dashboard',
    '/help',
    '/hr',
    '/inventory',
    '/manufacturing',
    '/my',
    '/notifications',
    '/profile',
    '/projects',
    '/purchases',
    '/referrals',
    '/sales',
    '/settings',
    '/sms-credits',
    '/status',
    '/storefront',
    '/support',
    '/team',
    '/w',
    '/whats-new',
    // Auth flows — see the note above.
    '/accept-invitation',
    '/demo',
    '/forgot-password',
    '/login',
    '/reset-password',
    '/select-account',
    '/signup',
    '/verify-email',
    // The app host's own front door, reachable directly as well as by rewrite.
    APP_ENTRY_PATH,
];

/**
 * Reduce anything host-shaped to a bare hostname: `https://ERP71.com:443/x` and
 * `erp71.com.` both become `erp71.com`.
 *
 * Accepting origins as well as hostnames is what lets the configured
 * `https://…` origins and the raw `Host` header be compared without the caller
 * having to know which it is holding.
 */
export function normalizeHostname(value: string | null | undefined): string {
    if (!value) return '';
    return value
        .trim()
        .toLowerCase()
        .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
        .replace(/\/.*$/, '')
        .replace(/:\d+$/, '')
        .replace(/\.$/, '');
}

function trimTrailingSlashes(value: string): string {
    return value.replace(/\/+$/, '');
}

/** The apex a marketing host belongs to: `www.erp71.com` and `erp71.com` share one. */
function apexOf(hostname: string): string {
    return hostname.replace(/^www\./, '');
}

/**
 * Config from the environment. Read through `process.env.NEXT_PUBLIC_*`
 * literals so Next inlines the values at build time — middleware runs in the
 * edge runtime, where a dynamic lookup would find nothing.
 */
export function readDomainConfig(): DomainConfig {
    const marketing = trimTrailingSlashes(process.env.NEXT_PUBLIC_MARKETING_URL ?? '');
    const app = trimTrailingSlashes(process.env.NEXT_PUBLIC_APP_URL ?? '');
    return {
        marketingOrigin: marketing || null,
        appOrigin: app || 'https://app.erp71.com',
    };
}

/**
 * Canonical origin for absolute URLs in metadata, JSON-LD, sitemaps and RSS.
 *
 * The marketing origin once there is one — those URLs are all read far from the
 * page that emitted them, by crawlers and feed readers that should be sent to
 * the public site rather than the app host.
 */
export function siteOrigin(): string {
    const configured = process.env.NEXT_PUBLIC_MARKETING_URL
        || process.env.NEXT_PUBLIC_SITE_URL
        || process.env.NEXT_PUBLIC_APP_URL;
    return trimTrailingSlashes(configured || 'https://app.erp71.com');
}

/** True when `pathname` only makes sense on the app host. */
export function isAppOnlyPath(pathname: string): boolean {
    return APP_ONLY_PREFIXES.some(
        (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    );
}

/**
 * Which of the two sites `hostname` is.
 *
 * `unknown` covers localhost, preview deployments, direct-to-IP requests and
 * any host that is neither — all of which keep the single-domain behaviour.
 * Identical marketing and app origins are treated the same way, so a
 * misconfiguration degrades to "do nothing" rather than to a redirect loop.
 */
export function classifyHost(hostname: string, config: DomainConfig): HostKind {
    if (!config.marketingOrigin) return 'unknown';

    const host = normalizeHostname(hostname);
    const marketingHost = normalizeHostname(config.marketingOrigin);
    const appHost = normalizeHostname(config.appOrigin);
    if (!host || !marketingHost || !appHost || marketingHost === appHost) return 'unknown';

    if (host === appHost) return 'app';

    // Both halves of the marketing pair are the marketing site, whichever one is
    // configured as canonical; `resolveHostRoute` then folds one into the other.
    const apex = apexOf(marketingHost);
    if (host === apex || host === `www.${apex}`) return 'marketing';

    return 'unknown';
}

/** What the middleware should do with this request. */
export function resolveHostRoute(request: IncomingRequest, config: DomainConfig): HostRoute {
    const kind = classifyHost(request.hostname, config);
    if (kind === 'unknown') return { kind: 'pass' };

    const { pathname } = request;
    const search = request.search ?? '';

    if (kind === 'app') {
        // Only the front door is special. Every other path on the app host —
        // including the marketing pages, which stay reachable — is served as-is.
        return pathname === '/' ? { kind: 'rewrite', pathname: APP_ENTRY_PATH } : { kind: 'pass' };
    }

    // Marketing host from here down.
    if (isAppOnlyPath(pathname)) {
        return {
            kind: 'redirect',
            url: `${trimTrailingSlashes(config.appOrigin)}${pathname}${search}`,
            status: 308,
        };
    }

    // `www` and the apex both answer; one of them is canonical and the other
    // forwards, so a page is never indexed at two addresses.
    const canonical = normalizeHostname(config.marketingOrigin);
    if (normalizeHostname(request.hostname) !== canonical) {
        return {
            kind: 'redirect',
            url: `${trimTrailingSlashes(config.marketingOrigin as string)}${pathname}${search}`,
            status: 308,
        };
    }

    return { kind: 'pass' };
}
