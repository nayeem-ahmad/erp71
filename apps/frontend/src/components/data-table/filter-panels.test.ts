import { dateFromPreset, formatDateChip } from './filter-panels';

// Mid-morning in Dhaka, the workspace's default zone.
const at = (iso: string) => new Date(`${iso}T04:00:00Z`);

describe('dateFromPreset', () => {
    it('names the day each shortcut stands for', () => {
        const now = at('2026-05-15');
        expect(dateFromPreset('today', now)).toBe('2026-05-15');
        expect(dateFromPreset('yesterday', now)).toBe('2026-05-14');
        expect(dateFromPreset('endOfLastMonth', now)).toBe('2026-04-30');
        expect(dateFromPreset('endOfLastQuarter', now)).toBe('2026-03-31');
        expect(dateFromPreset('endOfLastYear', now)).toBe('2025-12-31');
    });

    it('reaches back across the year in January', () => {
        const now = at('2026-01-10');
        expect(dateFromPreset('endOfLastMonth', now)).toBe('2025-12-31');
        expect(dateFromPreset('endOfLastQuarter', now)).toBe('2025-12-31');
    });

    it('ends February on its last day', () => {
        expect(dateFromPreset('endOfLastMonth', at('2028-03-02'))).toBe('2028-02-29');
    });
});

describe('formatDateChip', () => {
    it('names the year only for a day outside this one', () => {
        const now = at('2026-05-15');
        expect(formatDateChip('2026-03-31', now)).toBe('31 Mar');
        expect(formatDateChip('2025-12-31', now)).toBe('31 Dec 2025');
    });
});
