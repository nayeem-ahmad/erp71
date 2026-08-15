import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CrmFollowUpsService } from './crm-follow-ups.service';
import { DatabaseService } from '../database/database.service';

// The birthday and reorder cron cases that used to live here moved to
// crm-activities.service.spec.ts in R1, along with the crons themselves.
describe('CrmFollowUpsService', () => {
    let service: CrmFollowUpsService;
    let db: any;

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
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [CrmFollowUpsService, { provide: DatabaseService, useValue: db }],
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
