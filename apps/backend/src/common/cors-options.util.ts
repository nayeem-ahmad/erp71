import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

/**
 * How long a browser may reuse a CORS preflight answer, in seconds.
 *
 * Every API call carries `Authorization` plus `x-tenant-id` / `x-store-id`, and
 * any one of those makes the browser ask `OPTIONS` first. Without
 * `Access-Control-Max-Age` it keeps that answer for about five seconds, per
 * exact URL, so nearly every call paid a full extra round trip — about 0.25 s
 * from Bangladesh to the VPS — before the request it was actually making.
 *
 * Two hours is Chrome's ceiling (Firefox allows a day; anything above a
 * browser's cap is clamped, not rejected). Most app traffic stops being
 * cross-origin once the frontend calls the API on its own domain, but the
 * marketing host and anything else still on `api.erp71.com` keep crossing.
 *
 * Caching the preflight does not widen what is allowed. The browser keys the
 * cached answer on origin and URL and still checks the method and headers
 * against it, and every real response is checked for
 * `Access-Control-Allow-Origin` on its own — so an origin dropped from the
 * allow-list loses the ability to read responses at once, and to send
 * preflighted requests within two hours.
 */
export const CORS_PREFLIGHT_MAX_AGE_SECONDS = 7200;

/** The API's CORS policy: the given origins, with credentials, preflights cached. */
export function buildCorsOptions(allowedOrigins: readonly string[]): CorsOptions {
    return {
        origin: (origin, callback) => {
            if (!origin || allowedOrigins.includes(origin)) {
                callback(null, true);
                return;
            }
            callback(new Error(`Origin ${origin} is not allowed by CORS`));
        },
        credentials: true,
        maxAge: CORS_PREFLIGHT_MAX_AGE_SECONDS,
    };
}
