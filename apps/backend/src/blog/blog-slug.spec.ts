import { RESERVED_SLUGS, resolveSlug, slugify } from './blog-slug';

describe('slugify', () => {
    it('lowercases and hyphenates a title', () => {
        expect(slugify('Five Ways to Cut Stock Loss')).toBe('five-ways-to-cut-stock-loss');
    });

    it('folds accents rather than dropping the letters', () => {
        expect(slugify('Café culture')).toBe('cafe-culture');
    });

    it('drops apostrophes instead of turning them into hyphens', () => {
        expect(slugify("A shop owner's guide")).toBe('a-shop-owners-guide');
    });

    it('collapses runs of punctuation and trims the edges', () => {
        expect(slugify('  --Hello,   World!!  ')).toBe('hello-world');
    });

    it('returns empty for a title with no ASCII, leaving the caller to fall back', () => {
        // Transliterating Bangla badly produces worse slugs than an explicit
        // fallback, so this deliberately does not try.
        expect(slugify('বাংলা শিরোনাম')).toBe('');
    });

    it('truncates on a word boundary rather than mid-word', () => {
        const slug = slugify('a'.repeat(30) + ' ' + 'b'.repeat(30) + ' ' + 'c'.repeat(40));
        expect(slug.length).toBeLessThanOrEqual(80);
        expect(slug.endsWith('-')).toBe(false);
        expect(slug).toBe('a'.repeat(30) + '-' + 'b'.repeat(30));
    });
});

describe('resolveSlug', () => {
    it('returns the derived slug when nothing has claimed it', () => {
        expect(resolveSlug('Stock Loss', [])).toBe('stock-loss');
    });

    it('numbers collisions rather than randomising them', () => {
        expect(resolveSlug('Stock Loss', ['stock-loss'])).toBe('stock-loss-2');
        expect(resolveSlug('Stock Loss', ['stock-loss', 'stock-loss-2'])).toBe('stock-loss-3');
    });

    it('uses the fallback when the title yields no slug at all', () => {
        expect(resolveSlug('বাংলা', [], 'post')).toBe('post');
        expect(resolveSlug('বাংলা', ['post'], 'post')).toBe('post-2');
    });

    it('steps around route segments that would shadow a real page', () => {
        // `/blog/category/<slug>` is a real route; a post slugged `category`
        // would sit on top of it.
        for (const reserved of RESERVED_SLUGS) {
            expect(resolveSlug(reserved, [])).toBe(`${reserved}-post`);
        }
    });

    it('treats historic slugs as taken, so a rename cannot be hijacked', () => {
        // `old-title` belongs to a post that renamed away from it and still
        // redirects from it. Handing it to a new post would send those readers
        // to the wrong article.
        expect(resolveSlug('Old Title', ['old-title'])).toBe('old-title-2');
    });
});
