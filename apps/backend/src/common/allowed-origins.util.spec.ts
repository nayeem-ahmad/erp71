describe('getAllowedOrigins', () => {
    const env = process.env;

    beforeEach(() => {
        process.env = { ...env };
        delete process.env.FRONTEND_URL;
        delete process.env.BACKEND_PUBLIC_URL;
        delete process.env.ALLOWED_ORIGINS;
        delete process.env.NODE_ENV;
        jest.resetModules();
    });

    afterAll(() => {
        process.env = env;
    });

    async function loadUtil() {
        return import('./allowed-origins.util');
    }

    it('defaults to localhost when no env is set', async () => {
        const { getAllowedOrigins } = await loadUtil();
        expect(getAllowedOrigins()).toEqual(['http://localhost:3000']);
    });

    it('includes FRONTEND_URL and BACKEND_PUBLIC_URL origins', async () => {
        process.env.FRONTEND_URL = 'https://app.erp71.com/dashboard';
        process.env.BACKEND_PUBLIC_URL = 'https://api.erp71.com/api/v1';
        const { getAllowedOrigins } = await loadUtil();
        expect(getAllowedOrigins()).toEqual(
            expect.arrayContaining(['https://app.erp71.com', 'https://api.erp71.com']),
        );
    });

    it('includes migration origins in production', async () => {
        process.env.NODE_ENV = 'production';
        process.env.FRONTEND_URL = 'https://app.nayeemahmad.com';
        const { getAllowedOrigins, isAllowedOrigin } = await loadUtil();
        expect(getAllowedOrigins()).toEqual(
            expect.arrayContaining(['https://app.erp71.com', 'https://app.nayeemahmad.com']),
        );
        expect(isAllowedOrigin('https://app.erp71.com')).toBe(true);
    });

    it('trusts the marketing apex, not just the app host', async () => {
        // The two-domain cutover moved marketing to the apex but left the
        // allowlist naming only `app.`, so the landing page's own call to
        // GET /auth/plans was rejected and its pricing preview fell back to
        // static figures. FRONTEND_URL names one host; the platform serves two.
        process.env.NODE_ENV = 'production';
        process.env.FRONTEND_URL = 'https://app.erp71.com';
        const { isAllowedOrigin } = await loadUtil();
        expect(isAllowedOrigin('https://erp71.com')).toBe(true);
        expect(isAllowedOrigin('https://www.erp71.com')).toBe(true);
    });

    it('does not trust the marketing origins outside production', async () => {
        // The production block is what adds them; a dev box should still be
        // driven by its own env rather than inheriting production hosts.
        process.env.FRONTEND_URL = 'http://localhost:3000';
        const { isAllowedOrigin } = await loadUtil();
        expect(isAllowedOrigin('https://erp71.com')).toBe(false);
    });

    it('rejects a lookalike host that merely ends with the apex', async () => {
        process.env.NODE_ENV = 'production';
        const { isAllowedOrigin } = await loadUtil();
        expect(isAllowedOrigin('https://noterp71.com')).toBe(false);
        expect(isAllowedOrigin('http://erp71.com')).toBe(false);
    });

    it('parses ALLOWED_ORIGINS as a comma-separated list', async () => {
        process.env.ALLOWED_ORIGINS = 'https://staging.example.com,https://preview.example.com/path';
        const { getAllowedOrigins } = await loadUtil();
        expect(getAllowedOrigins()).toEqual(
            expect.arrayContaining(['https://staging.example.com', 'https://preview.example.com']),
        );
    });
});