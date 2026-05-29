import { formatBDT, formatCurrency, formatDate, formatNumber } from './format';

describe('format helpers', () => {
    beforeEach(() => {
        document.documentElement.lang = 'en';
        localStorage.clear();
    });

    it('formats BDT using English digits by default', () => {
        expect(formatBDT(1234.5)).toBe('৳ 1,234.50');
    });

    it('formats BDT using Bangla digits when locale is bn', () => {
        expect(formatBDT(1234.5, { locale: 'bn' })).toBe('৳ ১,২৩৪.৫০');
    });

    it('formats numbers using locale metadata', () => {
        expect(formatNumber(1234567, 'bn')).toBe('১২,৩৪,৫৬৭');
        expect(formatNumber(1234567, 'en')).toBe('1,234,567');
    });

    it('formats dates using the selected locale', () => {
        expect(formatDate('2026-05-29T00:00:00.000Z', 'en')).toBe('29/05/2026');
        expect(formatDate('2026-05-29T00:00:00.000Z', 'bn')).toBe('২৯/০৫/২০২৬');
    });

    it('supports future currencies without coupling them to language', () => {
        expect(formatCurrency(2500, { locale: 'ms', currency: 'MYR' })).toBe('RM 2,500.00');
    });
});