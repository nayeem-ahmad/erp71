import { Logger } from '@nestjs/common';
import { DEFAULT_ALERT_PREFS } from '@erp71/shared-types';
import { PreferencesService } from '../preferences/preferences.service';
import { AlertPolicy, DAILY_PUSH_CAP, DEFAULT_QUIET, inQuietWindow, minuteOfDay, profileAlertsFor } from './alert-policy';

describe('AlertPolicy', () => {
    // 23:30 in Dhaka (UTC+6).
    const lateNight = new Date('2026-10-07T17:30:00Z');
    // 14:00 in Dhaka.
    const afternoon = new Date('2026-10-08T08:00:00Z');
    let db: any;
    let policy: AlertPolicy;
    let preferences: { profileFor: jest.Mock };

    beforeEach(() => {
        db = {
            userAlertPreference: { findUnique: jest.fn().mockResolvedValue(null) },
            notification: { count: jest.fn().mockResolvedValue(0), findFirst: jest.fn() },
        };
        preferences = { profileFor: jest.fn().mockResolvedValue(null) };
        policy = new AlertPolicy(db, { for: jest.fn().mockResolvedValue('Asia/Dhaka') } as any, preferences as any);
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

    it('keeps DEFAULT_QUIET equal to the shared built-in quiet hours', () => {
        expect(DEFAULT_QUIET).toEqual({ from: DEFAULT_ALERT_PREFS.quiet.from, to: DEFAULT_ALERT_PREFS.quiet.to });
        expect(DEFAULT_QUIET).toEqual({ from: 1320, to: 480 });
    });

    describe('with a profile', () => {
        const withAlerts = (alerts: object) =>
            preferences.profileFor.mockResolvedValue({ id: 'p1', name: 'Cashier', prefs: { version: 1, sections: { alerts } } });

        it('decide: no row and the profile mutes LARGE_SALE → skip', async () => {
            withAlerts({ mutedTypes: ['LARGE_SALE'] });
            expect(await policy.decide('t1', 'u1', 'LARGE_SALE', afternoon)).toBe('skip');
            expect(await policy.decide('t1', 'u1', 'LOW_STOCK', afternoon)).toBe('push');
        });

        it('no row and the profile’s quiet hours decide hold versus push', async () => {
            withAlerts({ quiet: { enabled: true, from: 13 * 60, to: 15 * 60 } });
            expect(await policy.decide('t1', 'u1', 'LOW_STOCK', afternoon)).toBe('hold');
            expect(await policy.decide('t1', 'u1', 'LOW_STOCK', lateNight)).toBe('push');
        });

        it('no row and a profile that turns quiet hours off → push at night', async () => {
            withAlerts({ quiet: { enabled: false } });
            expect(await policy.decide('t1', 'u1', 'LOW_STOCK', lateNight)).toBe('push');
            expect(await policy.isQuietFor('t1', 'u1', lateNight)).toBe(false);
        });

        it('a row wins, and the profile is not read', async () => {
            withAlerts({ mutedTypes: ['LARGE_SALE'], quiet: { enabled: true, from: 13 * 60, to: 15 * 60 } });
            db.userAlertPreference.findUnique.mockResolvedValue({
                muted_types: [], quiet_enabled: false, quiet_from: 1320, quiet_to: 480,
            });
            expect(await policy.decide('t1', 'u1', 'LARGE_SALE', afternoon)).toBe('push');
            expect(await policy.isQuietFor('t1', 'u1', afternoon)).toBe(false);
            expect(preferences.profileFor).not.toHaveBeenCalled();
        });

        it('a profile that cannot be read leaves the built-ins, and is logged', async () => {
            const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
            preferences.profileFor.mockRejectedValue(new Error('gone'));
            expect(await policy.decide('t1', 'u1', 'LOW_STOCK', lateNight)).toBe('hold');
            expect(warn).toHaveBeenCalledTimes(1);
            expect(warn).toHaveBeenCalledWith(expect.stringMatching(/u1.*t1.*gone/));
            warn.mockRestore();
        });

        it('someone who is not a member gets the built-ins, and no warning is logged', async () => {
            const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
            const real = new PreferencesService({
                tenantUser: { findUnique: jest.fn().mockResolvedValue(null) },
                preferenceProfile: { findFirst: jest.fn() },
                userAlertPreference: { findUnique: jest.fn() },
            } as any);

            await expect(profileAlertsFor(real, 't1', 'platform-admin')).resolves.toBeUndefined();

            expect(warn).not.toHaveBeenCalled();
            warn.mockRestore();
        });

        it('decide: one profile lookup per (tenant,user) within a dispatch', async () => {
            withAlerts({ mutedTypes: ['LARGE_SALE'] });
            const cache = new Map();
            await policy.decide('t1', 'u1', 'LARGE_SALE', afternoon, cache);
            await policy.decide('t1', 'u1', 'LOW_STOCK', afternoon, cache);
            await policy.isQuietFor('t1', 'u1', afternoon, cache);
            expect(preferences.profileFor).toHaveBeenCalledTimes(1);

            await policy.decide('t1', 'u2', 'LOW_STOCK', afternoon, cache);
            expect(preferences.profileFor).toHaveBeenCalledTimes(2);
        });

        it('without a cache, each decision looks again, so a changed profile is seen', async () => {
            withAlerts({});
            await policy.decide('t1', 'u1', 'LOW_STOCK', afternoon);
            await policy.decide('t1', 'u1', 'LOW_STOCK', afternoon);
            expect(preferences.profileFor).toHaveBeenCalledTimes(2);
        });
    });

    it('finds a repeat only inside the ten-minute window', async () => {
        await policy.recentDuplicate('t1', 'u1', 'TILL_SHORTFALL', 'till:s1', afternoon);
        expect(db.notification.findFirst.mock.calls[0][0].where).toEqual({
            tenant_id: 't1', user_id: 'u1', type: 'TILL_SHORTFALL', dedupe_key: 'till:s1',
            created_at: { gte: new Date('2026-10-08T07:50:00Z') },
        });
    });
});
