import { readFileSync } from 'fs';
import { resolve } from 'path';
import { HELP_SECTIONS, helpSectionTitles, searchHelp } from './help-content';

describe('searchHelp', () => {
    it('finds the product FAQ for a how-to question', () => {
        const results = searchHelp('how do I add a new product?');
        expect(results.length).toBeGreaterThan(0);
        expect(results[0].q.toLowerCase()).toContain('product');
        expect(results[0].a).toContain('New Product');
    });

    it('matches on distinctive terms even when phrased loosely', () => {
        const results = searchHelp('does the till work without internet');
        // "offline POS" is the intended hit; the answer describes the yellow banner.
        expect(results.some((r) => /offline/i.test(r.q) || /offline|sync/i.test(r.a))).toBe(true);
    });

    it('resolves a synonym the FAQ words differently (staff → employee)', () => {
        const results = searchHelp('how do I add staff members');
        // Getting Started covers inviting staff; HR covers adding employees. Either
        // is a correct hit — the point is the synonym does not return nothing.
        expect(results.length).toBeGreaterThan(0);
    });

    it('ranks a near-verbatim question first', () => {
        const results = searchHelp('How do I turn on two-factor authentication (2FA)?');
        expect(results[0].q).toContain('two-factor authentication');
    });

    it('returns nothing for a query the docs do not cover', () => {
        expect(searchHelp('what is the weather in Dhaka tomorrow')).toEqual([]);
    });

    it('caps the number of results', () => {
        expect(searchHelp('how do I', 3).length).toBeLessThanOrEqual(3);
    });

    it('exposes the section titles for the empty-result fallback', () => {
        const titles = helpSectionTitles();
        expect(titles).toContain('Point of Sale (POS)');
        expect(titles.length).toBe(HELP_SECTIONS.length);
    });
});

/**
 * The assistant's product knowledge is a hand-kept mirror of the user-facing
 * Help Center, which lives in another app the backend cannot import. This guard
 * catches the drift that matters most: a section added to the Help Center that
 * the assistant would then be unable to answer from. It compares section keys
 * only, so rewording an answer does not trip it.
 */
describe('help-content mirrors the Help Center sections', () => {
    it('covers every section in the frontend Help Center FAQ', () => {
        const helpFile = resolve(
            __dirname,
            '../../../frontend/src/lib/localization/messages/en/help.ts',
        );
        const text = readFileSync(helpFile, 'utf8');
        const sectionsBody = text.slice(text.indexOf('sections: {'));
        // Section keys sit at exactly 8-space indent inside `sections: {`; their
        // title/icon/faqs properties are deeper, so this matches sections only.
        const frontendSectionIds = [...sectionsBody.matchAll(/^ {8}(\w+): \{$/gm)].map((m) => m[1]);

        // Sanity: the parse actually found the sections, not zero.
        expect(frontendSectionIds.length).toBeGreaterThanOrEqual(10);

        const covered = new Set(HELP_SECTIONS.map((s) => s.id));
        const missing = frontendSectionIds.filter((id) => !covered.has(id));
        expect(missing).toEqual([]);
    });
});
