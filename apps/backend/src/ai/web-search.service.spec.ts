import { lookup as dnsLookup } from 'node:dns/promises';
import { WebSearchService, WebToolRefusal } from './web-search.service';

// Resolution is the SSRF boundary, so the tests drive it directly rather than
// depending on what a real hostname happens to resolve to today.
jest.mock('node:dns/promises', () => ({ lookup: jest.fn() }));
const lookup = dnsLookup as jest.Mock;

const PUBLIC_IP = [{ address: '93.184.216.34', family: 4 }];

function makeService(
    settings: Record<string, string | null> = {},
    searchReply: { text?: string; citations?: Array<{ url: string; title: string; content: string }> } = {},
) {
    const db: any = { aiUsageLog: { count: jest.fn().mockResolvedValue(0) } };

    const ai: any = {
        getWebSearchModel: jest.fn().mockResolvedValue('anthropic/claude-haiku-4.5'),
        logUsage: jest.fn().mockResolvedValue(2),
        callOpenRouterWithWebSearch: jest.fn().mockResolvedValue({
            text: searchReply.text ?? 'Coarse rice averaged ৳58/kg in Dhaka in July 2026.',
            citations:
                searchReply.citations ??
                [{ url: 'https://tbsnews.net/rice', title: 'Rice prices hold steady', content: 'Coarse rice ৳58/kg.' }],
            usage: { prompt_tokens: 800, completion_tokens: 200, total_tokens: 1000 },
        }),
    };

const timezones: any = {
    for: jest.fn(async () => 'Asia/Dhaka'),
    forMany: jest.fn(async (ids: string[]) => new Map(ids.map((id) => [id, 'Asia/Dhaka']))),
    prime: jest.fn(),
    invalidate: jest.fn(),
};

    const platformSettings: any = {
        getRawValue: jest.fn((_group: string, key: string) => Promise.resolve(settings[key] ?? null)),
    };

    return { service: new WebSearchService(db, ai, platformSettings, timezones), db, ai, platformSettings };
}

/** A real Response so the service's own stream reading is exercised. */
function htmlResponse(html: string, contentType = 'text/html; charset=utf-8') {
    return new Response(html, { status: 200, headers: { 'content-type': contentType } });
}

beforeEach(() => {
    lookup.mockReset();
    lookup.mockResolvedValue(PUBLIC_IP);
});

afterEach(() => {
    jest.restoreAllMocks();
});

describe('isEnabled', () => {
    it('is off unless explicitly turned on', async () => {
        const { service } = makeService();
        await expect(service.isEnabled()).resolves.toBe(false);
    });

    it('is on for the string "true"', async () => {
        const { service } = makeService({ web_search_enabled: 'true' });
        await expect(service.isEnabled()).resolves.toBe(true);
    });
});

describe('search', () => {
    /**
     * The condition check that keeps web access from firing on internal-data
     * questions. It must refuse *before* the model call, because the refusal's
     * entire purpose is to not spend a search fee answering something the report
     * tools already answer.
     */
    it.each([
        'our sales last month',
        'my top customers',
        'what is our stock of rice',
        'how much due do we have',
    ])('refuses "%s" without spending a search', async (query) => {
        const { service, ai } = makeService();

        await expect(service.search('tenant-1', query)).rejects.toBeInstanceOf(WebToolRefusal);
        expect(ai.callOpenRouterWithWebSearch).not.toHaveBeenCalled();
        expect(ai.logUsage).not.toHaveBeenCalled();
    });

    it('tells the model what to do instead of searching', async () => {
        const { service } = makeService();

        await expect(service.search('tenant-1', 'our revenue this week')).rejects.toThrow(
            /internal report tools/i,
        );
    });

    /**
     * The mirror of the case above: a genuinely external question about the same
     * subject matter must still get through, or the guard has eaten the feature.
     */
    it.each([
        'wholesale rice price Bangladesh July 2026',
        'NBR VAT rate on packaged food 2026',
        'Nestle Bangladesh distributor margin',
        'USD to BDT exchange rate',
    ])('allows "%s"', async (query) => {
        const { service, ai } = makeService();

        const { result } = await service.search('tenant-1', query);

        expect(ai.callOpenRouterWithWebSearch).toHaveBeenCalledTimes(1);
        expect(result.sources).toHaveLength(1);
    });

    it('rejects a query too short to search', async () => {
        const { service, ai } = makeService();

        await expect(service.search('tenant-1', 'x')).rejects.toBeInstanceOf(WebToolRefusal);
        expect(ai.callOpenRouterWithWebSearch).not.toHaveBeenCalled();
    });

    it('returns the citations as sources and excerpts, and bills the call', async () => {
        const { service, ai } = makeService();

        const { result, creditsUsed } = await service.search('tenant-1', 'rice price Bangladesh');

        expect(result.sources).toEqual([{ url: 'https://tbsnews.net/rice', title: 'Rice prices hold steady' }]);
        expect(result.excerpts[0].url).toBe('https://tbsnews.net/rice');
        expect(ai.logUsage).toHaveBeenCalledWith('tenant-1', 'web_search', 'anthropic/claude-haiku-4.5', expect.anything());
        expect(creditsUsed).toBe(2);
    });

    /**
     * An uncited summary is the model's own recall dressed up as research, which is
     * exactly what web search was added to avoid. It comes back flagged.
     */
    it('marks an uncited answer as unverified', async () => {
        const { service } = makeService({}, { citations: [] });

        const { result } = await service.search('tenant-1', 'rice price Bangladesh');

        expect(result.sources).toEqual([]);
        expect(result.note).toMatch(/unverified/i);
    });

    it('passes the configured engine and result count to the plugin', async () => {
        const { service, ai } = makeService({ web_search_engine: 'parallel', web_search_max_results: '8' });

        await service.search('tenant-1', 'rice price Bangladesh');

        expect(ai.callOpenRouterWithWebSearch).toHaveBeenCalledWith(
            'anthropic/claude-haiku-4.5',
            'rice price Bangladesh',
            expect.objectContaining({ engine: 'parallel', maxResults: 8 }),
            expect.any(Number),
        );
    });

    it('clamps an out-of-range result count to what the engine bills for', async () => {
        const { service, ai } = makeService({ web_search_max_results: '400' });

        await service.search('tenant-1', 'rice price Bangladesh');

        expect(ai.callOpenRouterWithWebSearch).toHaveBeenCalledWith(
            expect.anything(),
            expect.anything(),
            expect.objectContaining({ maxResults: 10 }),
            expect.any(Number),
        );
    });

    it('stops searching once the tenant hits its daily cap', async () => {
        const { service, db, ai } = makeService({ web_search_daily_cap: '10' });
        db.aiUsageLog.count.mockResolvedValue(10);

        await expect(service.search('tenant-1', 'rice price Bangladesh')).rejects.toThrow(/10 web searches/);
        expect(ai.callOpenRouterWithWebSearch).not.toHaveBeenCalled();
    });

    it('counts only this tenant\'s searches against the cap', async () => {
        const { service, db } = makeService({ web_search_daily_cap: '10' });

        await service.search('tenant-9', 'rice price Bangladesh');

        expect(db.aiUsageLog.count).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({ tenant_id: 'tenant-9', feature: 'web_search' }),
            }),
        );
    });

    it('treats a cap of 0 as no cap', async () => {
        const { service, db, ai } = makeService({ web_search_daily_cap: '0' });
        db.aiUsageLog.count.mockResolvedValue(9999);

        await service.search('tenant-1', 'rice price Bangladesh');

        expect(ai.callOpenRouterWithWebSearch).toHaveBeenCalled();
    });
});

describe('fetchPage', () => {
    const ALLOWED = 'https://nbr.gov.bd/vat-rates';

    /**
     * The allow-list is what separates "read the page you found" from "issue an
     * arbitrary HTTP request from inside production on the model's say-so".
     */
    it('refuses a URL nothing vouched for', async () => {
        const { service } = makeService();
        const fetchSpy = jest.spyOn(global, 'fetch');

        await expect(service.fetchPage('https://evil.test/x', new Set([ALLOWED]))).rejects.toBeInstanceOf(
            WebToolRefusal,
        );
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it.each([
        ['file:///etc/passwd', 'a non-web scheme'],
        ['https://example.com:8080/x', 'a non-standard port'],
    ])('refuses %s (%s) even when allow-listed', async (url) => {
        const { service } = makeService();
        const fetchSpy = jest.spyOn(global, 'fetch');
        // Allow-list it explicitly: the scheme and port checks must stand on their
        // own, not lean on the allow-list happening to exclude such URLs.
        const allowed = new Set([service.normalizeUrl(url)]);

        await expect(service.fetchPage(url, allowed)).rejects.toBeInstanceOf(WebToolRefusal);
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    /**
     * 169.254.169.254 is the cloud metadata endpoint. A page fetch that reaches it
     * is a credential leak, so a hostname resolving there must be refused before
     * any request goes out.
     */
    it.each([
        ['169.254.169.254', 'cloud metadata'],
        ['127.0.0.1', 'loopback'],
        ['10.1.2.3', 'private'],
        ['100.64.0.1', 'carrier-grade NAT'],
        ['::1', 'IPv6 loopback'],
        ['::ffff:10.0.0.1', 'IPv4-mapped private'],
    ])('refuses a host resolving to %s (%s)', async (address) => {
        const { service } = makeService();
        lookup.mockResolvedValue([{ address, family: address.includes(':') ? 6 : 4 }]);
        const fetchSpy = jest.spyOn(global, 'fetch');

        await expect(service.fetchPage(ALLOWED, new Set([ALLOWED]))).rejects.toThrow(/private network/i);
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('refuses a host with one public and one internal address', async () => {
        const { service } = makeService();
        lookup.mockResolvedValue([...PUBLIC_IP, { address: '127.0.0.1', family: 4 }]);

        await expect(service.fetchPage(ALLOWED, new Set([ALLOWED]))).rejects.toThrow(/private network/i);
    });

    it('reads a public page down to text', async () => {
        const { service } = makeService();
        jest.spyOn(global, 'fetch').mockResolvedValue(
            htmlResponse(
                `<html><head><title>VAT rates &amp; rules</title><style>body{color:red}</style></head>
                 <body><nav>Skip me</nav><script>track()</script>
                 <h1>VAT</h1><p>The standard rate is 15%.</p><p>Reduced rate is 7.5%.</p></body></html>`,
            ),
        );

        const page = await service.fetchPage(ALLOWED, new Set([ALLOWED]));

        expect(page.title).toBe('VAT rates & rules');
        expect(page.text).toContain('The standard rate is 15%.');
        expect(page.text).toContain('Reduced rate is 7.5%.');
        // Chrome, scripts and styles are not prose and would crowd out the page.
        expect(page.text).not.toContain('Skip me');
        expect(page.text).not.toContain('track()');
        expect(page.text).not.toContain('color:red');
        expect(page.truncated).toBe(false);
    });

    it('flags a page it had to cut short', async () => {
        const { service } = makeService();
        jest.spyOn(global, 'fetch').mockResolvedValue(htmlResponse(`<p>${'rice '.repeat(4000)}</p>`));

        const page = await service.fetchPage(ALLOWED, new Set([ALLOWED]));

        expect(page.truncated).toBe(true);
        expect(page.text.endsWith('…')).toBe(true);
    });

    it('refuses a page that is not text', async () => {
        const { service } = makeService();
        jest.spyOn(global, 'fetch').mockResolvedValue(
            new Response('%PDF-1.7', { status: 200, headers: { 'content-type': 'application/pdf' } }),
        );

        await expect(service.fetchPage(ALLOWED, new Set([ALLOWED]))).rejects.toThrow(/cannot be read as text/i);
    });

    it('reports an HTTP error rather than inventing content', async () => {
        const { service } = makeService();
        jest.spyOn(global, 'fetch').mockResolvedValue(new Response('nope', { status: 404 }));

        await expect(service.fetchPage(ALLOWED, new Set([ALLOWED]))).rejects.toThrow(/HTTP 404/);
    });

    it('says so when a page has no readable text', async () => {
        const { service } = makeService();
        jest.spyOn(global, 'fetch').mockResolvedValue(htmlResponse('<html><body><div id="app"></div></body></html>'));

        await expect(service.fetchPage(ALLOWED, new Set([ALLOWED]))).rejects.toThrow(/JavaScript/i);
    });

    /**
     * A redirect target was chosen by the page, not by the search that vouched for
     * the original URL, so it gets the same address check rather than a free pass.
     */
    it('re-validates the address after a redirect', async () => {
        const { service } = makeService();
        lookup
            .mockResolvedValueOnce(PUBLIC_IP)
            .mockResolvedValueOnce([{ address: '169.254.169.254', family: 4 }]);
        const fetchSpy = jest
            .spyOn(global, 'fetch')
            .mockResolvedValueOnce(
                new Response(null, { status: 302, headers: { location: 'https://internal.test/meta' } }),
            );

        await expect(service.fetchPage(ALLOWED, new Set([ALLOWED]))).rejects.toThrow(/private network/i);
        expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('follows a redirect that stays public', async () => {
        const { service } = makeService();
        jest.spyOn(global, 'fetch')
            .mockResolvedValueOnce(
                new Response(null, { status: 301, headers: { location: '/vat-rates-2026' } }),
            )
            .mockResolvedValueOnce(htmlResponse('<p>The standard rate is 15%.</p>'));

        const page = await service.fetchPage(ALLOWED, new Set([ALLOWED]));

        expect(page.url).toBe('https://nbr.gov.bd/vat-rates-2026');
        expect(page.text).toContain('15%');
    });

    it('gives up on a redirect loop', async () => {
        const { service } = makeService();
        jest.spyOn(global, 'fetch').mockResolvedValue(
            new Response(null, { status: 302, headers: { location: 'https://nbr.gov.bd/loop' } }),
        );

        await expect(service.fetchPage(ALLOWED, new Set([ALLOWED]))).rejects.toThrow(/redirected more than/);
    });
});

describe('normalizeUrl', () => {
    /**
     * Canonicalising before the allow-list check is what stops two spellings of one
     * URL from being usable to smuggle a third past it — and lets a model that
     * retypes a URL with a tracking parameter still match what search returned.
     */
    it('strips tracking parameters and fragments', () => {
        const { service } = makeService();

        expect(service.normalizeUrl('https://a.test/p?utm_source=x&id=7#top')).toBe('https://a.test/p?id=7');
    });

    it('treats a bare host with and without a trailing slash as one URL', () => {
        const { service } = makeService();

        expect(service.normalizeUrl('https://a.test/')).toBe(service.normalizeUrl('https://a.test'));
    });

    it('refuses something that is not a URL', () => {
        const { service } = makeService();

        expect(() => service.normalizeUrl('not a url')).toThrow(WebToolRefusal);
    });
});

describe('extractUrls', () => {
    it('picks links out of a user message and drops trailing punctuation', () => {
        const { service } = makeService();

        expect(service.extractUrls('See https://nbr.gov.bd/vat, and http://a.test/b.')).toEqual([
            'https://nbr.gov.bd/vat',
            'http://a.test/b',
        ]);
    });

    it('returns nothing for a message with no links', () => {
        const { service } = makeService();

        expect(service.extractUrls('what were sales yesterday')).toEqual([]);
    });
});
