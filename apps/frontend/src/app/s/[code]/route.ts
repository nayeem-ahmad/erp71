import { NextRequest, NextResponse } from 'next/server';

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

function apiBase(): string {
    const configured = process.env.NEXT_PUBLIC_API_BASE || process.env.NEXT_PUBLIC_API_URL;
    if (configured) return configured.replace(/\/+$/, '');
    return 'http://localhost:4000/api/v1';
}

export async function GET(request: NextRequest, context: { params: Promise<{ code: string }> }) {
    const { code } = await context.params;
    const notFound = new URL('/not-found', request.nextUrl.origin);

    if (!code) return NextResponse.redirect(notFound, { status: 302 });

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), RESOLVE_TIMEOUT_MS);
        const response = await fetch(`${apiBase()}/short-links/resolve/${encodeURIComponent(code)}`, {
            method: 'POST',
            signal: controller.signal,
            cache: 'no-store',
        });
        clearTimeout(timeout);

        if (!response.ok) return NextResponse.redirect(notFound, { status: 302 });

        const body = await response.json();
        const data = body?.data ?? body;

        if (data?.kind === 'internal') {
            return NextResponse.redirect(new URL(data.target_url, request.nextUrl.origin), { status: 302 });
        }

        // The interstitial re-resolves the code itself rather than taking the
        // destination from a query param — otherwise anyone could craft an
        // erp71.com URL that displays one host and sends you to another.
        return NextResponse.redirect(
            new URL(`/s/${encodeURIComponent(code)}/leaving`, request.nextUrl.origin),
            { status: 302 },
        );
    } catch {
        return NextResponse.redirect(notFound, { status: 302 });
    }
}
