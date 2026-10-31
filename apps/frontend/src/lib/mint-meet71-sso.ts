/**
 * Mint a one-time Meet71 SSO code from the ERP71 app JWT.
 *
 * Deliberately not `requestWithAuth` / `fetchWithAuth`: those attach
 * `x-tenant-id` and, on a 401 after refresh, call `handleExpiredSession`,
 * which would wipe ERP71 `localStorage` during a silent bounce. A storefront
 * or applicant token (or any mint 401) on `prompt=none` must not log the
 * person out of ERP71.
 */

import { browserApiBase } from './api-base';
import { renewSession } from './api';
import {
    getAccessToken,
    hasStoredSession,
    isAccessTokenNearExpiry,
} from './session-store';

export type MintMeet71SsoCodeInput = {
    returnUrl: string;
    codeChallenge: string;
    state: string;
};

export type Meet71MintResult =
    | { ok: true; code: string }
    | { ok: false; reason: 'unauthenticated' | 'not-allowed' | 'password-change-required' | 'failed' };

function readErrorCode(body: unknown): string | undefined {
    if (typeof body !== 'object' || body === null) return undefined;
    const record = body as Record<string, unknown>;
    if (typeof record.code === 'string') return record.code;
    const nested = record.error;
    if (typeof nested === 'object' && nested !== null && typeof (nested as Record<string, unknown>).code === 'string') {
        return (nested as Record<string, string>).code;
    }
    return undefined;
}

async function renewIfNearExpiry(): Promise<void> {
    if (isAccessTokenNearExpiry()) await renewSession();
}

function mintHeaders(token: string): Headers {
    const headers = new Headers();
    headers.set('Authorization', `Bearer ${token}`);
    headers.set('Content-Type', 'application/json');
    return headers;
}

async function resolveAccessToken(isRetry: boolean): Promise<string | null> {
    const existing = getAccessToken();
    if (existing) return existing;
    if (isRetry) return null;
    const outcome = await renewSession();
    if (outcome !== 'renewed') return null;
    return getAccessToken();
}

function readMintedCode(body: unknown): string | null {
    if (typeof body !== 'object' || body === null) return null;
    const record = body as Record<string, unknown>;
    const payload = record.data !== undefined ? record.data : record;
    if (typeof payload !== 'object' || payload === null) return null;
    const code = (payload as Record<string, unknown>).code;
    return typeof code === 'string' && code ? code : null;
}

async function postMint(input: MintMeet71SsoCodeInput, isRetry: boolean): Promise<Meet71MintResult> {
    const token = await resolveAccessToken(isRetry);
    if (!token) return { ok: false, reason: 'unauthenticated' };

    let response: Response;
    try {
        response = await fetch(`${browserApiBase()}/meet71/sso/code`, {
            method: 'POST',
            headers: mintHeaders(token),
            body: JSON.stringify({
                return_url: input.returnUrl,
                code_challenge: input.codeChallenge,
                code_challenge_method: 'S256',
                state: input.state,
            }),
        });
    } catch {
        return { ok: false, reason: 'failed' };
    }

    if (response.status === 401) {
        if (!isRetry) {
            const outcome = await renewSession();
            if (outcome === 'renewed') return postMint(input, true);
        }
        return { ok: false, reason: 'unauthenticated' };
    }

    if (response.ok) {
        const body = await response.json().catch(() => null);
        const code = readMintedCode(body);
        if (!code) return { ok: false, reason: 'failed' };
        return { ok: true, code };
    }

    const body = await response.json().catch(() => null);
    const code = readErrorCode(body);
    if (response.status === 403 && code === 'MEET71_NOT_ALLOWED') {
        return { ok: false, reason: 'not-allowed' };
    }
    if (response.status === 403 && code === 'PASSWORD_CHANGE_REQUIRED') {
        return { ok: false, reason: 'password-change-required' };
    }
    return { ok: false, reason: 'failed' };
}

export async function mintMeet71SsoCode(input: MintMeet71SsoCodeInput): Promise<Meet71MintResult> {
    if (!hasStoredSession()) {
        return { ok: false, reason: 'unauthenticated' };
    }
    await renewIfNearExpiry();
    return postMint(input, false);
}
