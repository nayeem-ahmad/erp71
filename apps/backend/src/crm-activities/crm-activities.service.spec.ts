import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CrmActivitiesService } from './crm-activities.service';
import { CrmLeadTaxonomyService } from '../crm-lead-taxonomy/crm-lead-taxonomy.service';
import { DatabaseService } from '../database/database.service';
import { AppLogger } from '../common/app-logger.service';
import { JobTrackerService } from '../system-health/jobs/job-tracker.service';
import { NotificationsService } from '../notifications/notifications.service';

describe('CrmActivitiesService', () => {
    let service: CrmActivitiesService;
    let db: any;
    let taxonomy: any;

    beforeEach(async () => {
        db = {
            lead: { findFirst: jest.fn(), update: jest.fn(), findMany: jest.fn() },
            customer: { findFirst: jest.fn(), update: jest.fn(), findMany: jest.fn() },
            tenant: { findUnique: jest.fn().mockResolvedValue({ owner_id: 'owner-1' }) },
            crmActivity: {
                create: jest.fn(),
                findFirst: jest.fn(),
                findMany: jest.fn(),
                update: jest.fn(),
                updateMany: jest.fn(),
                delete: jest.fn(),
                count: jest.fn(),
            },
            $queryRaw: jest.fn(),
            $transaction: jest.fn(async (fn: any) => fn(db)),
        };
        taxonomy = { resolveByIdOrCode: jest.fn() };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                CrmActivitiesService,
                { provide: DatabaseService, useValue: db },
                { provide: CrmLeadTaxonomyService, useValue: taxonomy },
                {
                    provide: AppLogger,
                    useValue: { debug: jest.fn(), error: jest.fn(), warn: jest.fn(), log: jest.fn() },
                },
                {
                    provide: JobTrackerService,
                    useValue: { track: (_n: string, fn: () => Promise<unknown>) => fn() },
                },
                { provide: NotificationsService, useValue: { create: jest.fn().mockResolvedValue(undefined) } },
            ],
        }).compile();

        service = module.get(CrmActivitiesService);
    });

    describe('create()', () => {
        it('rejects both lead_id and customer_id', async () => {
            await expect(
                service.create('t1', 'u1', { lead_id: 'l1', customer_id: 'c1', subject: 'x' } as any),
            ).rejects.toThrow(BadRequestException);
        });

        it('rejects neither lead_id nor customer_id', async () => {
            await expect(service.create('t1', 'u1', { subject: 'x' } as any)).rejects.toThrow(
                BadRequestException,
            );
        });

        it('404s an unknown lead', async () => {
            db.lead.findFirst.mockResolvedValue(null);
            await expect(
                service.create('t1', 'u1', { lead_id: 'nope', subject: 'x' } as any),
            ).rejects.toThrow(NotFoundException);
        });

        it('requires a subject when planning', async () => {
            db.lead.findFirst.mockResolvedValue({ id: 'l1', status: 'NEW' });
            await expect(
                service.create('t1', 'u1', { lead_id: 'l1', status: 'PLANNED' } as any),
            ).rejects.toThrow(BadRequestException);
        });

        it('requires summary and channel when logging directly', async () => {
            db.lead.findFirst.mockResolvedValue({ id: 'l1', status: 'NEW' });
            await expect(
                service.create('t1', 'u1', { lead_id: 'l1', status: 'DONE', subject: 'x' } as any),
            ).rejects.toThrow(BadRequestException);
        });

        it('creates a planned activity and recalculates the rollup', async () => {
            db.lead.findFirst.mockResolvedValue({ id: 'l1', status: 'NEW' });
            db.crmActivity.create.mockResolvedValue({ id: 'a1', lead_id: 'l1' });
            db.crmActivity.findFirst.mockResolvedValue({
                id: 'a1',
                subject: 'Call Karim',
                due_at: new Date('2026-08-20'),
                assigned_to: 'u2',
            });

            await service.create('t1', 'u1', {
                lead_id: 'l1',
                subject: 'Call Karim',
                due_at: '2026-08-20T10:00:00Z',
                assigned_to: 'u2',
            } as any);

            expect(db.crmActivity.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        tenant_id: 't1',
                        lead_id: 'l1',
                        status: 'PLANNED',
                        origin: 'MANUAL',
                    }),
                }),
            );
            expect(db.lead.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: 'l1' },
                    data: expect.objectContaining({
                        next_step: 'Call Karim',
                        next_activity_id: 'a1',
                        next_step_assigned_to: 'u2',
                    }),
                }),
            );
        });
    });

    describe('findAll()', () => {
        it('scopes to the tenant and paginates', async () => {
            db.crmActivity.findMany.mockResolvedValue([]);
            db.crmActivity.count.mockResolvedValue(0);
            const res = await service.findAll('t1', { leadId: 'l1', page: 2, limit: 10 });
            expect(db.crmActivity.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({ tenant_id: 't1', lead_id: 'l1' }),
                    skip: 10,
                    take: 10,
                }),
            );
            expect(res).toEqual({ items: [], total: 0, page: 2, limit: 10, pages: 0 });
        });

        it('overdue means PLANNED and past due', async () => {
            db.crmActivity.findMany.mockResolvedValue([]);
            db.crmActivity.count.mockResolvedValue(0);
            await service.findAll('t1', { overdue: true });
            const where = db.crmActivity.findMany.mock.calls[0][0].where;
            expect(where.status).toBe('PLANNED');
            expect(where.due_at.lt).toBeInstanceOf(Date);
        });
    });

    describe('findOne()', () => {
        it('404s a cross-tenant id', async () => {
            db.crmActivity.findFirst.mockResolvedValue(null);
            await expect(service.findOne('t1', 'other')).rejects.toThrow(NotFoundException);
        });
    });

    describe('recalculateRollup()', () => {
        it('nulls every rollup column when no planned activity remains', async () => {
            db.lead.findFirst.mockResolvedValue({ id: 'l1', status: 'NEW' });
            db.crmActivity.create.mockResolvedValue({ id: 'a1', lead_id: 'l1' });
            db.crmActivity.findFirst.mockResolvedValue(null);

            await service.create('t1', 'u1', { lead_id: 'l1', subject: 'Call' } as any);

            expect(db.lead.update).toHaveBeenCalledWith({
                where: { id: 'l1' },
                data: {
                    next_step: null,
                    next_step_date: null,
                    next_step_assigned_to: null,
                    next_activity_id: null,
                },
            });
        });

        // NULLS LAST is not expressible in a Prisma orderBy shorthand, so the
        // dated rows are asked for first. An undated activity sorting ahead of a
        // dated one would become the "next step" and misreport the whole list.
        it('asks for the earliest dated planned activity first', async () => {
            db.lead.findFirst.mockResolvedValue({ id: 'l1', status: 'NEW' });
            db.crmActivity.create.mockResolvedValue({ id: 'a2' });
            db.crmActivity.findFirst.mockResolvedValue({
                id: 'a2',
                subject: 'Earliest',
                due_at: new Date('2026-08-14'),
                assigned_to: null,
            });

            await service.create('t1', 'u1', { lead_id: 'l1', subject: 'Earliest' } as any);

            expect(db.crmActivity.findFirst).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: {
                        tenant_id: 't1',
                        lead_id: 'l1',
                        status: 'PLANNED',
                        due_at: { not: null },
                    },
                    orderBy: [{ due_at: 'asc' }, { created_at: 'asc' }],
                }),
            );
            expect(db.lead.update).toHaveBeenCalledWith({
                where: { id: 'l1' },
                data: {
                    next_step: 'Earliest',
                    next_step_date: new Date('2026-08-14'),
                    next_step_assigned_to: null,
                    next_activity_id: 'a2',
                },
            });
        });

        it('falls back to an undated planned activity when no dated one exists', async () => {
            db.lead.findFirst.mockResolvedValue({ id: 'l1', status: 'NEW' });
            db.crmActivity.create.mockResolvedValue({ id: 'a3' });
            db.crmActivity.findFirst
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce({ id: 'a3', subject: 'Someday', due_at: null, assigned_to: null });

            await service.create('t1', 'u1', { lead_id: 'l1', subject: 'Someday' } as any);

            expect(db.crmActivity.findFirst).toHaveBeenCalledTimes(2);
            expect(db.lead.update).toHaveBeenCalledWith({
                where: { id: 'l1' },
                data: {
                    next_step: 'Someday',
                    next_step_date: null,
                    next_step_assigned_to: null,
                    next_activity_id: 'a3',
                },
            });
        });

        it('writes the customer rollup for a customer activity', async () => {
            db.customer.findFirst.mockResolvedValue({ id: 'c1' });
            db.crmActivity.create.mockResolvedValue({ id: 'a3' });
            db.crmActivity.findFirst.mockResolvedValue({
                id: 'a3',
                subject: 'Reorder call',
                due_at: new Date('2026-09-01'),
                assigned_to: null,
            });

            await service.create('t1', 'u1', { customer_id: 'c1', subject: 'Reorder call' } as any);

            expect(db.customer.update).toHaveBeenCalledWith({
                where: { id: 'c1' },
                data: { next_activity_id: 'a3', next_activity_date: new Date('2026-09-01') },
            });
            expect(db.lead.update).not.toHaveBeenCalled();
        });
    });

    describe('complete()', () => {
        const planned = {
            id: 'a1',
            tenant_id: 't1',
            lead_id: 'l1',
            customer_id: null,
            status: 'PLANNED',
            purpose_id: 'p1',
        };

        beforeEach(() => {
            taxonomy.resolveByIdOrCode.mockResolvedValue({
                id: 'ch1',
                code: 'CALL',
                name: 'Call',
                is_active: true,
            });
        });

        it('400s an already-completed activity', async () => {
            db.crmActivity.findFirst.mockResolvedValue({ ...planned, status: 'DONE' });
            await expect(
                service.complete('t1', 'u1', 'a1', { channel: 'CALL', summary: 's' } as any),
            ).rejects.toThrow(BadRequestException);
        });

        it('400s a cancelled activity', async () => {
            db.crmActivity.findFirst.mockResolvedValue({ ...planned, status: 'CANCELLED' });
            await expect(
                service.complete('t1', 'u1', 'a1', { channel: 'CALL', summary: 's' } as any),
            ).rejects.toThrow(BadRequestException);
        });

        it('404s an unknown id', async () => {
            db.crmActivity.findFirst.mockResolvedValue(null);
            await expect(
                service.complete('t1', 'u1', 'nope', { channel: 'CALL', summary: 's' } as any),
            ).rejects.toThrow(NotFoundException);
        });

        it('marks DONE, stamps the lead last_contacted_at and returns no next', async () => {
            db.crmActivity.findFirst.mockResolvedValueOnce(planned).mockResolvedValue(null);
            db.crmActivity.update.mockResolvedValue({ ...planned, status: 'DONE' });

            const res = await service.complete('t1', 'u1', 'a1', {
                channel: 'CALL',
                summary: 'Spoke to Karim',
                outcome: 'Promised Thursday',
            } as any);

            expect(db.crmActivity.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: 'a1' },
                    data: expect.objectContaining({
                        status: 'DONE',
                        summary: 'Spoke to Karim',
                        outcome: 'Promised Thursday',
                        channel_id: 'ch1',
                        channel_code: 'CALL',
                    }),
                }),
            );
            expect(db.lead.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: 'l1' },
                    data: expect.objectContaining({ last_contacted_at: expect.any(Date) }),
                }),
            );
            expect(res.next).toBeNull();
        });

        it('creates the next activity in the same call, inheriting the purpose', async () => {
            db.crmActivity.findFirst.mockResolvedValueOnce(planned).mockResolvedValue(null);
            db.crmActivity.update.mockResolvedValue({ ...planned, status: 'DONE' });
            db.crmActivity.create.mockResolvedValue({ id: 'a2', subject: 'Confirm payment' });

            const res = await service.complete('t1', 'u1', 'a1', {
                channel: 'CALL',
                summary: 'Spoke to Karim',
                next: { subject: 'Confirm payment', due_at: '2026-08-15T10:00:00Z' },
            } as any);

            expect(db.crmActivity.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        subject: 'Confirm payment',
                        status: 'PLANNED',
                        lead_id: 'l1',
                        purpose_id: 'p1',
                    }),
                }),
            );
            expect(res.next).toEqual({ id: 'a2', subject: 'Confirm payment' });
        });

        it('stamps last_contacted_at on a customer activity too', async () => {
            db.crmActivity.findFirst
                .mockResolvedValueOnce({ ...planned, lead_id: null, customer_id: 'c1' })
                .mockResolvedValue(null);
            db.crmActivity.update.mockResolvedValue({ status: 'DONE' });

            await service.complete('t1', 'u1', 'a1', { channel: 'CALL', summary: 's' } as any);

            expect(db.customer.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ last_contacted_at: expect.any(Date) }),
                }),
            );
        });

        it('rejects a retired channel', async () => {
            db.crmActivity.findFirst.mockResolvedValue(planned);
            taxonomy.resolveByIdOrCode.mockResolvedValue({
                id: 'ch1',
                code: 'CALL',
                name: 'Call',
                is_active: false,
            });

            await expect(
                service.complete('t1', 'u1', 'a1', { channel: 'CALL', summary: 's' } as any),
            ).rejects.toThrow(BadRequestException);
        });
    });

    describe('notifyAssignee()', () => {
        it('notifies an assignee who is not the acting user', async () => {
            db.lead.findFirst.mockResolvedValue({ id: 'l1', status: 'NEW' });
            db.crmActivity.create.mockResolvedValue({ id: 'a1', assigned_to: 'u2', subject: 'Call' });
            db.crmActivity.findFirst.mockResolvedValue(null);

            await service.create('t1', 'u1', {
                lead_id: 'l1',
                subject: 'Call',
                assigned_to: 'u2',
            } as any);

            const notifications = (service as any).notifications;
            expect(notifications.create).toHaveBeenCalledWith(
                't1',
                'u2',
                'CRM_ACTIVITY_ASSIGNED',
                'Call',
                expect.any(String),
                expect.stringContaining('a1'),
            );
        });

        it('does not notify the person who just filled in the form', async () => {
            db.lead.findFirst.mockResolvedValue({ id: 'l1', status: 'NEW' });
            db.crmActivity.create.mockResolvedValue({ id: 'a1', assigned_to: 'u1', subject: 'Call' });
            db.crmActivity.findFirst.mockResolvedValue(null);

            await service.create('t1', 'u1', {
                lead_id: 'l1',
                subject: 'Call',
                assigned_to: 'u1',
            } as any);

            const notifications = (service as any).notifications;
            expect(notifications.create).not.toHaveBeenCalled();
        });

        // A notification outage must not fail the write it describes.
        it('swallows a notification failure', async () => {
            db.lead.findFirst.mockResolvedValue({ id: 'l1', status: 'NEW' });
            db.crmActivity.create.mockResolvedValue({ id: 'a1', assigned_to: 'u2', subject: 'Call' });
            db.crmActivity.findFirst.mockResolvedValue(null);
            (service as any).notifications.create.mockRejectedValue(new Error('smtp down'));

            await expect(
                service.create('t1', 'u1', { lead_id: 'l1', subject: 'Call', assigned_to: 'u2' } as any),
            ).resolves.toBeDefined();
        });
    });
});
