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

        // unskipped in Task 4, where recalculateRollup stops being a stub
        it.skip('creates a planned activity and recalculates the rollup', async () => {
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
});
