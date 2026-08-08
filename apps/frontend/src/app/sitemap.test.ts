import sitemap from './sitemap';
import robots from './robots';
import { fetchCategories, fetchPosts } from '@/lib/blog/api';

jest.mock('@/lib/blog/api', () => ({
    ...jest.requireActual('@/lib/blog/api'),
    fetchPosts: jest.fn(),
    fetchCategories: jest.fn(),
}));

const mockFetchPosts = fetchPosts as jest.MockedFunction<typeof fetchPosts>;
const mockFetchCategories = fetchCategories as jest.MockedFunction<typeof fetchCategories>;

describe('sitemap', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockFetchPosts.mockResolvedValue({ rows: [], total: 0, page: 1, limit: 12 });
        mockFetchCategories.mockResolvedValue([]);
    });

    it('lists the marketing and legal pages that previously had no discovery path at all', async () => {
        const entries = await sitemap();
        const paths = entries.map((entry) => new URL(entry.url).pathname);

        expect(paths).toEqual(
            expect.arrayContaining(['/', '/pricing', '/blog', '/contact', '/terms', '/privacy', '/refund', '/sla']),
        );
    });

    it('never lists the routes robots.txt asks crawlers not to fetch', async () => {
        // `/q/` is a customer's quotation and `/s/` redirects into one. Listing
        // either would hand a crawler exactly the URLs robots.txt disallows.
        mockFetchPosts.mockResolvedValue({
            rows: [
                {
                    id: 'p1',
                    slug: 'stock-loss',
                    locale: 'en',
                    title: 'Stock loss',
                    excerpt: null,
                    cover_image_url: null,
                    cover_alt: null,
                    author_name: null,
                    author_title: null,
                    published_at: '2026-08-01T00:00:00.000Z',
                    edited_at: null,
                    reading_minutes: 4,
                    featured: false,
                    category: null,
                    available_locales: ['en'],
                },
            ],
            total: 1,
            page: 1,
            limit: 12,
        });

        const entries = await sitemap();
        const paths = entries.map((entry) => new URL(entry.url).pathname);

        expect(paths.some((path) => path.startsWith('/q/'))).toBe(false);
        expect(paths.some((path) => path.startsWith('/s/'))).toBe(false);

        const disallowed = robots().rules;
        const list = Array.isArray(disallowed) ? disallowed : [disallowed];
        for (const rule of list) {
            for (const entry of ([] as string[]).concat(rule.disallow ?? [])) {
                expect(paths.some((path) => path.startsWith(entry))).toBe(false);
            }
        }
    });

    it('includes published posts and dates them from their own timestamps', async () => {
        mockFetchPosts.mockResolvedValue({
            rows: [
                {
                    id: 'p1',
                    slug: 'stock-loss',
                    locale: 'en',
                    title: 'Stock loss',
                    excerpt: null,
                    cover_image_url: null,
                    cover_alt: null,
                    author_name: null,
                    author_title: null,
                    published_at: '2026-08-01T00:00:00.000Z',
                    edited_at: '2026-08-05T00:00:00.000Z',
                    reading_minutes: 4,
                    featured: true,
                    category: null,
                    available_locales: ['en'],
                },
            ],
            total: 1,
            page: 1,
            limit: 12,
        });

        const entries = await sitemap();
        const post = entries.find((entry) => entry.url.endsWith('/blog/stock-loss'));

        expect(post).toBeDefined();
        // The revision date, not the publish date — that is what "last modified"
        // means to a crawler.
        expect(new Date(post!.lastModified as Date).toISOString()).toBe('2026-08-05T00:00:00.000Z');
    });

    it('includes category pages', async () => {
        mockFetchCategories.mockResolvedValue([
            { id: 'c1', slug: 'guides', name_en: 'Guides', name_bn: null, name_ms: null },
        ]);

        const entries = await sitemap();
        expect(entries.some((entry) => entry.url.endsWith('/blog/category/guides'))).toBe(true);
    });

    it('still serves the static half when the blog API is unreachable', async () => {
        // fetchPosts resolves to an empty list rather than throwing, so a
        // backend outage must not take the whole sitemap down with it.
        mockFetchPosts.mockResolvedValue({ rows: [], total: 0, page: 1, limit: 12 });
        mockFetchCategories.mockResolvedValue([]);

        const entries = await sitemap();
        expect(entries.length).toBeGreaterThanOrEqual(8);
    });
});

describe('robots', () => {
    it('points at the sitemap so it is discoverable without submission', () => {
        expect(robots().sitemap).toMatch(/\/sitemap\.xml$/);
    });

    it('still hides the quotation and shortener routes', () => {
        const rules = robots().rules;
        const rule = Array.isArray(rules) ? rules[0] : rules;
        expect(rule.disallow).toEqual(expect.arrayContaining(['/q/', '/s/']));
    });
});
