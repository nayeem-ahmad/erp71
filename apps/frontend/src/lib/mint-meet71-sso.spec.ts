/**
 * mintMeet71SsoCode must not share requestWithAuth: that helper attaches
 * x-tenant-id and, on a 401 after refresh, calls handleExpiredSession — which
 * would sign the person out of ERP71 during a silent Meet71 bounce.
 */

jest.mock('./session-expiry', () => ({
    handleExpiredSession: jest.fn(),
    handleMissingSession: jest.fn(),
}));

import { handleExpiredSession, handleMissingSession } from './session-expiry';
import { resetSessionRenewalForTests } from './api';
import { resetWorkspaceBootstrapForTests } from './session-store';
import { mintMeet71SsoCode } from './mint-meet71-sso';

const mockFetch = jest.fn();
global.fetch = mockFetch;

function fakeResponse(init: { ok: boolean; status: number; statusText: string; body?: unknown }) {
    const build = (): any => ({
        ok: init.ok,
        status: init.status,
        statusText: init.statusText,
        headers: { get: (_: string) => null },
        json: async () => init.body,
        clone: () => build(),
    });
    return Promise.resolve(build());
}

function okJson(body: unknown) {
    return fakeResponse({ ok: true, status: 200, statusText: 'OK', body });
}

function errorJson(status: number, statusText: string, body?: unknown) {
    return fakeResponse({ ok: false, status, statusText, body });
}

const MINT_INPUT = {
    returnUrl: 'https://meet.erp71.com/api/auth/erp71/callback',
    codeChallenge: 'challenge-abc',
    state: 'state-xyz',
};

beforeEach(() => {
    jest.clearAllMocks();
    resetSessionRenewalForTests();
    localStorage.clear();
    sessionStorage.clear();
    resetWorkspaceBootstrapForTests();
});

describe('mintMeet71SsoCode', () => {
    it('mintMeet71SsoCode does not call handleExpiredSession on 401', async () => {
        localStorage.setItem('access_token', 'stale-token');
        localStorage.setItem('refresh_token', 'refresh-abc');
        mockFetch
            .mockReturnValueOnce(errorJson(401, 'Unauthorized', { error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } }))
            .mockReturnValueOnce(errorJson(401, 'Unauthorized', { error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } }));

        const result = await mintMeet71SsoCode(MINT_INPUT);

        expect(result).toEqual({ ok: false, reason: 'unauthenticated' });
        expect(handleExpiredSession).not.toHaveBeenCalled();
        expect(handleMissingSession).not.toHaveBeenCalled();
    });

    it('does not call handleMissingSession when there is no stored session', async () => {
        const result = await mintMeet71SsoCode(MINT_INPUT);

        expect(result).toEqual({ ok: false, reason: 'unauthenticated' });
        expect(mockFetch).not.toHaveBeenCalled();
        expect(handleMissingSession).not.toHaveBeenCalled();
        expect(handleExpiredSession).not.toHaveBeenCalled();
    });

    it('sends Authorization and no x-tenant-id or x-store-id', async () => {
        localStorage.setItem('access_token', 'app-jwt');
        sessionStorage.setItem('tenant_id', 'tenant-abc');
        sessionStorage.setItem('store_id', 'store-xyz');
        mockFetch.mockReturnValueOnce(okJson({ data: { code: 'minted-code' } }));

        const result = await mintMeet71SsoCode(MINT_INPUT);

        expect(result).toEqual({ ok: true, code: 'minted-code' });
        expect(mockFetch).toHaveBeenCalledTimes(1);
        const [url, opts] = mockFetch.mock.calls[0];
        expect(String(url)).toContain('/meet71/sso/code');
        const headers: Headers = opts.headers;
        expect(headers.get('Authorization')).toBe('Bearer app-jwt');
        expect(headers.get('x-tenant-id')).toBeNull();
        expect(headers.get('x-store-id')).toBeNull();
        expect(opts.method).toBe('POST');
        expect(JSON.parse(opts.body)).toEqual({
            return_url: MINT_INPUT.returnUrl,
            code_challenge: MINT_INPUT.codeChallenge,
            code_challenge_method: 'S256',
            state: MINT_INPUT.state,
        });
    });

    it('maps 403 MEET71_NOT_ALLOWED without tearing down the ERP71 session', async () => {
        localStorage.setItem('access_token', 'app-jwt');
        mockFetch.mockReturnValueOnce(
            errorJson(403, 'Forbidden', {
                error: { code: 'MEET71_NOT_ALLOWED', message: 'This account is not on the Meet71 list.' },
            }),
        );

        const result = await mintMeet71SsoCode(MINT_INPUT);

        expect(result).toEqual({ ok: false, reason: 'not-allowed' });
        expect(handleExpiredSession).not.toHaveBeenCalled();
        expect(handleMissingSession).not.toHaveBeenCalled();
    });

    it('maps 403 PASSWORD_CHANGE_REQUIRED without tearing down the ERP71 session', async () => {
        localStorage.setItem('access_token', 'app-jwt');
        mockFetch.mockReturnValueOnce(
            errorJson(403, 'Forbidden', {
                error: { code: 'PASSWORD_CHANGE_REQUIRED', message: 'Please change your password.' },
            }),
        );

        const result = await mintMeet71SsoCode(MINT_INPUT);

        expect(result).toEqual({ ok: false, reason: 'password-change-required' });
        expect(handleExpiredSession).not.toHaveBeenCalled();
    });

    it('retries once after a 401 when renewal succeeds', async () => {
        localStorage.setItem('access_token', 'stale-token');
        localStorage.setItem('refresh_token', 'refresh-abc');
        mockFetch
            .mockReturnValueOnce(errorJson(401, 'Unauthorized'))
            .mockReturnValueOnce(okJson({ data: { access_token: 'fresh-token', refresh_token: 'fresh-refresh', expires_in: 3600 } }))
            .mockReturnValueOnce(okJson({ data: { code: 'after-renew' } }));

        const result = await mintMeet71SsoCode(MINT_INPUT);

        expect(result).toEqual({ ok: true, code: 'after-renew' });
        expect(handleExpiredSession).not.toHaveBeenCalled();
        const mintCalls = mockFetch.mock.calls.filter(([url]) => String(url).includes('/meet71/sso/code'));
        expect(mintCalls).toHaveLength(2);
        const retryHeaders: Headers = mintCalls[1][1].headers;
        expect(retryHeaders.get('Authorization')).toBe('Bearer fresh-token');
        expect(retryHeaders.get('x-tenant-id')).toBeNull();
    });
});
