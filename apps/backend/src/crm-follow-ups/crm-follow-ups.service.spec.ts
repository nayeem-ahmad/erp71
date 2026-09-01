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
            lead: { findFirst: jest.fn(), update: jest.fn() },
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

        /**
         * This table is legacy — CrmActivity replaced it in R1 — but it stays
         * writable through R2, so it can still be the only record of a lead being
         * worked. The neglected-leads tile reads `last_activity_at`, so a
         * follow-up scheduled here has to move it or the lead reads as untouched.
         */
        it('stamps the lead as worked when a follow-up is scheduled', async () => {
            db.lead.findFirst.mockResolvedValue({ id: 'lead-1', status: 'NEW' });
            db.crmFollowUp.create.mockResolvedValue({ id: 'fu-1' });

            await service.create('tenant-1', 'user-1', {
                lead_id: 'lead-1',
                type: 'GENERAL' as any,
                title: 'Chase the quote',
                due_at: '2026-09-10',
            });

            expect(db.lead.update).toHaveBeenCalledWith({
                where: { id: 'lead-1' },
                data: { last_activity_at: expect.any(Date) },
            });
        });

        it('leaves a customer-targeted follow-up alone', async () => {
            db.customer.findFirst.mockResolvedValue({ id: 'cust-1' });
            db.crmFollowUp.create.mockResolvedValue({ id: 'fu-1' });

            await service.create('tenant-1', 'user-1', {
                customer_id: 'cust-1',
                type: 'GENERAL' as any,
                title: 'Chase the quote',
                due_at: '2026-09-10',
            });

            // Customers carry no `last_activity_at` — nothing reads a neglect
            // signal off them, so there is nothing to stamp.
            expect(db.lead.update).not.toHaveBeenCalled();
        });
    });

    describe('update()', () => {
        it('stamps the lead as worked when a follow-up is rescheduled or closed', async () => {
            db.crmFollowUp.findFirst.mockResolvedValue({
                id: 'fu-1',
                tenant_id: 'tenant-1',
                lead_id: 'lead-1',
            });
            db.crmFollowUp.update.mockResolvedValue({ id: 'fu-1' });

            await service.update('tenant-1', 'fu-1', { status: 'DONE' } as any);

            const leadUpdate = db.lead.update.mock.calls[0][0];
            expect(leadUpdate.data.last_activity_at).toBeInstanceOf(Date);
            // Not contact, even on DONE: this table records only that the prompt
            // was cleared, never whether anyone was actually reached.
            expect(leadUpdate.data.last_contacted_at).toBeUndefined();
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
