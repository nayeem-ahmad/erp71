import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { CrmLeadsService } from './crm-leads.service';
import { CustomersService } from '../customers/customers.service';
import { CustomFieldsService } from '../custom-fields/custom-fields.service';
import { DatabaseService } from '../database/database.service';
import { LeadStatus } from './crm-leads.dto';

describe('CrmLeadsService', () => {
    let service: CrmLeadsService;
    let db: any;
    let customersService: any;
    let customFieldsService: any;

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
        customFieldsService = {
            sanitizeValues: jest.fn().mockResolvedValue(undefined),
            listDefinitions: jest.fn().mockResolvedValue([]),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                CrmLeadsService,
                { provide: DatabaseService, useValue: db },
                { provide: CustomersService, useValue: customersService },
                { provide: CustomFieldsService, useValue: customFieldsService },
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

    describe('create() — custom_fields', () => {
        it('persists the sanitized custom_fields object, not the raw dto value', async () => {
            db.lead.findUnique.mockResolvedValueOnce(null);
            db.lead.create.mockResolvedValueOnce({ id: 'lead-20' });
            customFieldsService.sanitizeValues.mockResolvedValueOnce({ cf_1: 'Gold' });

            await service.create('tenant-1', 'user-1', {
                name: 'Custom Field Lead',
                mobile: '01733333333',
                custom_fields: { cf_1: 'gold  ', unknown_key: 'nope' },
            } as any);

            expect(customFieldsService.sanitizeValues).toHaveBeenCalledWith(
                'tenant-1',
                'LEAD',
                { cf_1: 'gold  ', unknown_key: 'nope' },
            );
            expect(db.lead.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ custom_fields: { cf_1: 'Gold' } }),
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

    describe('update() — custom_fields', () => {
        const existing = {
            id: 'lead-4',
            tenant_id: 'tenant-1',
            mobile: '01744444444',
            status: LeadStatus.CONTACTED,
            source: 'REFERRAL',
            priority: 'HIGH',
            last_contacted_at: null,
            next_step_date: null,
            lost_reason: null,
        };

        it('persists the sanitized custom_fields object and strips the raw value from mapLeadData', async () => {
            db.lead.findFirst.mockResolvedValueOnce(existing);
            customFieldsService.sanitizeValues.mockResolvedValueOnce({ cf_1: 'Gold' });
            db.lead.update.mockResolvedValueOnce({ ...existing });

            await service.update('tenant-1', 'lead-4', {
                custom_fields: { cf_1: 'gold  ', unknown_key: 'nope' },
            } as any);

            expect(customFieldsService.sanitizeValues).toHaveBeenCalledWith(
                'tenant-1',
                'LEAD',
                { cf_1: 'gold  ', unknown_key: 'nope' },
            );
            const updateCall = db.lead.update.mock.calls[0][0];
            expect(updateCall.data.custom_fields).toEqual({ cf_1: 'Gold' });
        });

        it('does not touch custom_fields when sanitizeValues returns undefined', async () => {
            db.lead.findFirst.mockResolvedValueOnce(existing);
            customFieldsService.sanitizeValues.mockResolvedValueOnce(undefined);
            db.lead.update.mockResolvedValueOnce({ ...existing });

            await service.update('tenant-1', 'lead-4', { remarks: 'hi' } as any);

            const updateCall = db.lead.update.mock.calls[0][0];
            expect(updateCall.data).not.toHaveProperty('custom_fields');
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

    describe('importRows()', () => {
        it('creates a new lead from a valid row with defaults applied', async () => {
            db.lead.findUnique.mockResolvedValueOnce(null);
            db.lead.create.mockResolvedValueOnce({ id: 'lead-10' });

            const result = await service.importRows('tenant-1', [
                { name: 'Alice', mobile: '01800000001', email: 'alice@example.com' },
            ], 'skip');

            expect(result).toEqual({ created: 1, updated: 0, skipped: 0, errors: [] });
            expect(db.lead.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        tenant_id: 'tenant-1',
                        name: 'Alice',
                        mobile: '01800000001',
                        email: 'alice@example.com',
                        priority: 'MEDIUM',
                        source: 'OTHER',
                        status: 'NEW',
                    }),
                }),
            );
        });

        it('skips a duplicate mobile in skip mode', async () => {
            db.lead.findUnique.mockResolvedValueOnce({ id: 'lead-existing' });

            const result = await service.importRows('tenant-1', [
                { name: 'Bob', mobile: '01800000002' },
            ], 'skip');

            expect(result).toEqual({ created: 0, updated: 0, skipped: 1, errors: [] });
            expect(db.lead.update).not.toHaveBeenCalled();
        });

        it('updates a duplicate mobile in upsert mode', async () => {
            db.lead.findUnique.mockResolvedValueOnce({ id: 'lead-existing' });
            db.lead.update.mockResolvedValueOnce({ id: 'lead-existing' });

            const result = await service.importRows('tenant-1', [
                { name: 'Bob Updated', mobile: '01800000002', priority: 'HIGH' },
            ], 'upsert');

            expect(result).toEqual({ created: 0, updated: 1, skipped: 0, errors: [] });
            expect(db.lead.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: 'lead-existing' },
                    data: expect.objectContaining({ name: 'Bob Updated', priority: 'HIGH' }),
                }),
            );
        });

        it('does not overwrite existing optional fields when they are absent from the import row', async () => {
            db.lead.findUnique.mockResolvedValueOnce({ id: 'lead-existing' });
            db.lead.update.mockResolvedValueOnce({ id: 'lead-existing' });

            await service.importRows('tenant-1', [
                { name: 'Bob', mobile: '01800000002' },  // no email, address, remarks, category, priority, source, status
            ], 'upsert');

            const updateCall = db.lead.update.mock.calls[0][0];
            expect(updateCall.data).not.toHaveProperty('email');
            expect(updateCall.data).not.toHaveProperty('address');
            expect(updateCall.data).not.toHaveProperty('remarks');
            expect(updateCall.data).not.toHaveProperty('category');
            expect(updateCall.data).not.toHaveProperty('priority');
            expect(updateCall.data).not.toHaveProperty('source');
            expect(updateCall.data).not.toHaveProperty('status');
        });

        it('does not clobber existing status/priority/source in upsert mode when those columns are absent', async () => {
            db.lead.findUnique.mockResolvedValueOnce({ id: 'lead-existing' });
            db.lead.update.mockResolvedValueOnce({ id: 'lead-existing' });

            await service.importRows('tenant-1', [
                { name: 'Bob', mobile: '01800000003' },  // no status, priority, source
            ], 'upsert');

            const updateCall = db.lead.update.mock.calls[0][0];
            expect(updateCall.data).not.toHaveProperty('status');
            expect(updateCall.data).not.toHaveProperty('priority');
            expect(updateCall.data).not.toHaveProperty('source');
        });

        it('reports a row error for missing required fields and continues', async () => {
            db.lead.findUnique.mockResolvedValueOnce(null);
            db.lead.create.mockResolvedValueOnce({ id: 'lead-11' });

            const result = await service.importRows('tenant-1', [
                { name: '', mobile: '' },
                { name: 'Carol', mobile: '01800000003' },
            ], 'skip');

            expect(result.created).toBe(1);
            expect(result.errors).toEqual(['Row 2: missing required field(s): name']);
        });

        it('falls back to defaults for an invalid enum value instead of erroring', async () => {
            db.lead.findUnique.mockResolvedValueOnce(null);
            db.lead.create.mockResolvedValueOnce({ id: 'lead-12' });

            const result = await service.importRows('tenant-1', [
                { name: 'Dana', mobile: '01800000004', priority: 'not-a-priority', source: 'nope' },
            ], 'skip');

            expect(result).toEqual({ created: 1, updated: 0, skipped: 0, errors: [] });
            expect(db.lead.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ priority: 'MEDIUM', source: 'OTHER' }),
                }),
            );
        });

        it('rejects a row with status LOST since lost_reason is not importable', async () => {
            const result = await service.importRows('tenant-1', [
                { name: 'Evan', mobile: '01800000005', status: 'LOST' },
            ], 'skip');

            expect(result.created).toBe(0);
            expect(result.errors).toEqual([
                'Row 2: status LOST requires a lost_reason, which import does not support — set status after import instead',
            ]);
            expect(db.lead.create).not.toHaveBeenCalled();
        });

        it('maps a CSV column matching a custom field label into custom_fields on create', async () => {
            customFieldsService.listDefinitions.mockResolvedValueOnce([
                { key: 'cf_1', label: 'Region', order: 0 },
            ]);
            db.lead.findUnique.mockResolvedValueOnce(null);
            db.lead.create.mockResolvedValueOnce({ id: 'lead-13' });

            const result = await service.importRows('tenant-1', [
                { name: 'Farah', mobile: '01800000006', Region: 'Dhaka' },
            ], 'skip');

            expect(result.created).toBe(1);
            expect(db.lead.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ custom_fields: { cf_1: 'Dhaka' } }),
                }),
            );
        });

        it('matches a custom field label case-insensitively regardless of header casing', async () => {
            customFieldsService.listDefinitions.mockResolvedValueOnce([
                { key: 'cf_1', label: 'Region', order: 0 },
            ]);
            db.lead.findUnique.mockResolvedValueOnce(null);
            db.lead.create.mockResolvedValueOnce({ id: 'lead-14' });

            const result = await service.importRows('tenant-1', [
                { name: 'Alice', mobile: '01900000001', REGION: 'Dhaka' },
            ], 'skip');

            expect(result.created).toBe(1);
            expect(db.lead.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ custom_fields: { cf_1: 'Dhaka' } }),
                }),
            );
        });

        it('maps a row keyed by the custom field key (as emitted by ImportDialog) into custom_fields on create', async () => {
            customFieldsService.listDefinitions.mockResolvedValueOnce([
                { key: 'cf_1', label: 'Region', order: 0 },
            ]);
            db.lead.findUnique.mockResolvedValueOnce(null);
            db.lead.create.mockResolvedValueOnce({ id: 'lead-15' });

            const result = await service.importRows('tenant-1', [
                { name: 'Alice', mobile: '01900000002', cf_1: 'Dhaka' },
            ], 'skip');

            expect(result.created).toBe(1);
            expect(db.lead.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ custom_fields: { cf_1: 'Dhaka' } }),
                }),
            );
        });
    });
});
