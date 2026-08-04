import { isSafeTarget } from './is-safe-target';

/**
 * The shortener accepts external URLs, so this function is the only thing
 * standing between a link on our own domain and a credential-harvesting page.
 * The cases below are weighted to hostile input rather than happy paths.
 */
describe('isSafeTarget', () => {
    describe('accepts', () => {
        it('an internal absolute path', () => {
            expect(isSafeTarget('/q/aB3xK9mQ')).toEqual({
                ok: true,
                kind: 'internal',
                url: '/q/aB3xK9mQ',
            });
        });

        it('an internal path with a query string', () => {
            const result = isSafeTarget('/store/acme/shop?category=phones');
            expect(result).toMatchObject({ ok: true, kind: 'internal' });
        });

        it('an https URL', () => {
            expect(isSafeTarget('https://example.com/page')).toMatchObject({
                ok: true,
                kind: 'external',
            });
        });

        it('a plain http URL', () => {
            expect(isSafeTarget('http://example.com')).toMatchObject({
                ok: true,
                kind: 'external',
            });
        });

        it('trims surrounding whitespace before validating', () => {
            expect(isSafeTarget('  https://example.com  ')).toMatchObject({
                ok: true,
                url: 'https://example.com/',
            });
        });
    });

    describe('rejects dangerous schemes', () => {
        it.each([
            'javascript:alert(1)',
            'JavaScript:alert(1)',
            'data:text/html;base64,PHNjcmlwdD4=',
            'file:///etc/passwd',
            'ftp://example.com',
            'vbscript:msgbox(1)',
        ])('%s', (input) => {
            expect(isSafeTarget(input)).toMatchObject({ ok: false });
        });
    });

    describe('rejects protocol-relative URLs', () => {
        // "//evil.com" is a *path* to the naive check and a full URL to a browser.
        it('a bare protocol-relative URL', () => {
            expect(isSafeTarget('//evil.com')).toMatchObject({ ok: false });
        });

        it('a backslash-disguised protocol-relative URL', () => {
            expect(isSafeTarget('/\\evil.com')).toMatchObject({ ok: false });
        });
    });

    describe('rejects private and loopback hosts', () => {
        it.each([
            'http://localhost/admin',
            'http://LOCALHOST/admin',
            'http://127.0.0.1',
            'http://127.1.2.3',
            'http://10.0.0.5',
            'http://172.16.4.9',
            'http://172.31.255.255',
            'http://192.168.1.1',
            'http://169.254.169.254/latest/meta-data',
            'http://[::1]/',
            'http://[fd00::1]/',
            'http://box.local',
            'http://svc.internal',
        ])('%s', (input) => {
            expect(isSafeTarget(input)).toMatchObject({ ok: false });
        });

        it('allows a public address in an adjacent range', () => {
            expect(isSafeTarget('http://172.32.0.1')).toMatchObject({ ok: true });
            expect(isSafeTarget('http://11.0.0.1')).toMatchObject({ ok: true });
        });
    });

    describe('rejects embedded credentials', () => {
        it('a URL with a userinfo section', () => {
            expect(isSafeTarget('https://apple.com@evil.com/')).toMatchObject({ ok: false });
        });
    });

    describe('rejects internal auth paths', () => {
        it.each([
            '/login',
            '/signup',
            '/reset-password?token=x',
            '/verify-email',
            '/accept-invitation',
            '/LOGIN',
        ])('%s', (input) => {
            expect(isSafeTarget(input)).toMatchObject({ ok: false });
        });

        it('allows a path that merely starts with the same letters', () => {
            expect(isSafeTarget('/loginary')).toMatchObject({ ok: true });
        });
    });

    describe('rejects malformed input', () => {
        it.each(['', '   ', 'not a url', 'relative/path'])('%s', (input) => {
            expect(isSafeTarget(input)).toMatchObject({ ok: false });
        });

        it('rejects a target longer than 2048 characters', () => {
            expect(isSafeTarget(`https://example.com/${'a'.repeat(2100)}`)).toMatchObject({
                ok: false,
            });
        });
    });

    it('gives a reason on every rejection', () => {
        const result = isSafeTarget('javascript:alert(1)');
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason.length).toBeGreaterThan(0);
    });

    describe('security regression tests', () => {
        describe('rejects protocol-relative URLs disguised with control characters', () => {
            it.each([
                '/\n/evil.com',
                '/\t/evil.com',
                '/\r/evil.com',
            ])('%s', (input) => {
                expect(isSafeTarget(input)).toMatchObject({ ok: false });
            });
        });

        describe('rejects private hosts in IPv6 forms', () => {
            it.each([
                'http://[::ffff:169.254.169.254]/latest/meta-data',
                'http://[::ffff:127.0.0.1]/',
                'http://[::ffff:192.168.1.1]/',
                'http://[::ffff:10.0.0.1]/',
                'http://[fe80::1]/',
                'http://[fe90::1]/',
                'http://[fea0::1]/',
                'http://[febf::1]/',
                'http://[fd00::1]/',
            ])('%s', (input) => {
                expect(isSafeTarget(input)).toMatchObject({ ok: false });
            });

            it('allows deprecated site-local addresses (fec0::/10 is not in fc00::/7 or fe80::/10)', () => {
                expect(isSafeTarget('http://[fec0::1]/')).toMatchObject({ ok: true });
            });
        });

        describe('rejects percent-encoded auth paths', () => {
            it.each([
                '/%6c%6fgin',
                '/%6C%6Fgin',
                '/%73%69%67%6e%75%70',
            ])('%s', (input) => {
                expect(isSafeTarget(input)).toMatchObject({ ok: false });
            });
        });

        describe('still allows non-auth paths and public hosts', () => {
            it('allows a path that happens to contain blocked-path letters', () => {
                expect(isSafeTarget('/loginary')).toMatchObject({ ok: true });
            });

            it('allows public IPv4 addresses outside private ranges', () => {
                expect(isSafeTarget('http://172.32.0.1')).toMatchObject({ ok: true });
                expect(isSafeTarget('http://11.0.0.1')).toMatchObject({ ok: true });
            });

            it('allows public IPv6 addresses', () => {
                expect(isSafeTarget('http://[2606:4700::1111]/')).toMatchObject({ ok: true });
            });
        });
    });
});
