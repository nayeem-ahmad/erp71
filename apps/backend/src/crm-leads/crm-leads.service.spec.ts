import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { CrmLeadsService } from './crm-leads.service';
import { CustomersService } from '../customers/customers.service';
import { CustomFieldsService } from '../custom-fields/custom-fields.service';
import { DatabaseService } from '../database/database.service';
import { CrmLeadTaxonomyService } from '../crm-lead-taxonomy/crm-lead-taxonomy.service';
import { LeadStatus } from './crm-leads.dto';

describe('CrmLeadsService', () => {
    let service: CrmLeadsService;
    let db: any;
    let customersService: any;
    let customFieldsService: any;
    let taxonomyService: any;

    /** The seeded fallback row every tenant has. */
    const OTHER_SOURCE = {
        id: 'src-other',
        code: 'OTHER',
        name: 'Other',
        score_weight: 5,
        is_active: true,
    };

    beforeEach(async () => {
        db = {
            lead: {
                findUnique: jest.fn(),
                findFirst: jest.fn(),
                findMany: jest.fn(),
                count: jest.fn(),
                create: jest.fn(),
                update: jest.fn(),
                groupBy: jest.fn(),
            },
            leadConversation: {
                count: jest.fn().mockResolvedValue(0),
            },
            crmActivity: {
                create: jest.fn().mockResolvedValue({ id: 'act-1' }),
                updateMany: jest.fn().mockResolvedValue({ count: 0 }),
                count: jest.fn().mockResolvedValue(0),
            },
            leadSourceOption: {
                findFirst: jest.fn().mockResolvedValue(OTHER_SOURCE),
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
        taxonomyService = {
            resolveByIdOrCode: jest.fn().mockResolvedValue(null),
            fallbackSource: jest.fn().mockResolvedValue(OTHER_SOURCE),
            list: jest.fn().mockResolvedValue([]),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                CrmLeadsService,
                { provide: DatabaseService, useValue: db },
                { provide: CustomersService, useValue: customersService },
                { provide: CustomFieldsService, useValue: customFieldsService },
                { provide: CrmLeadTaxonomyService, useValue: taxonomyService },
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
                    closed_at: expect.any(Date),
                    score: 100,
                    next_step: null,
                    next_step_date: null,
                    next_step_assigned_to: null,
                    next_activity_id: null,
                },
                include: expect.anything(),
            });
            expect(result.customer.id).toBe('cust-1');
        });

        // A converted lead is done being worked. Leaving its planned activities
        // open kept them in the overdue count forever, while the create path
        // refused to add new ones — the two halves disagreed.
        it('cancels planned activities and clears the rollup', async () => {
            db.lead.findFirst.mockResolvedValueOnce(lead);
            db.customer.findFirst.mockResolvedValueOnce(null);
            customersService.create.mockResolvedValueOnce({ id: 'cust-1' });
            db.lead.update.mockResolvedValueOnce({ ...lead, status: LeadStatus.CONVERTED });

            await service.convert('tenant-1', 'lead-1');

            expect(db.crmActivity.updateMany).toHaveBeenCalledWith({
                where: { tenant_id: 'tenant-1', lead_id: 'lead-1', status: 'PLANNED' },
                data: { status: 'CANCELLED' },
            });
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

    describe('update() lifecycle', () => {
        it('cancels planned activities and clears the rollup when a lead is marked LOST', async () => {
            db.lead.findFirst.mockResolvedValue({
                id: 'lead-1',
                tenant_id: 'tenant-1',
                status: LeadStatus.QUALIFIED,
                lost_reason: null,
                priority: 'MEDIUM',
                last_contacted_at: null,
                next_step_date: null,
                source_id: 'src-other',
            });
            db.lead.update.mockResolvedValue({ id: 'lead-1', status: LeadStatus.LOST });

            await service.update('tenant-1', 'lead-1', {
                status: LeadStatus.LOST,
                lost_reason: 'Bought elsewhere',
            } as any);

            expect(db.crmActivity.updateMany).toHaveBeenCalledWith({
                where: { tenant_id: 'tenant-1', lead_id: 'lead-1', status: 'PLANNED' },
                data: { status: 'CANCELLED' },
            });
            const data = db.lead.update.mock.calls[0][0].data;
            expect(data.next_step).toBeNull();
            expect(data.next_step_date).toBeNull();
            expect(data.next_step_assigned_to).toBeNull();
            expect(data.next_activity_id).toBeNull();
        });

        // next_step* became a read-only rollup of the earliest PLANNED activity
        // in R1. A hand-typed value reaching the column would drift from the
        // activity list it is supposed to cache.
        it('ignores next_step on lead update', async () => {
            db.lead.findFirst.mockResolvedValue({
                id: 'lead-1',
                tenant_id: 'tenant-1',
                status: LeadStatus.NEW,
                lost_reason: null,
                priority: 'MEDIUM',
                last_contacted_at: null,
                next_step_date: null,
                source_id: 'src-other',
            });
            db.lead.update.mockResolvedValue({ id: 'lead-1' });

            await service.update('tenant-1', 'lead-1', {
                name: 'Karim',
                next_step: 'hand-typed',
                next_step_date: '2026-09-01',
                next_step_assigned_to: 'user-9',
            } as any);

            const data = db.lead.update.mock.calls[0][0].data;
            expect(data.next_step).toBeUndefined();
            expect(data.next_step_date).toBeUndefined();
            expect(data.next_step_assigned_to).toBeUndefined();
        });

        it('leaves activities alone on an ordinary edit', async () => {
            db.lead.findFirst.mockResolvedValue({
                id: 'lead-1',
                tenant_id: 'tenant-1',
                status: LeadStatus.QUALIFIED,
                lost_reason: null,
                priority: 'MEDIUM',
                last_contacted_at: null,
                next_step_date: null,
                source_id: 'src-other',
            });
            db.lead.update.mockResolvedValue({ id: 'lead-1' });

            await service.update('tenant-1', 'lead-1', { name: 'Renamed' } as any);

            expect(db.crmActivity.updateMany).not.toHaveBeenCalled();
        });
    });

    describe('create() — opening next step', () => {
        it('seeds a PLANNED activity and derives the rollup from it', async () => {
            db.lead.findUnique.mockResolvedValueOnce(null);
            db.lead.create.mockResolvedValueOnce({ id: 'lead-9' });

            await service.create('tenant-1', 'user-1', {
                name: 'Karim',
                mobile: '01722222222',
                next_step: 'Call back Thursday',
                next_step_date: '2026-09-01T00:00:00Z',
                next_step_assigned_to: 'user-2',
            } as any);

            // The columns are a rollup now — create() must not write them directly.
            const created = db.lead.create.mock.calls[0][0].data;
            expect(created.next_step).toBeUndefined();
            expect(created.next_step_date).toBeUndefined();
            expect(created.next_step_assigned_to).toBeUndefined();

            expect(db.crmActivity.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        tenant_id: 'tenant-1',
                        lead_id: 'lead-9',
                        subject: 'Call back Thursday',
                        status: 'PLANNED',
                        origin: 'MANUAL',
                        assigned_to: 'user-2',
                    }),
                }),
            );
            expect(db.lead.update).toHaveBeenCalledWith({
                where: { id: 'lead-9' },
                data: {
                    next_step: 'Call back Thursday',
                    next_step_date: new Date('2026-09-01T00:00:00Z'),
                    next_step_assigned_to: 'user-2',
                    next_activity_id: 'act-1',
                },
                include: expect.anything(),
            });
        });

        it('creates no activity when no next step is given', async () => {
            db.lead.findUnique.mockResolvedValueOnce(null);
            db.lead.create.mockResolvedValueOnce({ id: 'lead-9' });

            await service.create('tenant-1', 'user-1', {
                name: 'Karim',
                mobile: '01722222222',
            } as any);

            expect(db.crmActivity.create).not.toHaveBeenCalled();
            expect(db.lead.update).not.toHaveBeenCalled();
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

    describe('update() — closed_at', () => {
        const lost = {
            id: 'lead-9',
            tenant_id: 'tenant-1',
            mobile: '01799999999',
            status: LeadStatus.LOST,
            source: 'REFERRAL',
            priority: 'MEDIUM',
            last_contacted_at: null,
            next_step_date: null,
            lost_reason: 'Price too high',
        };

        it('stamps the close date when a lead reaches a terminal status', async () => {
            db.lead.findFirst.mockResolvedValueOnce({ ...lost, status: LeadStatus.QUALIFIED, lost_reason: null });
            db.lead.update.mockResolvedValueOnce(lost);

            await service.update('tenant-1', 'lead-9', {
                status: LeadStatus.LOST,
                lost_reason: 'Price too high',
            } as any);

            expect(db.lead.update).toHaveBeenCalledWith(
                expect.objectContaining({ data: expect.objectContaining({ closed_at: expect.any(Date) }) }),
            );
        });

        it('leaves the close date alone when an already-lost lead is edited', async () => {
            db.lead.findFirst.mockResolvedValueOnce(lost);
            db.lead.update.mockResolvedValueOnce(lost);

            // No status in the payload — a note edit must not re-date the loss, or
            // the dashboard would count it again in whatever period this happened.
            await service.update('tenant-1', 'lead-9', { remarks: 'Called again' } as any);

            const [[call]] = db.lead.update.mock.calls;
            expect(call.data).not.toHaveProperty('closed_at');
        });

        it('clears the close date when a closed lead is reopened', async () => {
            db.lead.findFirst.mockResolvedValueOnce(lost);
            db.lead.update.mockResolvedValueOnce({ ...lost, status: LeadStatus.CONTACTED });

            await service.update('tenant-1', 'lead-9', { status: LeadStatus.CONTACTED } as any);

            expect(db.lead.update).toHaveBeenCalledWith(
                expect.objectContaining({ data: expect.objectContaining({ closed_at: null, lost_reason: null }) }),
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

        // A lead filed with an opening next step is the common path, and there is
        // no activity to attach it to yet — so create() makes one rather than
        // writing the rollup columns by hand.
        it('creates an activity rather than writing next_step on CSV import', async () => {
            db.lead.findUnique.mockResolvedValueOnce(null);
            db.lead.create.mockResolvedValueOnce({ id: 'lead-10' });

            await service.importRows(
                'tenant-1',
                [{ name: 'Alice', mobile: '01800000001', next_step: 'Call back', next_step_date: '2026-09-01' }],
                'skip',
            );

            const created = db.lead.create.mock.calls[0][0].data;
            expect(created.next_step).toBeUndefined();
            expect(created.next_step_date).toBeUndefined();

            expect(db.crmActivity.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        lead_id: 'lead-10',
                        subject: 'Call back',
                        origin: 'IMPORT',
                        status: 'PLANNED',
                    }),
                }),
            );
            expect(db.lead.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: 'lead-10' },
                    data: expect.objectContaining({
                        next_step: 'Call back',
                        next_activity_id: 'act-1',
                    }),
                }),
            );
        });

        it('imports a row with no next_step without creating an activity', async () => {
            db.lead.findUnique.mockResolvedValueOnce(null);
            db.lead.create.mockResolvedValueOnce({ id: 'lead-11' });

            await service.importRows('tenant-1', [{ name: 'Bob', mobile: '01800000003' }], 'skip');

            expect(db.crmActivity.create).not.toHaveBeenCalled();
        });

        // An upsert import is a bulk sync that re-runs over unchanged rows.
        // Seeding unconditionally would pile up one duplicate activity per run.
        it('does not re-seed an activity that already matches on a re-import', async () => {
            db.lead.findUnique.mockResolvedValueOnce({ id: 'lead-existing' });
            db.lead.update.mockResolvedValueOnce({ id: 'lead-existing' });
            db.crmActivity.count.mockResolvedValueOnce(1);

            await service.importRows(
                'tenant-1',
                [{ name: 'Bob', mobile: '01800000002', next_step: 'Call back', next_step_date: '2026-09-01' }],
                'upsert',
            );

            expect(db.crmActivity.create).not.toHaveBeenCalled();
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

        it('falls back to MEDIUM for an unrecognised priority', async () => {
            db.lead.findUnique.mockResolvedValueOnce(null);
            db.lead.create.mockResolvedValueOnce({ id: 'lead-12' });

            const result = await service.importRows('tenant-1', [
                { name: 'Dana', mobile: '01800000004', priority: 'not-a-priority' },
            ], 'skip');

            expect(result).toEqual({ created: 1, updated: 0, skipped: 0, errors: [] });
            expect(db.lead.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ priority: 'MEDIUM', source: 'OTHER' }),
                }),
            );
        });

        it('rejects the row for an unrecognised source rather than silently storing OTHER', async () => {
            // Sources are tenant-defined now, so an unmatched value is a real
            // mistake in the spreadsheet, not a value to coerce away. Coercing
            // used to report success while destroying the lead's provenance.
            const result = await service.importRows('tenant-1', [
                { name: 'Dana', mobile: '01800000004', source: 'nope' },
            ], 'skip');

            expect(result.created).toBe(0);
            expect(result.errors).toEqual([
                'Row 2: unknown source "nope" — add it under CRM → Settings → Lead Sources, or correct the spreadsheet',
            ]);
            expect(db.lead.create).not.toHaveBeenCalled();
        });

        it('matches a source by its display name, not just its code', async () => {
            db.lead.findUnique.mockResolvedValueOnce(null);
            db.lead.create.mockResolvedValueOnce({ id: 'lead-13' });
            taxonomyService.list.mockImplementation((_t: string, kind: string) =>
                Promise.resolve(
                    kind === 'sources'
                        ? [{ id: 'src-walk', code: 'WALK_IN', name: 'Walk-in', score_weight: 15 }]
                        : [],
                ),
            );

            const result = await service.importRows('tenant-1', [
                { name: 'Dana', mobile: '01800000004', source: 'walk-in' },
            ], 'skip');

            expect(result.created).toBe(1);
            expect(db.lead.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ source_id: 'src-walk', source: 'WALK_IN' }),
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

    describe('findAll sorting', () => {
        beforeEach(() => {
            db.lead.findMany.mockResolvedValue([]);
            db.lead.count.mockResolvedValue(0);
        });

        it('passes an allowlisted sort to orderBy', async () => {
            await service.findAll('tenant-1', { sortBy: 'name', sortDir: 'desc' });
            const arg = (db.lead.findMany as jest.Mock).mock.calls[0][0];
            expect(arg.orderBy).toEqual({ name: 'desc' });
        });

        it('falls back to default order for an unknown sort key', async () => {
            await service.findAll('tenant-1', { sortBy: 'password', sortDir: 'asc' });
            const arg = (db.lead.findMany as jest.Mock).mock.calls[0][0];
            expect(arg.orderBy).toEqual([{ next_step_date: 'asc' }, { updated_at: 'desc' }]);
        });

        it('falls back to default order when no sort is given', async () => {
            await service.findAll('tenant-1', {});
            const arg = (db.lead.findMany as jest.Mock).mock.calls[0][0];
            expect(arg.orderBy).toEqual([{ next_step_date: 'asc' }, { updated_at: 'desc' }]);
        });
    });
});
