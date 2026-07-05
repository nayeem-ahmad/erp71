import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { CrmLeadsService } from './crm-leads.service';
import { CustomersService } from '../customers/customers.service';
import { DatabaseService } from '../database/database.service';
import { LeadStatus } from './crm-leads.dto';

describe('CrmLeadsService', () => {
    let service: CrmLeadsService;
    let db: any;
    let customersService: any;

    beforeEach(async () => {
        db = {
            lead: {
                findUnique: jest.fn(),
                findFirst: jest.fn(),
                create: jest.fn(),
                update: jest.fn(),
                groupBy: jest.fn(),
            },
            leadConversation: {
                count: jest.fn().mockResolvedValue(0),
            },
            customer: {
                findFirst: jest.fn(),
            },
        };
        customersService = {
            create: jest.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                CrmLeadsService,
                { provide: DatabaseService, useValue: db },
                { provide: CustomersService, useValue: customersService },
            ],
        }).compile();

        service = module.get<CrmLeadsService>(CrmLeadsService);
    });

    describe('convert()', () => {
        const lead = {
            id: 'lead-1',
            tenant_id: 'tenant-1',
            name: 'Jane Doe',
            mobile: '01700000000',
            email: 'jane@example.com',
            address: 'Dhaka',
            status: LeadStatus.QUALIFIED,
        };

        it('creates a customer, marks the lead CONVERTED, and pins score to 100', async () => {
            db.lead.findFirst.mockResolvedValueOnce(lead);
            db.customer.findFirst.mockResolvedValueOnce(null);
            customersService.create.mockResolvedValueOnce({ id: 'cust-1', name: 'Jane Doe', phone: '01700000000' });
            db.lead.update.mockResolvedValueOnce({ ...lead, status: LeadStatus.CONVERTED, converted_customer_id: 'cust-1', score: 100 });

            const result = await service.convert('tenant-1', 'lead-1');

            expect(customersService.create).toHaveBeenCalledWith('tenant-1', {
                name: 'Jane Doe',
                phone: '01700000000',
                email: 'jane@example.com',
                address: 'Dhaka',
            });
            expect(db.lead.update).toHaveBeenCalledWith({
                where: { id: 'lead-1' },
                data: {
                    status: LeadStatus.CONVERTED,
                    converted_customer_id: 'cust-1',
                    score: 100,
                },
                include: expect.anything(),
            });
            expect(result.customer.id).toBe('cust-1');
        });

        it('throws NotFoundException when the lead does not exist', async () => {
            db.lead.findFirst.mockResolvedValueOnce(null);
            await expect(service.convert('tenant-1', 'missing')).rejects.toThrow(NotFoundException);
        });

        it('throws BadRequestException when the lead is already converted', async () => {
            db.lead.findFirst.mockResolvedValueOnce({ ...lead, status: LeadStatus.CONVERTED });
            await expect(service.convert('tenant-1', 'lead-1')).rejects.toThrow(BadRequestException);
        });

        it('throws ConflictException when a customer with the same mobile already exists', async () => {
            db.lead.findFirst.mockResolvedValueOnce(lead);
            db.customer.findFirst.mockResolvedValueOnce({ id: 'existing-cust', name: 'Jane Doe', phone: '01700000000' });

            await expect(service.convert('tenant-1', 'lead-1')).rejects.toThrow(ConflictException);
            expect(customersService.create).not.toHaveBeenCalled();
        });
    });

    describe('create() — lost_reason validation', () => {
        it('rejects creating a LOST lead without a lost_reason', async () => {
            db.lead.findUnique.mockResolvedValueOnce(null);

            await expect(
                service.create('tenant-1', 'user-1', {
                    name: 'Bad Lead',
                    mobile: '01711111111',
                    status: LeadStatus.LOST,
                } as any),
            ).rejects.toThrow(BadRequestException);
            expect(db.lead.create).not.toHaveBeenCalled();
        });

        it('accepts creating a LOST lead when lost_reason is provided', async () => {
            db.lead.findUnique.mockResolvedValueOnce(null);
            db.lead.create.mockResolvedValueOnce({ id: 'lead-2' });

            await service.create('tenant-1', 'user-1', {
                name: 'Bad Lead',
                mobile: '01711111111',
                status: LeadStatus.LOST,
                lost_reason: 'Went with a competitor',
            } as any);

            expect(db.lead.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ lost_reason: 'Went with a competitor', score: 0 }),
                }),
            );
        });
    });

    describe('update() — lost_reason validation', () => {
        const existing = {
            id: 'lead-3',
            tenant_id: 'tenant-1',
            mobile: '01722222222',
            status: LeadStatus.CONTACTED,
            source: 'REFERRAL',
            priority: 'HIGH',
            last_contacted_at: null,
            next_step_date: null,
            lost_reason: null,
        };

        it('rejects moving a lead to LOST without a lost_reason', async () => {
            db.lead.findFirst.mockResolvedValueOnce(existing);

            await expect(
                service.update('tenant-1', 'lead-3', { status: LeadStatus.LOST } as any),
            ).rejects.toThrow(BadRequestException);
            expect(db.lead.update).not.toHaveBeenCalled();
        });

        it('accepts moving a lead to LOST with a lost_reason and recomputes score to 0', async () => {
            db.lead.findFirst.mockResolvedValueOnce(existing);
            db.leadConversation.count.mockResolvedValueOnce(3);
            db.lead.update.mockResolvedValueOnce({ ...existing, status: LeadStatus.LOST });

            await service.update('tenant-1', 'lead-3', {
                status: LeadStatus.LOST,
                lost_reason: 'Price too high',
            } as any);

            expect(db.lead.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ lost_reason: 'Price too high', score: 0 }),
                }),
            );
        });
    });

    describe('getStatusSummary()', () => {
        it('fills in zero counts for statuses with no leads and sums the open pipeline', async () => {
            db.lead.groupBy.mockResolvedValueOnce([
                { status: LeadStatus.NEW, _count: { _all: 4 } },
                { status: LeadStatus.QUALIFIED, _count: { _all: 2 } },
                { status: LeadStatus.CONVERTED, _count: { _all: 5 } },
            ]);

            const result = await service.getStatusSummary('tenant-1');

            expect(result.counts).toEqual({
                NEW: 4,
                CONTACTED: 0,
                QUALIFIED: 2,
                LOST: 0,
                CONVERTED: 5,
            });
            expect(result.open).toBe(6);
        });
    });
});
