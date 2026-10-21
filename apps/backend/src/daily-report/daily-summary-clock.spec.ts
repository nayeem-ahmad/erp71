import { dailySummaryReportDate } from './daily-summary-clock';

describe('dailySummaryReportDate', () => {
    it('waits until 00:20 in the shop timezone', () => {
        // 00:19 in Dhaka (UTC+6) is still the new day, before the send.
        expect(dailySummaryReportDate(new Date('2026-10-20T18:19:00.000Z'), 'Asia/Dhaka')).toBeNull();
        // 00:20 summarises the day that just ended.
        expect(dailySummaryReportDate(new Date('2026-10-20T18:20:00.000Z'), 'Asia/Dhaka')).toBe('2026-10-20');
    });

    it('keeps offering that same day later, and uses the shop zone', () => {
        expect(dailySummaryReportDate(new Date('2026-10-21T06:00:00.000Z'), 'Asia/Dhaka')).toBe('2026-10-20');
        // 00:20 in New York (EDT, UTC-4) is 04:20 UTC. Dhaka is already morning.
        expect(dailySummaryReportDate(new Date('2026-10-21T04:19:00.000Z'), 'America/New_York')).toBeNull();
        expect(dailySummaryReportDate(new Date('2026-10-21T04:20:00.000Z'), 'America/New_York')).toBe('2026-10-20');
    });
});
