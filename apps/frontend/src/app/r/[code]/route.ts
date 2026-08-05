import { NextRequest, NextResponse } from 'next/server';
import { publicApiBase } from '@/lib/api-base';

/**
 * Referral tracking link: `/r/<code>` records the visit and forwards to signup.
 *
 * A server-side route handler rather than a client page on purpose — the click is
 * recorded before anything renders, so it does not depend on JavaScript running,
 * and a visitor who bounces immediately still counts.
 *
 * It lives on the app domain rather than pointing partners at the API host: these
 * links get printed on cards and pasted into WhatsApp, and an api.* URL reads as
 * suspicious.
 *
 * Recording is best-effort. A tracking failure must never stop someone reaching
 * the signup form, so every error path still redirects.
 */
export const dynamic = 'force-dynamic';

const TRACKING_TIMEOUT_MS = 2000;

export async function GET(
    request: NextRequest,
    context: { params: Promise<{ code: string }> },
) {
    const { code } = await context.params;
    const normalized = (code ?? '').trim().toUpperCase();

    const signupUrl = new URL('/signup', request.nextUrl.origin);
    if (normalized) signupUrl.searchParams.set('ref', normalized);

    if (normalized) {
        try {
            // Don't hold the redirect hostage to the tracking write.
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), TRACKING_TIMEOUT_MS);
            await fetch(`${publicApiBase()}/referrals/clicks/${encodeURIComponent(normalized)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    referrer: request.headers.get('referer') ?? undefined,
                    user_agent: request.headers.get('user-agent') ?? undefined,
                }),
                signal: controller.signal,
                cache: 'no-store',
            });
            clearTimeout(timeout);
        } catch {
            // Swallowed deliberately — see the note above.
        }
    }

    return NextResponse.redirect(signupUrl, { status: 302 });
}
