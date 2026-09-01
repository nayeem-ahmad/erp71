import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CrmActivitiesService } from './crm-activities.service';
import { UNASSIGNED_OWNER_FILTER } from '../crm-leads/crm-leads.dto';
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

        /**
         * The neglected-leads tile reads `last_activity_at`. Scheduling the next
         * call is exactly the work it should credit, and before this the only
         * thing that moved a lead out of the count was marking it Lost.
         */
        it('stamps the lead as worked when planning, without claiming contact', async () => {
            db.lead.findFirst.mockResolvedValue({ id: 'l1', status: 'NEW' });
            db.crmActivity.create.mockResolvedValue({ id: 'a1', lead_id: 'l1' });
            db.crmActivity.findFirst.mockResolvedValue(null);

            await service.create('t1', 'u1', {
                lead_id: 'l1',
                subject: 'Call Karim',
                due_at: '2026-08-20T10:00:00Z',
            } as any);

            const touch = db.lead.update.mock.calls.find(
                ([args]: [any]) => args.data.last_activity_at !== undefined,
            );
            expect(touch[0].data.last_activity_at).toBeInstanceOf(Date);
            // Planning a call is not making one.
            expect(touch[0].data.last_contacted_at).toBeUndefined();
        });

        /**
         * Logging a call that already happened is the quickest path in the UI and
         * used to stamp nothing: only complete() marked contact, so the lead read
         * as never contacted, scored nothing for recency, and stayed in the stale
         * list until somebody marked it Lost.
         */
        it('stamps contact as well when the activity is logged already done', async () => {
            db.lead.findFirst.mockResolvedValue({ id: 'l1', status: 'NEW', priority: 'MEDIUM' });
            db.crmActivity.create.mockResolvedValue({ id: 'a1', lead_id: 'l1' });
            db.crmActivity.findFirst.mockResolvedValue(null);
            db.crmActivity.count.mockResolvedValue(1);
            taxonomy.resolveByIdOrCode.mockResolvedValue({
                id: 'ch-call',
                code: 'CALL',
                name: 'Call',
                is_active: true,
            });

            await service.create('t1', 'u1', {
                lead_id: 'l1',
                status: 'DONE',
                summary: 'Spoke to Karim',
                channel: 'CALL',
            } as any);

            const stamp = db.lead.update.mock.calls.find(
                ([args]: [any]) => args.data.last_contacted_at !== undefined,
            );
            expect(stamp[0].data.last_contacted_at).toBeInstanceOf(Date);
            // Contact is a kind of activity, so both move together — a lead we
            // just spoke to can never read as untouched.
            expect(stamp[0].data.last_activity_at).toEqual(stamp[0].data.last_contacted_at);
        });
    });

    describe('create() — assignee', () => {
        beforeEach(() => {
            db.lead.findFirst.mockResolvedValue({ id: 'l1', status: 'NEW' });
            db.crmActivity.create.mockResolvedValue({ id: 'a1', lead_id: 'l1' });
            db.crmActivity.findFirst.mockResolvedValue(null);
        });

        /**
         * Mirrors `CrmLeadsService.create`, which files a lead against its creator.
         * Without this an activity scheduled from the panel is unassigned, which
         * makes the assignee filter blind to it and `notifyAssignee` a no-op.
         */
        it('files a new activity against its creator when no assignee is named', async () => {
            await service.create('t1', 'u1', { lead_id: 'l1', subject: 'Call' } as any);

            expect(db.crmActivity.create.mock.calls[0][0].data).toEqual(
                expect.objectContaining({ assigned_to: 'u1' }),
            );
        });

        it('keeps an explicitly named assignee', async () => {
            await service.create('t1', 'u1', {
                lead_id: 'l1',
                subject: 'Call',
                assigned_to: 'u2',
            } as any);

            expect(db.crmActivity.create.mock.calls[0][0].data).toEqual(
                expect.objectContaining({ assigned_to: 'u2' }),
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

        it('filters created_at to the inclusive Dhaka day range', async () => {
            db.crmActivity.findMany.mockResolvedValue([]);
            db.crmActivity.count.mockResolvedValue(0);
            await service.findAll('t1', { createdFrom: '2026-08-19', createdTo: '2026-08-19' });
            expect(db.crmActivity.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        created_at: {
                            gte: new Date('2026-08-18T18:00:00.000Z'),
                            lte: new Date('2026-08-19T17:59:59.999Z'),
                        },
                    }),
                }),
            );
        });
    });

    describe('findAll() — lead owner filter', () => {
        beforeEach(() => {
            db.crmActivity.findMany.mockResolvedValue([]);
            db.crmActivity.count.mockResolvedValue(0);
        });

        it('filters to activities whose lead is owned by the named user', async () => {
            await service.findAll('t1', { leadOwner: 'user-9' });

            expect(db.crmActivity.findMany.mock.calls[0][0].where).toEqual(
                expect.objectContaining({ lead: { assigned_to: 'user-9' } }),
            );
        });

        it('filters to activities on leads nobody owns for the unassigned sentinel', async () => {
            await service.findAll('t1', { leadOwner: UNASSIGNED_OWNER_FILTER });

            expect(db.crmActivity.findMany.mock.calls[0][0].where).toEqual(
                expect.objectContaining({ lead: { assigned_to: null } }),
            );
        });

        it('does not constrain the lead relation when no owner is given', async () => {
            await service.findAll('t1', {});

            expect(db.crmActivity.findMany.mock.calls[0][0].where).not.toHaveProperty('lead');
        });

        it('leaves the activity assignee filter independent of the lead owner', async () => {
            await service.findAll('t1', { leadOwner: 'user-9', assignedTo: 'user-3' });

            expect(db.crmActivity.findMany.mock.calls[0][0].where).toEqual(
                expect.objectContaining({
                    lead: { assigned_to: 'user-9' },
                    assigned_to: 'user-3',
                }),
            );
        });
    });

    describe('findAll() — due date range', () => {
        beforeEach(() => {
            db.crmActivity.findMany.mockResolvedValue([]);
            db.crmActivity.count.mockResolvedValue(0);
        });

        it('filters due_at to the inclusive Dhaka day range', async () => {
            await service.findAll('t1', { dueFrom: '2026-08-19', dueTo: '2026-08-19' });

            expect(db.crmActivity.findMany.mock.calls[0][0].where.due_at).toEqual({
                gte: new Date('2026-08-18T18:00:00.000Z'),
                lte: new Date('2026-08-19T17:59:59.999Z'),
            });
        });

        it('accepts an open-ended range', async () => {
            await service.findAll('t1', { dueFrom: '2026-08-19' });

            expect(db.crmActivity.findMany.mock.calls[0][0].where.due_at).toEqual({
                gte: new Date('2026-08-18T18:00:00.000Z'),
            });
        });

        it('does not filter on due_at when the range is empty', async () => {
            await service.findAll('t1', {});

            expect(db.crmActivity.findMany.mock.calls[0][0].where).not.toHaveProperty('due_at');
        });

        /**
         * `overdue` and `dueToday` each carry their own due window. Letting either
         * side overwrite the other would silently drop a filter the caller asked
         * for, so the two windows intersect.
         */
        it('intersects the range with the overdue window rather than overwriting it', async () => {
            await service.findAll('t1', { dueFrom: '2026-08-19', dueTo: '2036-01-01', overdue: true });

            const where = db.crmActivity.findMany.mock.calls[0][0].where;
            expect(where.status).toBe('PLANNED');
            // Lower bound is the explicit range; upper bound is overdue's "before today".
            expect(where.due_at.gte).toEqual(new Date('2026-08-18T18:00:00.000Z'));
            expect(where.due_at.lt).toBeInstanceOf(Date);
            expect(where.due_at.lte).toBeUndefined();
        });

        it('keeps the tighter upper bound when the range ends before today', async () => {
            await service.findAll('t1', { dueTo: '2020-01-01', overdue: true });

            const where = db.crmActivity.findMany.mock.calls[0][0].where;
            expect(where.due_at.lte).toEqual(new Date('2020-01-01T17:59:59.999Z'));
            expect(where.due_at.lt).toBeUndefined();
        });

        it('intersects the range with the dueToday window', async () => {
            await service.findAll('t1', { dueFrom: '2030-01-01', dueToday: true });

            const where = db.crmActivity.findMany.mock.calls[0][0].where;
            expect(where.status).toBe('PLANNED');
            // The range's lower bound is the later of the two, so it survives.
            expect(where.due_at.gte).toEqual(new Date('2029-12-31T18:00:00.000Z'));
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

    describe('update()', () => {
        it('recalculates the rollup after a reschedule', async () => {
            db.crmActivity.findFirst
                .mockResolvedValueOnce({ id: 'a1', tenant_id: 't1', lead_id: 'l1', status: 'PLANNED' })
                .mockResolvedValue(null);
            db.crmActivity.update.mockResolvedValue({ id: 'a1', lead_id: 'l1' });

            await service.update('t1', 'a1', { due_at: '2026-09-01T00:00:00Z' } as any);

            expect(db.crmActivity.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ due_at: new Date('2026-09-01T00:00:00Z') }),
                }),
            );
            expect(db.lead.update).toHaveBeenCalled();
        });

        it('refuses to edit a completed activity', async () => {
            db.crmActivity.findFirst.mockResolvedValue({ id: 'a1', tenant_id: 't1', status: 'DONE' });
            await expect(service.update('t1', 'a1', { subject: 'x' } as any)).rejects.toThrow(
                BadRequestException,
            );
        });

        it('404s an unknown id', async () => {
            db.crmActivity.findFirst.mockResolvedValue(null);
            await expect(service.update('t1', 'nope', { subject: 'x' } as any)).rejects.toThrow(
                NotFoundException,
            );
        });
    });

    describe('cancel()', () => {
        it('marks CANCELLED and clears the rollup when nothing planned remains', async () => {
            db.crmActivity.findFirst
                .mockResolvedValueOnce({ id: 'a1', tenant_id: 't1', lead_id: 'l1', status: 'PLANNED' })
                .mockResolvedValue(null);
            db.crmActivity.update.mockResolvedValue({ id: 'a1', lead_id: 'l1' });

            await service.cancel('t1', 'a1');

            expect(db.crmActivity.update).toHaveBeenCalledWith(
                expect.objectContaining({ where: { id: 'a1' }, data: { status: 'CANCELLED' } }),
            );
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
    });

    describe('remove()', () => {
        it('deletes and recalculates the rollup', async () => {
            db.crmActivity.findFirst
                .mockResolvedValueOnce({ id: 'a1', tenant_id: 't1', customer_id: 'c1', status: 'PLANNED' })
                .mockResolvedValue(null);

            await expect(service.remove('t1', 'a1')).resolves.toEqual({ success: true });

            expect(db.crmActivity.delete).toHaveBeenCalledWith({ where: { id: 'a1' } });
            expect(db.customer.update).toHaveBeenCalledWith({
                where: { id: 'c1' },
                data: { next_activity_id: null, next_activity_date: null },
            });
        });
    });

    describe('summary()', () => {
        it('counts due today, overdue and total planned', async () => {
            db.crmActivity.count
                .mockResolvedValueOnce(3)
                .mockResolvedValueOnce(5)
                .mockResolvedValueOnce(11);
            const res = await service.summary('t1');
            expect(res).toEqual({ dueToday: 3, overdue: 5, total: 11 });
        });
    });

    describe('rescoreLead()', () => {
        it('counts DONE activities as the conversation count', async () => {
            db.crmActivity.findFirst
                .mockResolvedValueOnce({
                    id: 'a1',
                    tenant_id: 't1',
                    lead_id: 'l1',
                    status: 'PLANNED',
                    purpose_id: null,
                })
                .mockResolvedValue(null);
            db.crmActivity.update.mockResolvedValue({ status: 'DONE' });
            db.crmActivity.count.mockResolvedValue(4);
            db.lead.findFirst.mockResolvedValue({
                id: 'l1',
                status: 'CONTACTED',
                priority: 'MEDIUM',
                last_contacted_at: null,
                next_step_date: null,
                sourceOption: { score_weight: 20 },
            });
            taxonomy.resolveByIdOrCode.mockResolvedValue({
                id: 'ch1',
                code: 'CALL',
                name: 'Call',
                is_active: true,
            });

            await service.complete('t1', 'u1', 'a1', { channel: 'CALL', summary: 's' } as any);

            expect(db.crmActivity.count).toHaveBeenCalledWith({
                where: { tenant_id: 't1', lead_id: 'l1', status: 'DONE' },
            });
            expect(db.lead.update).toHaveBeenCalledWith(
                expect.objectContaining({ data: expect.objectContaining({ score: expect.any(Number) }) }),
            );
        });

        it('does not rescore a customer activity — customers have no score', async () => {
            db.crmActivity.findFirst
                .mockResolvedValueOnce({
                    id: 'a1', tenant_id: 't1', lead_id: null, customer_id: 'c1', status: 'PLANNED',
                })
                .mockResolvedValue(null);
            db.crmActivity.update.mockResolvedValue({ status: 'DONE' });
            taxonomy.resolveByIdOrCode.mockResolvedValue({
                id: 'ch1', code: 'CALL', name: 'Call', is_active: true,
            });

            await service.complete('t1', 'u1', 'a1', { channel: 'CALL', summary: 's' } as any);

            expect(db.lead.findFirst).not.toHaveBeenCalled();
        });
    });

    describe('crons', () => {
        it('creates a birthday activity with the BIRTHDAY purpose and cron origin', async () => {
            db.$queryRaw.mockResolvedValue([{ id: 'c1', tenant_id: 't1', name: 'Karim' }]);
            db.crmActivity.findFirst.mockResolvedValue(null);
            db.crmActivity.create.mockResolvedValue({ id: 'a1', customer_id: 'c1' });
            taxonomy.resolveByIdOrCode.mockResolvedValue({
                id: 'p-bday',
                code: 'BIRTHDAY',
                name: 'Birthday',
                is_active: true,
            });

            await service.autoCreateBirthdayActivities();

            expect(db.crmActivity.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        customer_id: 'c1',
                        status: 'PLANNED',
                        origin: 'BIRTHDAY_CRON',
                        purpose_id: 'p-bday',
                    }),
                }),
            );
        });

        it('does not duplicate an existing planned birthday activity', async () => {
            db.$queryRaw.mockResolvedValue([{ id: 'c1', tenant_id: 't1', name: 'Karim' }]);
            db.crmActivity.findFirst.mockResolvedValue({ id: 'existing' });
            taxonomy.resolveByIdOrCode.mockResolvedValue({
                id: 'p-bday',
                code: 'BIRTHDAY',
                name: 'Birthday',
                is_active: true,
            });

            await service.autoCreateBirthdayActivities();

            expect(db.crmActivity.create).not.toHaveBeenCalled();
        });

        // One taxonomy round-trip per tenant, not per customer: the birthday
        // sweep runs over every tenant's whole customer base.
        it('resolves the purpose once per tenant, not once per customer', async () => {
            db.$queryRaw.mockResolvedValue([
                { id: 'c1', tenant_id: 't1', name: 'Karim' },
                { id: 'c2', tenant_id: 't1', name: 'Rahim' },
                { id: 'c3', tenant_id: 't2', name: 'Salma' },
            ]);
            db.crmActivity.findFirst.mockResolvedValue(null);
            db.crmActivity.create.mockResolvedValue({ id: 'a1' });
            taxonomy.resolveByIdOrCode.mockResolvedValue({
                id: 'p-bday', code: 'BIRTHDAY', name: 'Birthday', is_active: true,
            });

            await service.autoCreateBirthdayActivities();

            expect(taxonomy.resolveByIdOrCode).toHaveBeenCalledTimes(2);
            expect(db.crmActivity.create).toHaveBeenCalledTimes(3);
        });

        it('treats a null last_contacted_at as dormant', async () => {
            db.customer.findMany.mockResolvedValue([]);
            await service.autoCreateReorderActivities();
            const where = db.customer.findMany.mock.calls[0][0].where;
            expect(where.OR).toEqual([
                { last_contacted_at: { lt: expect.any(Date) } },
                { last_contacted_at: null, created_at: { lt: expect.any(Date) } },
            ]);
        });

        it('creates a reorder activity with the REORDER_REMINDER purpose', async () => {
            db.customer.findMany.mockResolvedValue([{ id: 'c1', tenant_id: 't1', name: 'Karim' }]);
            db.crmActivity.findFirst.mockResolvedValue(null);
            db.crmActivity.create.mockResolvedValue({ id: 'a1', customer_id: 'c1' });
            taxonomy.resolveByIdOrCode.mockResolvedValue({
                id: 'p-reorder', code: 'REORDER_REMINDER', name: 'Reorder Reminder', is_active: true,
            });

            await service.autoCreateReorderActivities();

            expect(db.crmActivity.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        customer_id: 'c1',
                        status: 'PLANNED',
                        origin: 'REORDER_CRON',
                        purpose_id: 'p-reorder',
                    }),
                }),
            );
            // The cron is the sole writer of the customer's next_* rollup too.
            expect(db.customer.update).toHaveBeenCalled();
        });

        // A tenant whose purposes were never seeded must not take the whole
        // sweep down — it runs across every tenant on the platform.
        it('skips a tenant whose BIRTHDAY purpose is missing rather than throwing', async () => {
            db.$queryRaw.mockResolvedValue([{ id: 'c1', tenant_id: 't1', name: 'Karim' }]);
            db.crmActivity.findFirst.mockResolvedValue(null);
            taxonomy.resolveByIdOrCode.mockResolvedValue(null);

            await expect(service.autoCreateBirthdayActivities()).resolves.toBeUndefined();
            expect(db.crmActivity.create).not.toHaveBeenCalled();
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
