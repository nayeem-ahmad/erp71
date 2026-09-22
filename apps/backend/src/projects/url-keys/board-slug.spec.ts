import { slugFallback, slugify, uniqueSlug } from './board-slug';

describe('slugify', () => {
    it('lowercases and hyphenates', () => {
        expect(slugify('OTB tahsin')).toBe('otb-tahsin');
    });

    it('keeps digits', () => {
        expect(slugify('ERP71')).toBe('erp71');
    });

    it('collapses runs of punctuation into one hyphen', () => {
        expect(slugify('Release 4 -- final!!')).toBe('release-4-final');
    });

    it('trims leading and trailing hyphens', () => {
        expect(slugify('  --Board 1--  ')).toBe('board-1');
    });

    it('keeps Bengali letters rather than dropping them', () => {
        // A tenant naming a board in Bengali must not get an empty slug, and
        // the vowel marks must survive or two names collapse together.
        expect(slugify('বোর্ড ১')).toBe('বোর্ড-১');
    });

    it('caps at 60 characters without a trailing hyphen', () => {
        const slug = slugify('a'.repeat(80));
        expect(slug).toHaveLength(60);
        expect(slug.endsWith('-')).toBe(false);
    });

    it('returns empty for a name with nothing sluggable', () => {
        expect(slugify('!!!')).toBe('');
    });

    it('matches what the backfill SQL produces for every real board name', () => {
        // Checked against production on 2026-09-22; the migration's regex must
        // agree with this function or a backfilled slug differs from a
        // freshly-created one.
        expect(['OTB', 'OTB tahsin', 'Board 1', 'ERP71', 'Jobxprss', 'Kraftize', 'MLB'].map(slugify)).toEqual([
            'otb', 'otb-tahsin', 'board-1', 'erp71', 'jobxprss', 'kraftize', 'mlb',
        ]);
    });
});

describe('uniqueSlug', () => {
    it('returns the base when it is free', () => {
        expect(uniqueSlug('otb', new Set())).toBe('otb');
    });

    it('suffixes -2 on the first collision', () => {
        expect(uniqueSlug('otb', new Set(['otb']))).toBe('otb-2');
    });

    it('keeps counting past an existing suffix', () => {
        expect(uniqueSlug('otb', new Set(['otb', 'otb-2']))).toBe('otb-3');
    });
});

describe('slugFallback', () => {
    it('builds a slug from the id when the name yields nothing', () => {
        expect(slugFallback('2d1597c2-3c49-44c5-b88d-35a07a373cdb')).toBe('board-2d1597c2');
    });
});
