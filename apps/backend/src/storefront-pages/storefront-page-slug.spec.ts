import { resolvePageSlug } from './storefront-page-slug';

describe('resolvePageSlug', () => {
    it('derives a slug from the title', () => {
        expect(resolvePageSlug('About Us', [])).toBe('about-us');
        expect(resolvePageSlug('Delivery & Returns', [])).toBe('delivery-returns');
    });

    it('numbers collisions rather than randomising them', () => {
        expect(resolvePageSlug('About', ['about'])).toBe('about-2');
        expect(resolvePageSlug('About', ['about', 'about-2'])).toBe('about-3');
    });

    it('suffixes a slug that would collide with a real storefront route', () => {
        // `/store/<shop>/shop` and `/store/<shop>/blog` are real routes, so a
        // page cannot own those names even though it lives one level deeper.
        expect(resolvePageSlug('Shop', [])).toBe('shop-page');
        expect(resolvePageSlug('Blog', [])).toBe('blog-page');
    });

    it('falls back when the title has no ASCII to work with', () => {
        // Bangla is dropped rather than transliterated — the same rule the blog
        // slugs follow, so a shop writing in Bangla gets a readable URL to edit
        // instead of a percent-encoded one.
        expect(resolvePageSlug('আমাদের কথা', [])).toBe('page');
        expect(resolvePageSlug('আমাদের কথা', ['page'])).toBe('page-2');
    });
});
