import { isValidProjectCode } from './project-code';

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
