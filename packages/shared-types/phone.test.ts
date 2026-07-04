import { normalizeMobileToE164, isValidE164Mobile } from './phone';

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
});