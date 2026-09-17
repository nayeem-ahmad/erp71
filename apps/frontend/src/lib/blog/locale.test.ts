import { blogStrings, blogHref, resolveBlogLocale, type BlogLocale } from './locale';

/**
 * The resolver is the only thing standing between a query string and the
 * backend's `?locale=`, so the cases that matter are the hostile ones: a
 * reader can type anything into `?lang=`, and every unrecognised value has to
 * land on English rather than on an empty page or an indexable junk URL.
 */
describe('resolveBlogLocale', () => {
    it('defaults to English when no language is asked for', () => {
        expect(resolveBlogLocale(undefined)).toBe('en');
    });

    it('returns Bangla when the reader asks for it', () => {
        expect(resolveBlogLocale('bn')).toBe('bn');
    });

    it('falls back to English for a locale the blog does not publish', () => {
        // `ms` is a real platform locale and the backend would accept it, but
        // the blog only offers the two, so the switcher must never produce it.
        expect(resolveBlogLocale('ms')).toBe('en');
    });

    it('falls back to English for junk rather than passing it to the API', () => {
        expect(resolveBlogLocale('../../etc/passwd')).toBe('en');
        expect(resolveBlogLocale('')).toBe('en');
    });
});

describe('blogHref', () => {
    it('leaves an English URL clean so the canonical has no stray param', () => {
        expect(blogHref('/blog', 'en')).toBe('/blog');
    });

    it('tags a Bangla URL so the choice survives a click', () => {
        expect(blogHref('/blog/stock-tips', 'bn')).toBe('/blog/stock-tips?lang=bn');
    });

    it('appends to a path that already carries a query', () => {
        expect(blogHref('/blog?page=2', 'bn')).toBe('/blog?page=2&lang=bn');
    });
});

describe('blogStrings', () => {
    it('gives every English string a Bangla counterpart', () => {
        const en = blogStrings('en');
        const bn = blogStrings('bn');

        // A missing key would silently render `undefined` in the page, so the
        // catalogs are pinned to the same shape rather than spot-checked.
        expect(Object.keys(bn).sort()).toEqual(Object.keys(en).sort());
        for (const key of Object.keys(en) as (keyof typeof en)[]) {
            expect(typeof bn[key]).toBe(typeof en[key]);
        }
    });

    it('actually translates rather than echoing English', () => {
        expect(blogStrings('bn').backToBlog).not.toBe(blogStrings('en').backToBlog);
    });

    it('builds the reading-time line in the reader language', () => {
        expect(blogStrings('en').readingTime(5)).toBe('5 min read');
        expect(blogStrings('bn').readingTime(5)).toContain('৫');
    });

    it('builds the pager line in the reader language', () => {
        expect(blogStrings('en').pageOf(2, 7)).toBe('Page 2 of 7');
        expect(blogStrings('bn').pageOf(2, 7)).toContain('৭');
    });
});

describe('BlogLocale type', () => {
    it('is inhabited by exactly the two the blog ships', () => {
        const locales: BlogLocale[] = ['en', 'bn'];
        expect(locales).toHaveLength(2);
    });
});
