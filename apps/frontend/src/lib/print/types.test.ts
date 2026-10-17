import { receiptRoll, sheetPaper } from './types';

describe('sheetPaper', () => {
    it('keeps a sheet the browser chose', () => {
        expect(sheetPaper('A4')).toBe('A4');
        expect(sheetPaper('A5')).toBe('A5');
        expect(sheetPaper('Letter')).toBe('Letter');
    });

    it('prints on A4 in place of a till roll', () => {
        expect(sheetPaper('Thermal80')).toBe('A4');
        expect(sheetPaper('Thermal58')).toBe('A4');
    });
});

describe('receiptRoll', () => {
    it('keeps a 58mm roll the browser chose', () => {
        expect(receiptRoll('Thermal58')).toBe('Thermal58');
    });

    it('prints on 80mm when the browser chose 80mm or a sheet', () => {
        expect(receiptRoll('Thermal80')).toBe('Thermal80');
        expect(receiptRoll('A4')).toBe('Thermal80');
        expect(receiptRoll('A5')).toBe('Thermal80');
    });
});
