import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseService } from '../database/database.service';
import { AppLogger } from '../common/app-logger.service';
import { JobTrackerService } from '../system-health/jobs/job-tracker.service';
import { ImportsScheduler } from './imports.scheduler';

describe('ImportsScheduler', () => {
    let scheduler: ImportsScheduler;
    let db: any;

    /** `days` from now, at midday UTC — comfortably inside that day's window. */
    const inDays = (days: number) => {
        const date = new Date();
        date.setUTCDate(date.getUTCDate() + days);
        date.setUTCHours(12, 0, 0, 0);
        return date;
    };

    const shipment = (overrides: Record<string, unknown> = {}) => ({
        id: 'ship-1',
        tenant_id: 'tenant-1',
        reference_number: 'IMP-2526-00001',
        lc_number: 'LC-991',
        lc_expiry_date: inDays(14),
        acceptance_due_date: null,
        tenant: { owner_id: 'owner-1' },
        ...overrides,
    });

    beforeEach(async () => {
        db = {
            importShipment: { findMany: jest.fn().mockResolvedValue([]) },
            notification: {
                findFirst: jest.fn().mockResolvedValue(null),
                create: jest.fn().mockResolvedValue({ id: 'notif-1' }),
            },
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                ImportsScheduler,
                { provide: DatabaseService, useValue: db },
                { provide: AppLogger, useValue: { error: jest.fn(), log: jest.fn() } },
                { provide: JobTrackerService, useValue: { track: jest.fn((_name, fn: any) => fn()) } },
            ],
        }).compile();

        scheduler = module.get(ImportsScheduler);
    });

    it('warns the workspace owner that an LC is about to lapse', async () => {
        db.importShipment.findMany.mockResolvedValue([shipment()]);

        await scheduler.sendLcExpiryAlerts();

        expect(db.notification.create.mock.calls[0][0].data).toMatchObject({
            tenant_id: 'tenant-1',
            user_id: 'owner-1',
            type: 'LC_EXPIRY',
            link: '/purchases/imports/ship-1',
        });
        expect(db.notification.create.mock.calls[0][0].data.title).toMatch(/expires in 14 days/);
    });

    it('names the maturity, not the expiry, when it is the acceptance falling due', async () => {
        db.importShipment.findMany.mockResolvedValue([
            shipment({ lc_expiry_date: null, acceptance_due_date: inDays(3) }),
        ]);

        await scheduler.sendLcExpiryAlerts();

        expect(db.notification.create.mock.calls[0][0].data.title).toMatch(/matures in 3 days/);
        expect(db.notification.create.mock.calls[0][0].data.body).toMatch(/Settle it with the bank/);
    });

    it('falls back to the shipment reference when there is no LC number', async () => {
        db.importShipment.findMany.mockResolvedValue([shipment({ lc_number: null })]);
        await scheduler.sendLcExpiryAlerts();
        expect(db.notification.create.mock.calls[0][0].data.title).toContain('IMP-2526-00001');
    });

    it('does not send the same shipment twice in a day', async () => {
        db.importShipment.findMany.mockResolvedValue([shipment()]);
        db.notification.findFirst.mockResolvedValue({ id: 'sent-earlier' });

        const result = await scheduler.sendLcExpiryAlerts();

        expect(db.notification.create).not.toHaveBeenCalled();
        expect(result).toMatchObject({ sent: 0, skipped: 1 });
    });

    it('skips a tenant with no owner rather than throwing', async () => {
        db.importShipment.findMany.mockResolvedValue([shipment({ tenant: { owner_id: null } })]);

        const result = await scheduler.sendLcExpiryAlerts();

        expect(db.notification.create).not.toHaveBeenCalled();
        expect(result).toMatchObject({ skipped: 1 });
    });

    it('keeps going when one tenant fails, because the others still need warning', async () => {
        db.importShipment.findMany.mockResolvedValue([
            shipment(),
            shipment({ id: 'ship-2', tenant_id: 'tenant-2', reference_number: 'IMP-2526-00002' }),
        ]);
        db.notification.create
            .mockRejectedValueOnce(new Error('boom'))
            .mockResolvedValueOnce({ id: 'notif-2' });

        const result = await scheduler.sendLcExpiryAlerts();

        expect(result).toMatchObject({ shipments: 2, sent: 1, skipped: 1 });
    });

    it('ignores closed and cancelled shipments', async () => {
        await scheduler.sendLcExpiryAlerts();
        expect(db.importShipment.findMany.mock.calls[0][0].where.status.notIn).toEqual(['CLOSED', 'CANCELLED']);
    });

    it('asks for two exact days rather than a range, so it cannot nag daily', async () => {
        await scheduler.sendLcExpiryAlerts();

        // Two tiers × two dates (LC expiry and acceptance maturity).
        expect(db.importShipment.findMany.mock.calls[0][0].where.OR).toHaveLength(4);
    });
});
