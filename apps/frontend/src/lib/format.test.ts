import { formatBDT, formatCalendarDate, formatCurrency, formatDate, formatNumber, setActiveTimeZone } from './format';

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

    describe('formatCalendarDate', () => {
        afterEach(() => setActiveTimeZone(undefined));

        it('renders a picked calendar date as the day that was picked', () => {
            expect(formatCalendarDate('2026-03-01', 'en')).toBe('01/03/2026');
            expect(formatCalendarDate('2026-03-01', 'bn')).toBe('০১/০৩/২০২৬');
        });

        it('does not move the date in a workspace west of Greenwich', () => {
            setActiveTimeZone('America/Los_Angeles');
            // `formatDate` reads the same string as UTC midnight and lands on the
            // day before. A date-input bound has no time of day to convert.
            expect(formatDate('2026-03-01', 'en')).toBe('28/02/2026');
            expect(formatCalendarDate('2026-03-01', 'en')).toBe('01/03/2026');
        });

        it('falls back to instant formatting for anything that is not a bare date', () => {
            expect(formatCalendarDate('2026-05-29T00:00:00.000Z', 'en')).toBe('29/05/2026');
            expect(formatCalendarDate('', 'en')).toBe('\u2014');
        });
    });
});