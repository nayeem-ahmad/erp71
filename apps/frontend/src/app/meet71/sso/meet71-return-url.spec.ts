import {
    assertMeet71CallbackUrl,
    meet71BounceAfterMint,
    meet71BounceWithoutSession,
    meet71NoneUrl,
} from './meet71-return-url';

const ALLOWED = 'https://meet.erp71.com';
const CALLBACK = 'https://meet.erp71.com/api/auth/erp71/callback';

describe('assertMeet71CallbackUrl', () => {
    it('assertMeet71CallbackUrl accepts https://meet.erp71.com/api/auth/erp71/callback', () => {
        expect(assertMeet71CallbackUrl(CALLBACK, ALLOWED)).toBe(CALLBACK);
    });

    it('rejects https://evil.com/api/auth/erp71/callback', () => {
        expect(assertMeet71CallbackUrl('https://evil.com/api/auth/erp71/callback', ALLOWED)).toBeNull();
    });

    it('rejects https://meet.erp71.com.evil.com/api/auth/erp71/callback', () => {
        expect(
            assertMeet71CallbackUrl('https://meet.erp71.com.evil.com/api/auth/erp71/callback', ALLOWED),
        ).toBeNull();
    });

    it('rejects https://meet.erp71.com/', () => {
        expect(assertMeet71CallbackUrl('https://meet.erp71.com/', ALLOWED)).toBeNull();
    });

    it('rejects a callback path other than /api/auth/erp71/callback', () => {
        expect(assertMeet71CallbackUrl('https://meet.erp71.com/phpmyadmin', ALLOWED)).toBeNull();
        expect(assertMeet71CallbackUrl('https://meet.erp71.com/api/auth/erp71/callback/extra', ALLOWED)).toBeNull();
    });

    it('rejects a non-URL string', () => {
        expect(assertMeet71CallbackUrl('not-a-url', ALLOWED)).toBeNull();
        expect(assertMeet71CallbackUrl('/api/auth/erp71/callback', ALLOWED)).toBeNull();
    });
});

describe('meet71BounceWithoutSession', () => {
    it('prompt=none with no token goes to the hardcoded origin /?sso=none, never query return_url', () => {
        const dest = meet71BounceWithoutSession('none', ALLOWED);
        expect(dest).toEqual({ kind: 'meet71', url: 'https://meet.erp71.com/?sso=none' });
        expect(dest.kind === 'meet71' && dest.url).not.toContain('evil');
        expect(meet71NoneUrl(ALLOWED)).toBe('https://meet.erp71.com/?sso=none');
    });

    it('prompt=login with no token sends the browser to ERP71 login', () => {
        expect(meet71BounceWithoutSession('login', ALLOWED)).toEqual({ kind: 'login' });
    });
});

describe('meet71BounceAfterMint', () => {
    const state = 'st-1';

    it('mint 200 redirects to the asserted callback with code and state', () => {
        const dest = meet71BounceAfterMint({
            prompt: 'none',
            result: { ok: true, code: 'abc123' },
            returnUrl: CALLBACK,
            state,
            allowedOrigin: ALLOWED,
        });
        expect(dest).toEqual({
            kind: 'meet71',
            url: 'https://meet.erp71.com/api/auth/erp71/callback?code=abc123&state=st-1',
        });
    });

    it('mint 200 with an evil return_url goes to /?sso=none, not the query value', () => {
        const dest = meet71BounceAfterMint({
            prompt: 'none',
            result: { ok: true, code: 'abc123' },
            returnUrl: 'https://evil.com/api/auth/erp71/callback',
            state,
            allowedOrigin: ALLOWED,
        });
        expect(dest).toEqual({ kind: 'meet71', url: 'https://meet.erp71.com/?sso=none' });
    });

    it('mint 401 goes to /?sso=none on the allowed origin', () => {
        const dest = meet71BounceAfterMint({
            prompt: 'none',
            result: { ok: false, reason: 'unauthenticated' },
            returnUrl: CALLBACK,
            state,
            allowedOrigin: ALLOWED,
        });
        expect(dest).toEqual({ kind: 'meet71', url: 'https://meet.erp71.com/?sso=none' });
    });

    it('mint 403 MEET71_NOT_ALLOWED goes to /?error=not-allowed', () => {
        const dest = meet71BounceAfterMint({
            prompt: 'none',
            result: { ok: false, reason: 'not-allowed' },
            returnUrl: CALLBACK,
            state,
            allowedOrigin: ALLOWED,
        });
        expect(dest).toEqual({ kind: 'meet71', url: 'https://meet.erp71.com/?error=not-allowed' });
    });

    it('mint 403 PASSWORD_CHANGE_REQUIRED on prompt=none goes to /?sso=none', () => {
        const dest = meet71BounceAfterMint({
            prompt: 'none',
            result: { ok: false, reason: 'password-change-required' },
            returnUrl: CALLBACK,
            state,
            allowedOrigin: ALLOWED,
        });
        expect(dest).toEqual({ kind: 'meet71', url: 'https://meet.erp71.com/?sso=none' });
    });

    it('mint 403 PASSWORD_CHANGE_REQUIRED on prompt=login sends them through /login', () => {
        const dest = meet71BounceAfterMint({
            prompt: 'login',
            result: { ok: false, reason: 'password-change-required' },
            returnUrl: CALLBACK,
            state,
            allowedOrigin: ALLOWED,
        });
        expect(dest).toEqual({ kind: 'login' });
    });
});
