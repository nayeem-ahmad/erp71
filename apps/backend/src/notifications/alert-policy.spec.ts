import { AlertPolicy, DAILY_PUSH_CAP, inQuietWindow, minuteOfDay } from './alert-policy';

describe('AlertPolicy', () => {
    // 23:30 in Dhaka (UTC+6).
    const lateNight = new Date('2026-10-07T17:30:00Z');
    // 14:00 in Dhaka.
    const afternoon = new Date('2026-10-08T08:00:00Z');
    let db: any;
    let policy: AlertPolicy;

    beforeEach(() => {
        db = {
            userAlertPreference: { findUnique: jest.fn().mockResolvedValue(null) },
            notification: { count: jest.fn().mockResolvedValue(0), findFirst: jest.fn() },
        };
        policy = new AlertPolicy(db, { for: jest.fn().mockResolvedValue('Asia/Dhaka') } as any);
    });

    it('reads the clock in the workspace’s zone', () => {
        expect(minuteOfDay(lateNight, 'Asia/Dhaka')).toBe(23 * 60 + 30);
        expect(minuteOfDay(lateNight, 'UTC')).toBe(17 * 60 + 30);
    });

    it('handles quiet windows that wrap midnight', () => {
        expect(inQuietWindow(23 * 60, 22 * 60, 8 * 60)).toBe(true);
        expect(inQuietWindow(7 * 60, 22 * 60, 8 * 60)).toBe(true);
        expect(inQuietWindow(8 * 60, 22 * 60, 8 * 60)).toBe(false);
        expect(inQuietWindow(13 * 60, 12 * 60, 14 * 60)).toBe(true);
        expect(inQuietWindow(13 * 60, 9 * 60, 9 * 60)).toBe(false);
    });

    it('holds a push at night by default, and pushes in the afternoon', async () => {
        expect(await policy.decide('t1', 'u1', 'LOW_STOCK', lateNight)).toBe('hold');
        expect(await policy.decide('t1', 'u1', 'LOW_STOCK', afternoon)).toBe('push');
    });

    it('respects a person who turned quiet hours off, or muted the type', async () => {
        db.userAlertPreference.findUnique.mockResolvedValue({
            muted_types: ['LOW_STOCK'], quiet_enabled: false, quiet_from: 1320, quiet_to: 480,
        });
        expect(await policy.decide('t1', 'u1', 'LOW_STOCK', afternoon)).toBe('skip');
        expect(await policy.decide('t1', 'u1', 'TILL_SHORTFALL', lateNight)).toBe('push');
    });

    it('leaves everything past the day’s cap to the bell, counting from the shop’s midnight', async () => {
        db.notification.count.mockResolvedValue(DAILY_PUSH_CAP);
        expect(await policy.decide('t1', 'u1', 'LOW_STOCK', afternoon)).toBe('skip');
        // Midnight in Dhaka is 18:00 UTC the day before.
        expect(db.notification.count.mock.calls[0][0].where.pushed_at.gte).toEqual(new Date('2026-10-07T18:00:00Z'));
    });

    it('finds a repeat only inside the ten-minute window', async () => {
        await policy.recentDuplicate('t1', 'u1', 'TILL_SHORTFALL', 'till:s1', afternoon);
        expect(db.notification.findFirst.mock.calls[0][0].where).toEqual({
            tenant_id: 't1', user_id: 'u1', type: 'TILL_SHORTFALL', dedupe_key: 'till:s1',
            created_at: { gte: new Date('2026-10-08T07:50:00Z') },
        });
    });
});
