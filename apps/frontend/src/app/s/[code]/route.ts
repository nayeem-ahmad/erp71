import { NextRequest, NextResponse } from 'next/server';
import { publicApiBase } from '@/lib/api-base';

/**
 * Short link: `/s/<code>` counts the click and forwards to the target.
 *
 * A server-side route handler rather than a client page, for the same reasons as
 * the referral route it mirrors: the redirect does not depend on JavaScript, and
 * a visitor who bounces immediately still counts.
 *
 * Both internal and external targets redirect straight through. There used to be
 * an "you are leaving ERP71" interstitial on off-domain targets; it was removed
 * because a shortener that stops to ask is not a shortener — every link pasted
 * into WhatsApp or an ad cost the recipient an extra tap on a page they did not
 * ask for. What keeps that safe is upstream, not here: only a signed-in user
 * holding MANAGE_SHORT_LINKS can mint a link at all, and `isSafeTarget` on the
 * backend refuses private hosts, non-http(s) schemes and our own auth pages.
 *
 * Resolution is not best-effort (there is nowhere to go without it), but the
 * click record is: a tracking failure must never cost someone their destination.
 */
export const dynamic = 'force-dynamic';

const RESOLVE_TIMEOUT_MS = 3000;

/**
 * 302 to a same-origin path, as a *relative* `Location`.
 *
 * Deliberately not `NextResponse.redirect(new URL(path, request.nextUrl.origin))`.
 * Inside the standalone server `request.nextUrl.origin` is built from the
 * process's own bind address (`HOSTNAME=0.0.0.0`, `PORT=3000` — see
 * apps/frontend/Dockerfile) and ignores both `Host` and `X-Forwarded-Host`, so
 * every short link shipped pointing at `https://0.0.0.0:3000/...`, which no
 * browser can reach.
 *
 * A relative `Location` is explicitly allowed (RFC 7231 §7.1.2) and the browser
 * resolves it against the URL it actually requested — the real public one. That
 * removes the need to know the public origin at all, rather than reconstructing
 * it from proxy headers, which would also make the redirect target steerable by
 * a spoofed `Host`.
 *
 * Callers must pass a path starting with a single `/`; every call site below
 * either hardcodes one or has run it through `isSameOriginPath` first.
 */
function redirectToPath(path: string) {
    return new NextResponse(null, { status: 302, headers: { Location: path } });
}

/**
 * True only for a path a browser is guaranteed to resolve *on* the origin it
 * requested, rather than one that sends it somewhere else entirely.
 *
 * This guard carries more weight now that `Location` is relative, not less. A
 * `Location: //evil.com/x` is a protocol-relative URL, and a browser follows it
 * straight off-site — so an unchecked `target_url` here is a plain open redirect
 * on app.erp71.com, with no `new URL()` call in between to notice.
 *
 * That's safe today only because the backend's `isSafeTarget` never labels an
 * absolute or protocol-relative target as `internal` — but that's a contract
 * living in a different module, so this route re-checks it locally rather than
 * trust it silently. `/\` is included because some URL parsers treat a leading
 * backslash the same as a leading slash-slash.
 */
function isSameOriginPath(path: unknown): path is string {
    return typeof path === 'string' && path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/\\');
}

/**
 * True only for an absolute http(s) URL.
 *
 * The mirror of `isSameOriginPath` for the off-domain case, and the reason a
 * `kind: 'external'` claim is not enough on its own: `Location: javascript:...`
 * or a `data:` URL would be a script-execution vector handed out under our own
 * domain. The backend already enforces this in `isSafeTarget`, and this route
 * re-checks it locally for the same reason it re-checks internal paths — the
 * contract lives in another module.
 */
function isExternalHttpUrl(value: unknown): value is string {
    if (typeof value !== 'string') return false;
    try {
        const { protocol } = new URL(value);
        return protocol === 'http:' || protocol === 'https:';
    } catch {
        return false;
    }
}

/**
 * What this request can tell us about the visitor, forwarded to the API so the
 * click can be recorded with context rather than as a bare +1.
 *
 * It has to travel explicitly: the call below is a server-to-server fetch, so
 * none of the visitor's own headers reach the API on their own. `x-forwarded-for`
 * is passed through as a header rather than a body field so the API can read the
 * address the same way it does for every other request.
 *
 * The geo headers are read opportunistically — Caddy does not set them today, so
 * they are normally absent, and `country`/`city` stay null for a later geo-IP
 * backfill to fill in. Reading them costs nothing and means putting a CDN in
 * front later starts populating geo with no code change.
 */
function visitorContext(request: NextRequest) {
    const header = (name: string) => request.headers.get(name) ?? undefined;

    return {
        body: {
            referrer: header('referer'),
            user_agent: header('user-agent'),
            // The query string of the /s/ URL itself, which is where utm tags on
            // a shared link arrive.
            query: request.nextUrl.search || undefined,
            language: header('accept-language'),
            country:
                header('cf-ipcountry') ??
                header('x-vercel-ip-country') ??
                header('cloudfront-viewer-country') ??
                header('x-geo-country'),
            city: header('x-vercel-ip-city') ?? header('cf-ipcity') ?? header('x-geo-city'),
        },
        forwardedFor: header('x-forwarded-for') ?? header('x-real-ip'),
    };
}

export async function GET(request: NextRequest, context: { params: Promise<{ code: string }> }) {
    const { code } = await context.params;

    if (!code) return redirectToPath('/not-found');

    const visitor = visitorContext(request);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), RESOLVE_TIMEOUT_MS);
    try {
        const response = await fetch(`${publicApiBase()}/short-links/resolve/${encodeURIComponent(code)}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(visitor.forwardedFor ? { 'x-forwarded-for': visitor.forwardedFor } : {}),
            },
            body: JSON.stringify(visitor.body),
            signal: controller.signal,
            cache: 'no-store',
        });

        if (!response.ok) return redirectToPath('/not-found');

        const body = await response.json();
        const data = body?.data ?? body;

        if (data?.kind === 'internal') {
            if (!isSameOriginPath(data.target_url)) return redirectToPath('/not-found');
            return redirectToPath(data.target_url);
        }

        if (data?.kind === 'external') {
            if (!isExternalHttpUrl(data.target_url)) return redirectToPath('/not-found');
            return new NextResponse(null, { status: 302, headers: { Location: data.target_url } });
        }

        // Anything else — unknown/missing `kind`, malformed body — fails closed
        // to not-found rather than guessing. An unrecognized kind is never
        // treated as a destination.
        return redirectToPath('/not-found');
    } catch {
        return redirectToPath('/not-found');
    } finally {
        // Always release the timer, whether fetch resolved, rejected, or
        // aborted — otherwise a failed/aborted fetch leaks a live timeout per
        // request instead of firing harmlessly against an already-used
        // controller.
        clearTimeout(timeout);
    }
}
