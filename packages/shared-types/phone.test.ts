import { normalizeMobileToE164, isValidE164Mobile, countryCodeFromE164 } from './phone';

describe('phone utils', () => {
    it('normalizes Bangladesh mobile numbers', () => {
        expect(normalizeMobileToE164('BD', '01712345678')).toBe('+8801712345678');
    });

    it('rejects invalid numbers', () => {
        expect(normalizeMobileToE164('BD', '123')).toBeNull();
    });

    it('validates E.164 format', () => {
        expect(isValidE164Mobile('+8801712345678')).toBe(true);
        expect(isValidE164Mobile('01712345678')).toBe(false);
    });

    describe('countryCodeFromE164', () => {
        it('resolves the country of a verified E.164 number', () => {
            expect(countryCodeFromE164('+8801712345678')).toBe('BD');
            expect(countryCodeFromE164('+919812345678')).toBe('IN');
            expect(countryCodeFromE164('+6591234567')).toBe('SG');
        });

        it('prefers the longest matching dial code over a shorter prefix of it', () => {
            // +1 (US) is a prefix of nothing here, but +9 vs +91/+971 is the trap:
            // +971... must not resolve to a country whose dial code is shorter.
            expect(countryCodeFromE164('+971501234567')).toBe('AE');
            expect(countryCodeFromE164('+966501234567')).toBe('SA');
        });

        it('returns null for unsupported countries and malformed input', () => {
            expect(countryCodeFromE164('+33612345678')).toBeNull();
            expect(countryCodeFromE164('01712345678')).toBeNull();
            expect(countryCodeFromE164(null)).toBeNull();
        });
    });
});