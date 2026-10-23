import { Logger } from '@nestjs/common';
import { PreferencesService } from '../preferences/preferences.service';
import { AlertsController } from './alerts.controller';

describe('AlertsController preferences', () => {
    const tenant = { tenantId: 't1', userId: 'u1' } as any;
    const thresholds = { large_sale_amount: 50000 };
    const profile = (alerts: object) => ({
        id: 'p1',
        tenant_id: 't1',
        name: 'Cashier starter',
        prefs: { version: 1, sections: { alerts } },
    });

    let row: any;
    let profileRow: any;
    let db: any;
    let controller: AlertsController;
    let preferences: PreferencesService;
    let profileFor: jest.SpyInstance;

    beforeEach(() => {
        row = null;
        profileRow = null;
        db = {
            userAlertPreference: {
                findUnique: jest.fn(async () => row),
                upsert: jest.fn(async ({ create, update }: any) => {
                    row = row ? { ...row, ...update } : { ...create };
                    return row;
                }),
            },
            tenantUser: {
                findUnique: jest.fn(async () => ({
                    invoice_print_prefs: null,
                    preferences: null,
                    legacy_browser_sections: [],
                    tenantRole: { preferenceProfile: profileRow },
                })),
            },
            preferenceProfile: { findFirst: jest.fn(async () => null) },
            $queryRaw: jest.fn(async () => []),
            $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(db)),
        };
        preferences = new PreferencesService(db);
        profileFor = jest.spyOn(preferences, 'profileFor');
        controller = new AlertsController(db, { get: jest.fn().mockResolvedValue(thresholds) } as any, preferences);
    });

    describe('describe', () => {
        it('no row → profile quiet hours and mutes', async () => {
            profileRow = profile({ mutedTypes: ['LARGE_SALE'], quiet: { enabled: true, from: 21 * 60, to: 7 * 60 + 30 } });

            const out = await controller.preferences(tenant);

            expect(out.muted_types).toEqual(['LARGE_SALE']);
            expect(out.quiet).toEqual({ enabled: true, from: '21:00', to: '07:30' });
            expect(out.thresholds).toBe(thresholds);
            expect(Array.isArray(out.types)).toBe(true);
        });

        it('no row and a profile that sets one quiet field → the built-in for the others', async () => {
            profileRow = profile({ quiet: { enabled: false } });

            const out = await controller.preferences(tenant);

            expect(out.muted_types).toEqual([]);
            expect(out.quiet).toEqual({ enabled: false, from: '22:00', to: '08:00' });
        });

        it('no row and no profile → the built-ins', async () => {
            const out = await controller.preferences(tenant);

            expect(out.muted_types).toEqual([]);
            expect(out.quiet).toEqual({ enabled: true, from: '22:00', to: '08:00' });
        });

        it('a row wins, and the profile is not consulted', async () => {
            profileRow = profile({ mutedTypes: ['LARGE_SALE'], quiet: { enabled: true, from: 21 * 60, to: 7 * 60 } });
            row = { muted_types: [], quiet_enabled: false, quiet_from: 60, quiet_to: 120 };

            const out = await controller.preferences(tenant);

            expect(out.muted_types).toEqual([]);
            expect(out.quiet).toEqual({ enabled: false, from: '01:00', to: '02:00' });
            expect(profileFor).not.toHaveBeenCalled();
        });
    });

    it('a profile that cannot be read shows the built-ins, and is logged', async () => {
        const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
        profileFor.mockRejectedValue(new Error('db down'));

        const out = await controller.preferences(tenant);

        expect(out.muted_types).toEqual([]);
        expect(out.quiet).toEqual({ enabled: true, from: '22:00', to: '08:00' });
        expect(warn).toHaveBeenCalledWith(expect.stringMatching(/u1.*t1.*db down/));
        warn.mockRestore();
    });

    describe('PUT', () => {
        it('{muted_types} on a member with no row keeps the profile’s quiet hours', async () => {
            profileRow = profile({ quiet: { enabled: true, from: 21 * 60, to: 7 * 60 } });

            const out = await controller.updatePreferences(tenant, { muted_types: ['LOW_STOCK', 'LOW_STOCK'] } as any);

            expect(db.userAlertPreference.upsert).toHaveBeenCalledTimes(1);
            expect(row).toMatchObject({
                muted_types: ['LOW_STOCK'],
                quiet_enabled: true,
                quiet_from: 21 * 60,
                quiet_to: 7 * 60,
            });
            expect(out.muted_types).toEqual(['LOW_STOCK']);
            expect(out.quiet).toEqual({ enabled: true, from: '21:00', to: '07:00' });
        });

        it('converts the clocks to minutes and writes only what was sent', async () => {
            row = { muted_types: ['LARGE_SALE'], quiet_enabled: true, quiet_from: 1320, quiet_to: 480 };

            const out = await controller.updatePreferences(tenant, { quiet_enabled: false, quiet_to: '09:15' } as any);

            expect(row).toMatchObject({
                muted_types: ['LARGE_SALE'],
                quiet_enabled: false,
                quiet_from: 1320,
                quiet_to: 9 * 60 + 15,
            });
            expect(out.quiet).toEqual({ enabled: false, from: '22:00', to: '09:15' });
            expect(out.muted_types).toEqual(['LARGE_SALE']);
        });
    });
});
