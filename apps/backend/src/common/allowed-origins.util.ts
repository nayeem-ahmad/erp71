/**
 * Browser origins that must always be trusted in production, whatever the
 * environment happens to say.
 *
 * `FRONTEND_URL` names one host, but the platform is served from two: the app
 * on `app.erp71.com` and the marketing site on the apex since the 2026-09-07
 * two-domain cutover. The apex was missed in that cutover, so the landing
 * page's own call to `GET /auth/plans` was rejected by CORS and its pricing
 * preview silently fell back to static figures — the exact drift from
 * `/pricing` that reading the live plans was meant to prevent.
 *
 * `www` is here because Caddy proxies it rather than redirecting: the
 * `www`-to-apex fold happens in `resolveHostRoute`, so a request can reach the
 * API carrying the `www` origin.
 *
 * This list gates CSRF as well as CORS, so an origin missing here fails both.
 */
const ALWAYS_ALLOWED_PRODUCTION_ORIGINS = [
    'https://app.erp71.com',
    'https://app.nayeemahmad.com',
    'https://erp71.com',
    'https://www.erp71.com',
];

function toOrigin(url: string): string | null {
    const trimmed = url.trim();
    if (!trimmed) return null;
    try {
        return new URL(trimmed).origin;
    } catch {
        return trimmed.replace(/\/$/, '');
    }
}

/** Origins permitted for CORS and CSRF checks. */
export function getAllowedOrigins(): string[] {
    const origins = new Set<string>();

    const add = (value?: string) => {
        const origin = value ? toOrigin(value) : null;
        if (origin) origins.add(origin);
    };

    add(process.env.FRONTEND_URL);
    add(process.env.BACKEND_PUBLIC_URL);
    (process.env.ALLOWED_ORIGINS ?? '')
        .split(',')
        .forEach(add);

    if (process.env.NODE_ENV === 'production') {
        ALWAYS_ALLOWED_PRODUCTION_ORIGINS.forEach((origin) => origins.add(origin));
    }

    if (origins.size === 0) {
        origins.add('http://localhost:3000');
    }

    return [...origins];
}

export function isAllowedOrigin(origin: string | undefined): boolean {
    if (!origin) return true;
    return getAllowedOrigins().includes(origin);
}