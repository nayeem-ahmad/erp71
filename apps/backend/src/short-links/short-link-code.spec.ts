import { generateShortCode, SHORT_CODE_ALPHABET, SHORT_CODE_LENGTH } from './short-link-code';

/**
 * These codes end up printed on quotations and read aloud over the phone, so the
 * properties under test are human ones as much as cryptographic ones: short
 * enough to dictate, and containing no character that can be confused for
 * another.
 */
describe('generateShortCode', () => {
    /** Enough samples that a per-character defect shows up reliably. */
    const SAMPLE = 2000;
    const codes = Array.from({ length: SAMPLE }, () => generateShortCode());

    it('produces a 6-character code', () => {
        expect(SHORT_CODE_LENGTH).toBe(6);
        for (const code of codes) {
            expect(code).toHaveLength(6);
        }
    });

    it('uses only characters from the published alphabet', () => {
        const allowed = new Set(SHORT_CODE_ALPHABET);
        for (const code of codes) {
            for (const char of code) {
                expect(allowed.has(char)).toBe(true);
            }
        }
    });

    it('never emits a character that can be misread off a printed page', () => {
        // 0/o, 1/l/i — the pairs that cost a customer their link when a
        // quotation is retyped from paper.
        const confusable = /[01ilo]/;
        for (const code of codes) {
            expect(code).not.toMatch(confusable);
        }
    });

    it('is lowercase only, so a code can be dictated without spelling out case', () => {
        for (const code of codes) {
            expect(code).toBe(code.toLowerCase());
        }
    });

    it('exposes an alphabet with no duplicate characters', () => {
        // A repeated character would silently bias generation toward it.
        expect(new Set(SHORT_CODE_ALPHABET).size).toBe(SHORT_CODE_ALPHABET.length);
    });

    it('draws on the whole alphabet rather than a subset', () => {
        // Guards against an off-by-one in the random index bound leaving the
        // first or last character permanently unreachable.
        const seen = new Set(codes.join(''));
        expect(seen.size).toBe(SHORT_CODE_ALPHABET.length);
    });

    it('does not repeat itself over a large sample', () => {
        // 31^6 ≈ 887M: duplicates in 2000 draws would indicate a broken source
        // of randomness, not bad luck.
        expect(new Set(codes).size).toBe(SAMPLE);
    });
});
