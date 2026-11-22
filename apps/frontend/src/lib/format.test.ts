import { formatBDT, formatCalendarDate, formatCurrency, formatDate, formatNumber, setActiveTimeZone } from './format';

describe('format helpers', () => {
    beforeEach(() => {
        document.documentElement.lang = 'en';
        localStorage.clear();
    });

    it('keeps the symbol and the figure together with a non-breaking space', () => {
        // A plain space let a narrow column wrap ৳ onto a line of its own.
        expect(formatBDT(1234.5)).toContain('\u00a0');
        expect(formatBDT(1234.5)).not.toMatch(/৳ /);
    });

    it('formats BDT using English digits by default', () => {
        expect(formatBDT(1234.5)).toBe('৳\u00a01,234.50');
    });

    it('groups BDT in thousand, lac and crore', () => {
        expect(formatBDT(1_000)).toBe('৳\u00a01,000.00');
        expect(formatBDT(1_00_000)).toBe('৳\u00a01,00,000.00');
        expect(formatBDT(12_34_567)).toBe('৳\u00a012,34,567.00');
        expect(formatBDT(1_23_45_678.9)).toBe('৳\u00a01,23,45,678.90');
    });

    it('formats BDT using Bangla digits when locale is bn', () => {
        expect(formatBDT(1234.5, { locale: 'bn' })).toBe('৳\u00a0১,২৩৪.৫০');
        expect(formatBDT(12_34_567, { locale: 'bn' })).toBe('৳\u00a0১২,৩৪,৫৬৭.০০');
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
        expect(formatCurrency(2500, { locale: 'ms', currency: 'MYR' })).toBe('RM\u00a02,500.00');
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