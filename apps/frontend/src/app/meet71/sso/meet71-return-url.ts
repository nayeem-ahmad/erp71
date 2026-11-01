/**
 * Open-redirect guards for the Meet71 SSO bounce page.
 *
 * `/meet71/sso` is a public client page. Query `return_url` is never assigned
 * to `window.location` unless mint returned 200 and the URL's origin+path
 * match. Error / no-session paths use the baked Meet71 origin only.
 */

import type { Meet71MintResult } from '@/lib/mint-meet71-sso';

const CALLBACK_PATH = '/api/auth/erp71/callback';

const LOCAL_RETURN_ORIGINS = [
    'http://localhost:3071',
    'http://127.0.0.1:3071',
    'http://localhost:3000',
] as const;

export type Meet71BounceDestination =
    | { kind: 'meet71'; url: string }
    | { kind: 'login' };

/** Origin string without a trailing slash. `new URL(origin).origin` when parseable. */
function originOf(value: string): string | null {
    try {
        return new URL(value).origin;
    } catch {
        return null;
    }
}

/**
 * Parse `candidate`; origin must equal `allowedOrigin` and pathname must be
 * exactly `/api/auth/erp71/callback`. Otherwise `null`.
 *
 * Origin is compared via the URL parser, not a substring, so
 * `https://meet.erp71.com.evil.com` does not match `https://meet.erp71.com`.
 */
export function assertMeet71CallbackUrl(candidate: string, allowedOrigin: string): string | null {
    let parsed: URL;
    try {
        parsed = new URL(candidate);
    } catch {
        return null;
    }

    const allowed = originOf(allowedOrigin);
    if (!allowed) return null;
    if (parsed.origin !== allowed) return null;
    if (parsed.pathname !== CALLBACK_PATH) return null;
    return `${parsed.origin}${CALLBACK_PATH}`;
}

function extraReturnOrigins(primary: string): string[] {
    if (process.env.NODE_ENV === 'production') return [];
    return LOCAL_RETURN_ORIGINS.filter((origin) => origin !== primary);
}

function assertedCallback(candidate: string, allowedOrigin: string): string | null {
    const primary = assertMeet71CallbackUrl(candidate, allowedOrigin);
    if (primary) return primary;
    for (const origin of extraReturnOrigins(allowedOrigin)) {
        const hit = assertMeet71CallbackUrl(candidate, origin);
        if (hit) return hit;
    }
    return null;
}

export function meet71PublicOrigin(): string {
    const baked = process.env.NEXT_PUBLIC_MEET71_ORIGIN?.trim().replace(/\/+$/, '');
    if (baked) return baked;
    return process.env.NODE_ENV === 'production'
        ? 'https://meet.erp71.com'
        : 'http://localhost:3071';
}

export function meet71NoneUrl(allowedOrigin: string): string {
    const origin = originOf(allowedOrigin) ?? allowedOrigin.replace(/\/+$/, '');
    return `${origin}/?sso=none`;
}

export function meet71NotAllowedUrl(allowedOrigin: string, email?: string): string {
    const origin = originOf(allowedOrigin) ?? allowedOrigin.replace(/\/+$/, '');
    const url = new URL('/', `${origin}/`);
    url.searchParams.set('error', 'not-allowed');
    if (email) url.searchParams.set('email', email);
    return url.href;
}

function withCodeAndState(callback: string, code: string, state: string): string {
    const url = new URL(callback);
    url.searchParams.set('code', code);
    url.searchParams.set('state', state);
    return url.href;
}

export function meet71BounceWithoutSession(
    prompt: 'none' | 'login',
    allowedOrigin: string,
): Meet71BounceDestination {
    if (prompt === 'login') return { kind: 'login' };
    return { kind: 'meet71', url: meet71NoneUrl(allowedOrigin) };
}

export function meet71BounceAfterMint(opts: {
    prompt: 'none' | 'login';
    result: Meet71MintResult;
    returnUrl: string;
    state: string;
    allowedOrigin: string;
    email?: string;
}): Meet71BounceDestination {
    const none: Meet71BounceDestination = { kind: 'meet71', url: meet71NoneUrl(opts.allowedOrigin) };

    if (opts.result.ok) {
        const callback = assertedCallback(opts.returnUrl, opts.allowedOrigin);
        if (!callback) return none;
        return {
            kind: 'meet71',
            url: withCodeAndState(callback, opts.result.code, opts.state),
        };
    }

    switch (opts.result.reason) {
        case 'not-allowed':
            return { kind: 'meet71', url: meet71NotAllowedUrl(opts.allowedOrigin, opts.email) };
        case 'password-change-required':
        case 'unauthenticated':
            return opts.prompt === 'login' ? { kind: 'login' } : none;
        default:
            return none;
    }
}
