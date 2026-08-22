import { formatMessage } from '../i18n';
import { resolvePlurals, selectPluralCategory } from './plural';

describe('selectPluralCategory', () => {
    it('gives English two categories', () => {
        expect(selectPluralCategory('en', 1)).toBe('one');
        expect(selectPluralCategory('en', 0)).toBe('other');
        expect(selectPluralCategory('en', 7)).toBe('other');
    });

    // The whole reason this module exists: a singular/plural key pair cannot
    // express Arabic, and picking the wrong branch is silent.
    it('gives Arabic all six categories', () => {
        expect(selectPluralCategory('ar', 0)).toBe('zero');
        expect(selectPluralCategory('ar', 1)).toBe('one');
        expect(selectPluralCategory('ar', 2)).toBe('two');
        expect(selectPluralCategory('ar', 3)).toBe('few');
        expect(selectPluralCategory('ar', 11)).toBe('many');
        expect(selectPluralCategory('ar', 100)).toBe('other');
    });

    it('gives Urdu the same two categories as English', () => {
        expect(selectPluralCategory('ur', 1)).toBe('one');
        expect(selectPluralCategory('ur', 2)).toBe('other');
    });

    it('falls back to one-or-other for a nonsense language tag', () => {
        expect(selectPluralCategory('not a tag', 1)).toBe('one');
        expect(selectPluralCategory('not a tag', 5)).toBe('other');
    });
});

describe('resolvePlurals', () => {
    const en = '{count, plural, one {# recipe} other {# recipes}}';

    it('selects a branch and substitutes #', () => {
        expect(resolvePlurals(en, { count: 1 }, 'en')).toBe('1 recipe');
        expect(resolvePlurals(en, { count: 4 }, 'en')).toBe('4 recipes');
    });

    it('selects the Arabic branch the count actually falls into', () => {
        const ar =
            '{count, plural, zero {لا وصفات} one {وصفة واحدة} two {وصفتان} few {# وصفات} many {# وصفة} other {# وصفة}}';

        expect(resolvePlurals(ar, { count: 0 }, 'ar')).toBe('لا وصفات');
        expect(resolvePlurals(ar, { count: 1 }, 'ar')).toBe('وصفة واحدة');
        expect(resolvePlurals(ar, { count: 2 }, 'ar')).toBe('وصفتان');
        expect(resolvePlurals(ar, { count: 5 }, 'ar')).toBe('5 وصفات');
        expect(resolvePlurals(ar, { count: 20 }, 'ar')).toBe('20 وصفة');
    });

    it('prefers an =N exact branch over the CLDR category', () => {
        const t = '{count, plural, =0 {nothing yet} one {# item} other {# items}}';
        expect(resolvePlurals(t, { count: 0 }, 'en')).toBe('nothing yet');
        expect(resolvePlurals(t, { count: 2 }, 'en')).toBe('2 items');
    });

    it('falls back to other when the language category has no branch', () => {
        // Malay has only `other`; a catalog that supplies both must still work.
        expect(resolvePlurals(en, { count: 1 }, 'ms')).toBe('1 recipes');
    });

    it('keeps surrounding text and other placeholders intact', () => {
        const t = 'Hi {name}, {count, plural, one {# job} other {# jobs}} left';
        expect(resolvePlurals(t, { name: 'Karim', count: 3 }, 'en')).toBe(
            'Hi {name}, 3 jobs left',
        );
    });

    it('resolves more than one block in a single string', () => {
        const t = '{a, plural, one {# cat} other {# cats}} and {b, plural, one {# dog} other {# dogs}}';
        expect(resolvePlurals(t, { a: 1, b: 2 }, 'en')).toBe('1 cat and 2 dogs');
    });

    it('handles a branch body that itself contains a placeholder', () => {
        const t = '{count, plural, one {# file in {folder}} other {# files in {folder}}}';
        expect(resolvePlurals(t, { count: 2, folder: 'Inbox' }, 'en')).toBe('2 files in {folder}');
    });

    // A broken catalog string should be visible, not silently blank.
    it('emits a malformed or unresolvable block verbatim', () => {
        expect(resolvePlurals(en, {}, 'en')).toBe(en);
        expect(resolvePlurals(en, { count: 'abc' }, 'en')).toBe(en);

        const noOther = '{count, plural, one {# recipe}}';
        expect(resolvePlurals(noOther, { count: 9 }, 'en')).toBe(noOther);

        const unbalanced = '{count, plural, one {# recipe} other {# recipes}';
        expect(resolvePlurals(unbalanced, { count: 9 }, 'en')).toBe(unbalanced);
    });

    it('leaves a plain template untouched', () => {
        expect(resolvePlurals('Showing {start}–{end}', { start: 1, end: 9 }, 'en')).toBe(
            'Showing {start}–{end}',
        );
    });
});

describe('formatMessage', () => {
    it('resolves plurals and then interpolates the chosen branch', () => {
        const t = '{count, plural, one {# job for {name}} other {# jobs for {name}}}';
        expect(formatMessage(t, { count: 1, name: 'Karim' }, 'en')).toBe('1 job for Karim');
        expect(formatMessage(t, { count: 5, name: 'Karim' }, 'en')).toBe('5 jobs for Karim');
    });

    it('applies the passed locale rather than English', () => {
        const ar = '{count, plural, two {صنفان} other {# أصناف}}';
        expect(formatMessage(ar, { count: 2 }, 'ar')).toBe('صنفان');
        // English has no `two` category, so the same string falls to `other`.
        expect(formatMessage(ar, { count: 2 }, 'en')).toBe('2 أصناف');
    });

    it('still interpolates a plain template with no locale argument', () => {
        expect(formatMessage('Showing {start} of {total}', { start: 1, total: 9 })).toBe(
            'Showing 1 of 9',
        );
    });
});
