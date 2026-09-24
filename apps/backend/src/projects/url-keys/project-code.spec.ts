import { isValidProjectCode, suggestProjectCode } from './project-code';

describe('isValidProjectCode', () => {
    it.each(['ERP', 'D1-BR3', 'PRJ-0002', 'AB'])('accepts %s', (code) => {
        expect(isValidProjectCode(code)).toBe(true);
    });

    it('rejects lower case, so a code cannot be confused with a board slug', () => {
        expect(isValidProjectCode('erp')).toBe(false);
    });

    it('rejects a code starting with a digit', () => {
        expect(isValidProjectCode('1ERP')).toBe(false);
    });

    it('rejects one character', () => {
        expect(isValidProjectCode('E')).toBe(false);
    });

    it('rejects more than twelve characters', () => {
        expect(isValidProjectCode('A'.repeat(13))).toBe(false);
    });

    it('rejects spaces and punctuation other than hyphen', () => {
        expect(isValidProjectCode('ERP 1')).toBe(false);
        expect(isValidProjectCode('ERP_1')).toBe(false);
    });
});

describe('suggestProjectCode', () => {
    it.each([
        ['Warehouse Management System', 'WMS'],
        ['The Mall of Dhaka', 'MD'],
        ['Phase 2 Rollout', 'P2R'],
        ['Mobile', 'MOBI'],
        ['erp71', 'ERP71'],
        ['Café Renovation', 'CR'],
        ['2026 Audit', 'P2026A'],
        ['  point-of-sale  revamp ', 'PSR'],
    ])('proposes a code for %s', (name, code) => {
        expect(suggestProjectCode(name)).toBe(code);
    });

    it('keeps filler words when they are all there is', () => {
        expect(suggestProjectCode('The A')).toBe('TA');
    });

    it('returns null when the name has nothing to abbreviate', () => {
        expect(suggestProjectCode('গুদাম')).toBeNull();
        expect(suggestProjectCode('X')).toBeNull();
        expect(suggestProjectCode('')).toBeNull();
    });

    it('leaves room for a numeric suffix', () => {
        const code = suggestProjectCode('q w e r t y u i o p z x c');
        expect(code).toBe('QWERTYUIOP');
    });
});
