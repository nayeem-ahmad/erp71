import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CrmFollowUpsService } from './crm-follow-ups.service';
import { DatabaseService } from '../database/database.service';
import { AppLogger } from '../common/app-logger.service';
import { JobTrackerService } from '../system-health/jobs/job-tracker.service';
import { NotificationsService } from '../notifications/notifications.service';

describe('CrmFollowUpsService', () => {
    let service: CrmFollowUpsService;
    let db: any;
    let notifications: any;

    beforeEach(async () => {
        db = {
            customer: { findFirst: jest.fn(), findMany: jest.fn() },
            lead: { findFirst: jest.fn() },
            crmFollowUp: {
                create: jest.fn(),
                findFirst: jest.fn(),
                findMany: jest.fn(),
                update: jest.fn(),
                delete: jest.fn(),
                count: jest.fn(),
            },
            tenant: { findUnique: jest.fn() },
            $queryRaw: jest.fn(),
        };
        notifications = { create: jest.fn().mockResolvedValue(undefined) };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                CrmFollowUpsService,
                { provide: DatabaseService, useValue: db },
                { provide: AppLogger, useValue: { debug: jest.fn(), error: jest.fn(), warn: jest.fn(), log: jest.fn() } },
                // track() just runs the job body — job-run bookkeeping is JobTrackerService's own concern.
                { provide: JobTrackerService, useValue: { track: (_name: string, fn: () => Promise<unknown>) => fn() } },
                { provide: NotificationsService, useValue: notifications },
            ],
        }).compile();

        service = module.get(CrmFollowUpsService);
    });

    describe('create()', () => {
        it('requires exactly one of customer_id or lead_id', async () => {
            await expect(
                service.create('tenant-1', 'user-1', { type: 'GENERAL' as any, title: 'x', due_at: '2026-08-01' }),
            ).rejects.toThrow(BadRequestException);
        });

        it('refuses a follow-up against a lost or converted lead', async () => {
            db.lead.findFirst.mockResolvedValue({ id: 'lead-1', status: 'CONVERTED' });
            await expect(
                service.create('tenant-1', 'user-1', {
                    lead_id: 'lead-1',
                    type: 'GENERAL' as any,
                    title: 'x',
                    due_at: '2026-08-01',
                }),
            ).rejects.toThrow('Follow-ups cannot be created for lost or converted leads.');
        });

        it('rejects a lead that does not belong to the tenant', async () => {
            db.lead.findFirst.mockResolvedValue(null);
            await expect(
                service.create('tenant-1', 'user-1', {
                    lead_id: 'lead-nope',
                    type: 'GENERAL' as any,
                    title: 'x',
                    due_at: '2026-08-01',
                }),
            ).rejects.toThrow(NotFoundException);
        });
    });

    describe('autoCreateReorderReminders — the NULL-exclusion fix', () => {
        it('queries dormant customers with an OR that includes never-contacted ones, not just stale-contacted ones', async () => {
            db.customer.findMany.mockResolvedValue([]);

            await service.autoCreateReorderReminders();

            expect(db.customer.findMany).toHaveBeenCalledTimes(1);
            const where = db.customer.findMany.mock.calls[0][0].where;
            // The bug this replaces: `last_contacted_at: { lt: cutoff }` alone
            // excludes NULL in SQL, so a customer never contacted is invisible.
            expect(where.OR).toEqual(
                expect.arrayContaining([
                    { last_contacted_at: { lt: expect.any(Date) } },
                    { last_contacted_at: null, created_at: { lt: expect.any(Date) } },
                ]),
            );
            expect(where.deleted_at).toBeNull();
        });

        it('creates a reminder and notifies the tenant owner for a dormant customer', async () => {
            db.customer.findMany.mockResolvedValue([
                { id: 'cust-1', tenant_id: 'tenant-1', name: 'Rahim' },
            ]);
            db.crmFollowUp.findFirst.mockResolvedValue(null);
            db.crmFollowUp.create.mockResolvedValue({
                id: 'fu-1',
                tenant_id: 'tenant-1',
                title: 'Follow up with Rahim — no contact in 60+ days',
            });
            db.tenant.findUnique.mockResolvedValue({ owner_id: 'owner-1' });

            await service.autoCreateReorderReminders();

            expect(db.crmFollowUp.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        tenant_id: 'tenant-1',
                        customer_id: 'cust-1',
                        type: 'REORDER_REMINDER',
                        status: 'PENDING',
                    }),
                }),
            );
            expect(notifications.create).toHaveBeenCalledWith(
                'tenant-1',
                'owner-1',
                'CRM_FOLLOW_UP',
                expect.stringContaining('Rahim'),
                expect.any(String),
                '/crm/follow-ups',
            );
        });

        it('does not duplicate a reminder already pending for the same customer', async () => {
            db.customer.findMany.mockResolvedValue([
                { id: 'cust-1', tenant_id: 'tenant-1', name: 'Rahim' },
            ]);
            db.crmFollowUp.findFirst.mockResolvedValue({ id: 'existing' });

            await service.autoCreateReorderReminders();

            expect(db.crmFollowUp.create).not.toHaveBeenCalled();
        });

        it('a failed notification does not stop the reminder from being recorded', async () => {
            db.customer.findMany.mockResolvedValue([
                { id: 'cust-1', tenant_id: 'tenant-1', name: 'Rahim' },
            ]);
            db.crmFollowUp.findFirst.mockResolvedValue(null);
            db.crmFollowUp.create.mockResolvedValue({ id: 'fu-1', tenant_id: 'tenant-1', title: 'x' });
            db.tenant.findUnique.mockResolvedValue({ owner_id: 'owner-1' });
            notifications.create.mockRejectedValue(new Error('email down'));

            await expect(service.autoCreateReorderReminders()).resolves.toBeUndefined();
        });
    });

    describe('autoCreateBirthdayFollowUps — the platform-wide-scan fix', () => {
        it('filters to today\'s birthdays in SQL rather than scanning every customer in JS', async () => {
            db.$queryRaw.mockResolvedValue([]);

            await service.autoCreateBirthdayFollowUps();

            expect(db.$queryRaw).toHaveBeenCalledTimes(1);
            // Confirms the query is parameterised on month/day (tagged-template
            // call), not a bare `findMany({ where: { deleted_at: null } })` that
            // pulls every customer on the platform.
            const [strings] = db.$queryRaw.mock.calls[0];
            expect(strings.join('')).toContain('EXTRACT(MONTH FROM birthday)');
            expect(strings.join('')).toContain('EXTRACT(DAY FROM birthday)');
            expect(strings.join('')).toContain('birthday IS NOT NULL');
        });

        it('creates one birthday follow-up per matched customer and notifies the owner', async () => {
            db.$queryRaw.mockResolvedValue([{ id: 'cust-1', tenant_id: 'tenant-1', name: 'Karim' }]);
            db.crmFollowUp.findFirst.mockResolvedValue(null);
            db.crmFollowUp.create.mockResolvedValue({
                id: 'fu-1',
                tenant_id: 'tenant-1',
                title: 'Birthday greeting for Karim',
            });
            db.tenant.findUnique.mockResolvedValue({ owner_id: 'owner-1' });

            await service.autoCreateBirthdayFollowUps();

            expect(db.crmFollowUp.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ customer_id: 'cust-1', type: 'BIRTHDAY' }),
                }),
            );
            expect(notifications.create).toHaveBeenCalledTimes(1);
        });

        it('does not create a second birthday follow-up for the same customer on the same day', async () => {
            db.$queryRaw.mockResolvedValue([{ id: 'cust-1', tenant_id: 'tenant-1', name: 'Karim' }]);
            db.crmFollowUp.findFirst.mockResolvedValue({ id: 'already-created-today' });

            await service.autoCreateBirthdayFollowUps();

            expect(db.crmFollowUp.create).not.toHaveBeenCalled();
        });
    });

    describe('getTodaySummary()', () => {
        it('counts due-today, overdue, and total pending independently', async () => {
            db.crmFollowUp.count
                .mockResolvedValueOnce(2) // dueToday
                .mockResolvedValueOnce(5) // overdue
                .mockResolvedValueOnce(9); // total pending

            await expect(service.getTodaySummary('tenant-1')).resolves.toEqual({
                dueToday: 2,
                overdue: 5,
                total: 9,
            });
        });
    });
});
