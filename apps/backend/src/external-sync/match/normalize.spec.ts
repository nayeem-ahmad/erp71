import { normalizeCompanyName, normalizeDigits, normalizeName, normalizePhone } from './normalize';

describe('normalizeDigits', () => {
    it('converts Bengali digits to ASCII', () => {
        expect(normalizeDigits('৫০০')).toBe('500');
    });

    it('leaves ASCII digits alone', () => {
        expect(normalizeDigits('500')).toBe('500');
    });
});

describe('normalizeName', () => {
    it('case-folds, trims and collapses whitespace', () => {
        expect(normalizeName('  Napa   500MG  ')).toBe('napa 500mg');
    });

    it('strips punctuation', () => {
        expect(normalizeName('Napa-500 (mg).')).toBe('napa 500 mg');
    });

    it('normalizes Bengali digits inside a name', () => {
        expect(normalizeName('নাপা ৫০০')).toBe('নাপা 500');
    });

    it('is NFC-stable for decomposed Bengali', () => {
        const composed = 'ক্ষ';
        const decomposed = composed.normalize('NFD');
        expect(normalizeName(decomposed)).toBe(normalizeName(composed));
    });

    it('returns empty string for empty input', () => {
        expect(normalizeName('')).toBe('');
    });
});

describe('normalizeCompanyName', () => {
    it('strips a trailing Ltd', () => {
        expect(normalizeCompanyName('Beximco Pharma Ltd')).toBe('beximco pharma');
    });

    it('strips Limited and preserves Pharmaceuticals', () => {
        expect(normalizeCompanyName('Beximco Pharmaceuticals Limited')).toBe('beximco pharmaceuticals');
    });

    it('strips Traders and & Sons', () => {
        expect(normalizeCompanyName('Towfiq Traders')).toBe('towfiq');
        expect(normalizeCompanyName('Karim & Sons')).toBe('karim');
    });

    it('does not strip a suffix word that is the whole name', () => {
        expect(normalizeCompanyName('Traders')).toBe('traders');
    });
});

describe('normalizePhone', () => {
    it.each([
        ['01712345678', '+8801712345678'],
        ['8801712345678', '+8801712345678'],
        ['+8801712345678', '+8801712345678'],
        ['01712-345678', '+8801712345678'],
        ['০১৭১২৩৪৫৬৭৮', '+8801712345678'],
    ])('normalizes %s', (input, expected) => {
        expect(normalizePhone(input)).toBe(expected);
    });

    it('returns null for null, empty or unusable input', () => {
        expect(normalizePhone(null)).toBeNull();
        expect(normalizePhone('')).toBeNull();
        expect(normalizePhone('N/A')).toBeNull();
    });

    it('returns null for a number that is not a Bangladeshi mobile', () => {
        expect(normalizePhone('12345')).toBeNull();
    });
});
