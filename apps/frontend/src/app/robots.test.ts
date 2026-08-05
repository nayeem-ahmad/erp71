import robots from './robots';

/**
 * `/q/<token>` is a customer's quotation on a permanent, login-free URL. The
 * only thing standing between it and a search index is this file plus the
 * page's own `noindex` metadata, so both are pinned.
 */
describe('robots', () => {
    const rules = robots().rules as { allow?: unknown; disallow?: string[]; userAgent?: string };

    it('applies to every crawler', () => {
        expect(rules.userAgent).toBe('*');
    });

    it('disallows the shared-quotation and short-link paths', () => {
        expect(rules.disallow).toEqual(expect.arrayContaining(['/q/', '/s/']));
    });

    it('leaves storefronts crawlable — they are marketing pages', () => {
        expect(rules.allow).toBe('/');
        expect(rules.disallow).not.toEqual(expect.arrayContaining(['/store/']));
    });
});
