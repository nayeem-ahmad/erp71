import { bijoyToUnicode } from './bijoy-unicode';
import { convertCsvText } from './csv';

describe('convertCsvText', () => {
    it('converts the names and leaves the numbers', () => {
        expect(convertCsvText('Pvj,120\r\nWvj,95.50\r\n', bijoyToUnicode)).toBe('চাল,120\r\nডাল,95.50\r\n');
    });

    it('keeps quoting, embedded commas and doubled quotes', () => {
        const upper = (s: string) => s.toUpperCase();
        expect(convertCsvText('"a, b","say ""hi""",3', upper)).toBe('"A, B","SAY ""HI""",3');
    });

    it('leaves dates and codes alone', () => {
        const mark = (s: string) => `[${s}]`;
        expect(convertCsvText('2026-11-22,10%,name', mark)).toBe('2026-11-22,10%,[name]');
    });
});
