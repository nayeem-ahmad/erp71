import {
    APP_ENTRY_PATH,
    classifyHost,
    isAppOnlyPath,
    normalizeHostname,
    readDomainConfig,
    resolveHostRoute,
    siteOrigin,
    type DomainConfig,
} from './domain-routing';

const CONFIGURED: DomainConfig = {
    marketingOrigin: 'https://erp71.com',
    appOrigin: 'https://app.erp71.com',
};

/** Before the marketing domain exists — the state every dev machine is in. */
const UNCONFIGURED: DomainConfig = {
    marketingOrigin: null,
    appOrigin: 'https://app.erp71.com',
};

describe('normalizeHostname', () => {
    it('reduces an origin, a port and a trailing dot to a bare hostname', () => {
        expect(normalizeHostname('https://ERP71.com/')).toBe('erp71.com');
        expect(normalizeHostname('app.erp71.com:3000')).toBe('app.erp71.com');
        expect(normalizeHostname('erp71.com.')).toBe('erp71.com');
        expect(normalizeHostname('  www.erp71.com  ')).toBe('www.erp71.com');
    });

    it('is empty for nothing', () => {
        expect(normalizeHostname(undefined)).toBe('');
        expect(normalizeHostname('')).toBe('');
    });
});

describe('isAppOnlyPath', () => {
    it('claims the signed-in pages', () => {
        expect(isAppOnlyPath('/dashboard')).toBe(true);
        expect(isAppOnlyPath('/sales/pos')).toBe(true);
        expect(isAppOnlyPath('/admin/tenants/ledger')).toBe(true);
    });

    it('claims the auth flows, which write credentials into the origin', () => {
        for (const path of ['/login', '/signup', '/demo', '/select-account', '/verify-email']) {
            expect(isAppOnlyPath(path)).toBe(true);
        }
    });

    it('leaves the marketing and public pages alone', () => {
        for (const path of ['/', '/pricing', '/blog', '/blog/some-post', '/contact', '/terms']) {
            expect(isAppOnlyPath(path)).toBe(false);
        }
    });

    it('leaves the public storefront and the shortener alone', () => {
        expect(isAppOnlyPath('/store/rahim-electronics')).toBe(false);
        expect(isAppOnlyPath('/q/abc123')).toBe(false);
        expect(isAppOnlyPath('/s/xyz')).toBe(false);
        expect(isAppOnlyPath('/r/RAHMA1B2C3')).toBe(false);
    });

    it('matches whole segments, so /storefront never swallows /store', () => {
        // The app's storefront admin and a shop's public storefront share a
        // prefix; a plain startsWith would move customers onto the app host.
        expect(isAppOnlyPath('/storefront')).toBe(true);
        expect(isAppOnlyPath('/store')).toBe(false);
        expect(isAppOnlyPath('/storeroom')).toBe(false);
    });
});

describe('classifyHost', () => {
    it('recognises both halves of the marketing pair and the app host', () => {
        expect(classifyHost('erp71.com', CONFIGURED)).toBe('marketing');
        expect(classifyHost('www.erp71.com', CONFIGURED)).toBe('marketing');
        expect(classifyHost('app.erp71.com', CONFIGURED)).toBe('app');
    });

    it('recognises the pair the same way when www is the canonical one', () => {
        const wwwCanonical: DomainConfig = { ...CONFIGURED, marketingOrigin: 'https://www.erp71.com' };
        expect(classifyHost('www.erp71.com', wwwCanonical)).toBe('marketing');
        expect(classifyHost('erp71.com', wwwCanonical)).toBe('marketing');
    });

    it('knows nothing about localhost, previews or other hosts', () => {
        expect(classifyHost('localhost:3000', CONFIGURED)).toBe('unknown');
        expect(classifyHost('staging.erp71.com', CONFIGURED)).toBe('unknown');
        expect(classifyHost('66.116.236.127', CONFIGURED)).toBe('unknown');
    });

    it('is inert until a marketing origin is configured', () => {
        expect(classifyHost('app.erp71.com', UNCONFIGURED)).toBe('unknown');
        expect(classifyHost('erp71.com', UNCONFIGURED)).toBe('unknown');
    });

    it('is inert when both origins are the same host', () => {
        // A misconfiguration degrades to single-domain behaviour rather than to
        // a redirect loop between a host and itself.
        const collapsed: DomainConfig = {
            marketingOrigin: 'https://app.erp71.com',
            appOrigin: 'https://app.erp71.com',
        };
        expect(classifyHost('app.erp71.com', collapsed)).toBe('unknown');
    });
});

describe('resolveHostRoute', () => {
    describe('on the marketing host', () => {
        it('serves the marketing pages itself', () => {
            for (const pathname of ['/', '/pricing', '/blog/inventory-tips', '/terms']) {
                expect(resolveHostRoute({ hostname: 'erp71.com', pathname }, CONFIGURED))
                    .toEqual({ kind: 'pass' });
            }
        });

        it('moves app paths to the app host, query and all', () => {
            expect(resolveHostRoute(
                { hostname: 'erp71.com', pathname: '/login', search: '?redirect=%2Fsales' },
                CONFIGURED,
            )).toEqual({
                kind: 'redirect',
                url: 'https://app.erp71.com/login?redirect=%2Fsales',
                status: 308,
            });
        });

        it('moves an app path off www in one hop rather than via the apex', () => {
            expect(resolveHostRoute({ hostname: 'www.erp71.com', pathname: '/dashboard' }, CONFIGURED))
                .toEqual({ kind: 'redirect', url: 'https://app.erp71.com/dashboard', status: 308 });
        });

        it('folds www into the canonical marketing host', () => {
            expect(resolveHostRoute(
                { hostname: 'www.erp71.com', pathname: '/pricing', search: '?plan=growth' },
                CONFIGURED,
            )).toEqual({ kind: 'redirect', url: 'https://erp71.com/pricing?plan=growth', status: 308 });
        });

        it('folds the apex into www when www is the canonical one', () => {
            const wwwCanonical: DomainConfig = { ...CONFIGURED, marketingOrigin: 'https://www.erp71.com' };
            expect(resolveHostRoute({ hostname: 'erp71.com', pathname: '/' }, wwwCanonical))
                .toEqual({ kind: 'redirect', url: 'https://www.erp71.com/', status: 308 });
        });
    });

    describe('on the app host', () => {
        it('rewrites the front door to the session gate, keeping the URL at /', () => {
            expect(resolveHostRoute({ hostname: 'app.erp71.com', pathname: '/' }, CONFIGURED))
                .toEqual({ kind: 'rewrite', pathname: APP_ENTRY_PATH });
        });

        it('serves every other path unchanged', () => {
            for (const pathname of ['/dashboard', '/login', '/pricing', '/store/rahim-electronics']) {
                expect(resolveHostRoute({ hostname: 'app.erp71.com', pathname }, CONFIGURED))
                    .toEqual({ kind: 'pass' });
            }
        });
    });

    describe('everywhere else', () => {
        it('passes localhost through, marketing homepage included', () => {
            expect(resolveHostRoute({ hostname: 'localhost:3000', pathname: '/' }, CONFIGURED))
                .toEqual({ kind: 'pass' });
            expect(resolveHostRoute({ hostname: 'localhost:3000', pathname: '/dashboard' }, CONFIGURED))
                .toEqual({ kind: 'pass' });
        });

        it('passes everything through while the marketing domain is unconfigured', () => {
            for (const hostname of ['app.erp71.com', 'erp71.com', 'www.erp71.com']) {
                expect(resolveHostRoute({ hostname, pathname: '/' }, UNCONFIGURED))
                    .toEqual({ kind: 'pass' });
            }
        });
    });
});

describe('readDomainConfig', () => {
    const original = {
        marketing: process.env.NEXT_PUBLIC_MARKETING_URL,
        app: process.env.NEXT_PUBLIC_APP_URL,
    };

    afterEach(() => {
        process.env.NEXT_PUBLIC_MARKETING_URL = original.marketing;
        process.env.NEXT_PUBLIC_APP_URL = original.app;
    });

    it('is unconfigured until the marketing origin is named', () => {
        delete process.env.NEXT_PUBLIC_MARKETING_URL;
        delete process.env.NEXT_PUBLIC_APP_URL;
        expect(readDomainConfig()).toEqual({
            marketingOrigin: null,
            appOrigin: 'https://app.erp71.com',
        });
    });

    it('trims trailing slashes so joined paths never double up', () => {
        process.env.NEXT_PUBLIC_MARKETING_URL = 'https://erp71.com/';
        process.env.NEXT_PUBLIC_APP_URL = 'https://app.erp71.com/';
        expect(readDomainConfig()).toEqual({
            marketingOrigin: 'https://erp71.com',
            appOrigin: 'https://app.erp71.com',
        });
    });
});

describe('siteOrigin', () => {
    const original = {
        marketing: process.env.NEXT_PUBLIC_MARKETING_URL,
        site: process.env.NEXT_PUBLIC_SITE_URL,
        app: process.env.NEXT_PUBLIC_APP_URL,
    };

    beforeEach(() => {
        delete process.env.NEXT_PUBLIC_MARKETING_URL;
        delete process.env.NEXT_PUBLIC_SITE_URL;
        delete process.env.NEXT_PUBLIC_APP_URL;
    });

    afterEach(() => {
        process.env.NEXT_PUBLIC_MARKETING_URL = original.marketing;
        process.env.NEXT_PUBLIC_SITE_URL = original.site;
        process.env.NEXT_PUBLIC_APP_URL = original.app;
    });

    it('prefers the marketing origin — canonical URLs belong to the public site', () => {
        process.env.NEXT_PUBLIC_MARKETING_URL = 'https://erp71.com';
        process.env.NEXT_PUBLIC_SITE_URL = 'https://app.erp71.com';
        expect(siteOrigin()).toBe('https://erp71.com');
    });

    it('falls back to the site then the app origin', () => {
        process.env.NEXT_PUBLIC_SITE_URL = 'https://app.erp71.com/';
        expect(siteOrigin()).toBe('https://app.erp71.com');

        delete process.env.NEXT_PUBLIC_SITE_URL;
        process.env.NEXT_PUBLIC_APP_URL = 'https://app.erp71.com';
        expect(siteOrigin()).toBe('https://app.erp71.com');
    });

    it('keeps the single-domain default when nothing is configured', () => {
        expect(siteOrigin()).toBe('https://app.erp71.com');
    });
});
