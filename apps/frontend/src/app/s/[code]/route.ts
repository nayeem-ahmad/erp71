import { NextRequest, NextResponse } from 'next/server';
import { publicApiBase } from '@/lib/api-base';

/**
 * Short link: `/s/<code>` counts the click and forwards to the target.
 *
 * A server-side route handler rather than a client page, for the same reasons as
 * the referral route it mirrors: the redirect does not depend on JavaScript, and
 * a visitor who bounces immediately still counts.
 *
 * Internal targets redirect straight through, so a customer opening a shared
 * quotation sees no extra click. Off-domain targets go via an interstitial —
 * app.erp71.com must never silently bounce someone to a third-party site.
 *
 * Resolution is not best-effort (there is nowhere to go without it), but the
 * click count is: a tracking failure must never cost someone their destination.
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

export async function GET(request: NextRequest, context: { params: Promise<{ code: string }> }) {
    const { code } = await context.params;

    if (!code) return redirectToPath('/not-found');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), RESOLVE_TIMEOUT_MS);
    try {
        const response = await fetch(`${publicApiBase()}/short-links/resolve/${encodeURIComponent(code)}`, {
            method: 'POST',
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
            // The interstitial re-resolves the code itself rather than taking the
            // destination from a query param — otherwise anyone could craft an
            // erp71.com URL that displays one host and sends you to another.
            return redirectToPath(`/s/${encodeURIComponent(code)}/leaving`);
        }

        // Anything else — unknown/missing `kind`, malformed body — fails closed
        // to not-found rather than guessing. Never route an unrecognized kind
        // through the interstitial, which is reserved for confirmed `external`.
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
