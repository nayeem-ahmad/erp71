import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { CrmLeadsService } from './crm-leads.service';
import { CustomersService } from '../customers/customers.service';
import { CustomFieldsService } from '../custom-fields/custom-fields.service';
import { DatabaseService } from '../database/database.service';
import { CrmLeadTaxonomyService } from '../crm-lead-taxonomy/crm-lead-taxonomy.service';
import { LeadBulkAction, LeadStatus, NO_TAXONOMY_FILTER, OPEN_LEAD_STATUS_FILTER, UNASSIGNED_OWNER_FILTER } from './crm-leads.dto';
import { AssetsService } from '../assets/assets.service';
import { CrmPhotosService } from '../crm-photos/crm-photos.service';
import { normalizeLeadMobile } from '@erp71/shared-types';
import { LeadStatusResolver } from './lead-status.resolver';

describe('CrmLeadsService', () => {
    let service: CrmLeadsService;
    let db: any;
    let customersService: any;
    let customFieldsService: any;
    let taxonomyService: any;
    let assets: any;

    /** The seeded fallback row every tenant has. */
    const OTHER_SOURCE = {
        id: 'src-other',
        code: 'OTHER',
        name: 'Other',
        score_weight: 5,
        is_active: true,
    };

    /**
     * What the dedupe lookup returns when a lead already holds that mobile.
     * The normalized columns come back too: the service reads them to name which
     * field collided in the message it raises.
     */
    function existingByMobile(mobile: string, id = 'lead-existing') {
        return {
            id,
            mobile_norm: normalizeLeadMobile(mobile),
            email_norm: null,
            linkedin_norm: null,
        };
    }

    function contactRow(extra: Record<string, unknown> = {}) {
        return {
            id: 'contact-1',
            mobile: null as string | null,
            mobile_norm: null as string | null,
            linkedin_url: null as string | null,
            linkedin_norm: null as string | null,
            organization_id: null as string | null,
            created_at: new Date('2020-01-01T00:00:00.000Z'),
            ...extra,
        };
    }

    /** The tenant's stages: the five seeded ones plus one custom open stage. */
    const STAGES = [
        { id: 'st-new', code: 'NEW', name: 'New', lifecycle: 'NEW', is_active: true },
        { id: 'st-con', code: 'CONTACTED', name: 'Contacted', lifecycle: 'CONTACTED', is_active: true },
        { id: 'st-qual', code: 'QUALIFIED', name: 'Qualified', lifecycle: 'QUALIFIED', is_active: true },
        { id: 'st-won', code: 'CONVERTED', name: 'Converted', lifecycle: 'CONVERTED', is_active: true },
        { id: 'st-lost', code: 'LOST', name: 'Lost', lifecycle: 'LOST', is_active: true },
        { id: 'st-neg', code: 'NEGOTIATION', name: 'Negotiation', lifecycle: 'QUALIFIED', is_active: true },
    ];

    beforeEach(async () => {
        db = {
            $transaction: jest.fn(async (fn: any) => fn(db)),
            crmContact: {
                findMany: jest.fn().mockResolvedValue([]),
                findFirst: jest.fn().mockResolvedValue(null),
                create: jest.fn().mockResolvedValue({ id: 'contact-1', organization_id: null }),
                update: jest.fn(),
            },
            leadStatusOption: {
                findFirst: jest.fn(async ({ where }: any) =>
                    STAGES.find((r) =>
                        (where.id === undefined || r.id === where.id) &&
                        (where.code === undefined || r.code === where.code),
                    ) ?? null,
                ),
                findMany: jest.fn().mockResolvedValue([]),
            },
            lead: {
                findUnique: jest.fn(),
                findFirst: jest.fn(),
                findMany: jest.fn(),
                count: jest.fn(),
                create: jest.fn(),
                update: jest.fn(),
                delete: jest.fn(),
                deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
                groupBy: jest.fn().mockResolvedValue([]),
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
        assets = {
            isEnabled: jest.fn().mockReturnValue(true),
            uploadBuffer: jest.fn(),
            deleteFile: jest.fn().mockResolvedValue(undefined),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                CrmLeadsService,
                LeadStatusResolver,
                { provide: DatabaseService, useValue: db },
                { provide: CustomersService, useValue: customersService },
                { provide: CustomFieldsService, useValue: customFieldsService },
                { provide: CrmLeadTaxonomyService, useValue: taxonomyService },
                { provide: AssetsService, useValue: assets },
                { provide: CrmPhotosService, useValue: new CrmPhotosService(assets as any) },
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

            const result = await service.convert('tenant-1', 'lead-1', 'branch-a');

            expect(customersService.create).toHaveBeenCalledWith('tenant-1', {
                name: 'Jane Doe',
                phone: '01700000000',
                email: 'jane@example.com',
                address: 'Dhaka',
            }, { storeId: 'branch-a' });
            expect(db.lead.update).toHaveBeenCalledWith({
                where: { id: 'lead-1' },
                data: {
                    status: LeadStatus.CONVERTED,
                    status_id: 'st-won',
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
            db.lead.findFirst.mockResolvedValueOnce({ ...lead, contact_id: 'contact-1' });
            db.customer.findFirst.mockResolvedValueOnce({ id: 'existing-cust', name: 'Jane Doe', phone: '01700000000' });

            await expect(service.convert('tenant-1', 'lead-1')).rejects.toThrow(ConflictException);
            expect(customersService.create).not.toHaveBeenCalled();
            expect(db.crmContact.update).not.toHaveBeenCalled();
            expect(db.crmContact.findFirst).not.toHaveBeenCalled();
        });

        it('sets the contact customer_id when it is null, and nothing else', async () => {
            db.lead.findFirst.mockResolvedValueOnce({ ...lead, contact_id: 'contact-1' });
            db.customer.findFirst.mockResolvedValueOnce(null);
            customersService.create.mockResolvedValueOnce({ id: 'cust-1', name: 'Jane Doe', phone: '01700000000' });
            db.lead.update.mockResolvedValueOnce({ ...lead, status: LeadStatus.CONVERTED, converted_customer_id: 'cust-1' });
            db.crmContact.findFirst.mockResolvedValueOnce({ customer_id: null });

            await service.convert('tenant-1', 'lead-1', 'branch-a');

            expect(db.crmContact.findFirst).toHaveBeenCalledWith({
                where: { id: 'contact-1', tenant_id: 'tenant-1' },
                select: { customer_id: true },
            });
            expect(db.crmContact.update).toHaveBeenCalledTimes(1);
            expect(db.crmContact.update).toHaveBeenCalledWith({
                where: { id: 'contact-1' },
                data: { customer_id: 'cust-1' },
            });
            expect(db.crmContact.update.mock.invocationCallOrder[0]).toBeGreaterThan(
                db.lead.update.mock.invocationCallOrder[0],
            );
        });

        it('does not update a contact when contact_id is null or customer_id is already set', async () => {
            db.lead.findFirst.mockResolvedValueOnce({ ...lead, contact_id: null });
            db.customer.findFirst.mockResolvedValueOnce(null);
            customersService.create.mockResolvedValueOnce({ id: 'cust-1' });
            db.lead.update.mockResolvedValueOnce({ ...lead, status: LeadStatus.CONVERTED });

            await service.convert('tenant-1', 'lead-1');
            expect(db.crmContact.findFirst).not.toHaveBeenCalled();
            expect(db.crmContact.update).not.toHaveBeenCalled();

            db.lead.findFirst.mockResolvedValueOnce({ ...lead, contact_id: 'contact-1' });
            db.customer.findFirst.mockResolvedValueOnce(null);
            customersService.create.mockResolvedValueOnce({ id: 'cust-2' });
            db.lead.update.mockResolvedValueOnce({ ...lead, status: LeadStatus.CONVERTED });
            db.crmContact.findFirst.mockResolvedValueOnce({ customer_id: 'cust-old' });

            await service.convert('tenant-1', 'lead-1');
            expect(db.crmContact.update).not.toHaveBeenCalled();
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

    describe('duplicate detection', () => {
        it('links one contact when a create reuses a mobile spelled differently', async () => {
            // Two deals may share one person. The old check rejected the second
            // spelling before a lead row existed.
            db.lead.findFirst.mockResolvedValueOnce(existingByMobile('01712345678'));
            db.crmContact.findMany.mockResolvedValueOnce([
                contactRow({
                    id: 'contact-1',
                    mobile: '01712345678',
                    mobile_norm: '+8801712345678',
                }),
            ]);
            db.lead.create.mockResolvedValueOnce({ id: 'lead-9' });

            await service.create(
                'tenant-1',
                'user-1',
                { name: 'Karim', mobile: '+880 1712-345678' } as any,
                'Asia/Dhaka',
            );

            expect(db.lead.create).toHaveBeenCalledTimes(1);
            const created = db.lead.create.mock.calls[0][0].data;
            expect(created.contact_id).toBe('contact-1');
            expect(created.mobile).toBe('+880 1712-345678');
            expect(created.mobile_norm).toBe('+8801712345678');
            expect(db.crmContact.create).not.toHaveBeenCalled();
            expect(db.crmContact.update).not.toHaveBeenCalled();
        });

        it('lets two leads keep an email that is already stored', async () => {
            db.lead.findFirst.mockResolvedValue({
                id: 'lead-existing',
                mobile_norm: null,
                email_norm: 'karim@shop.com',
                linkedin_norm: null,
            });
            db.lead.create.mockResolvedValue({ id: 'lead-new' });

            await service.create(
                'tenant-1',
                'user-1',
                { name: 'Karim', email: 'Karim@Shop.com' } as any,
                'Asia/Dhaka',
            );
            await service.create(
                'tenant-1',
                'user-1',
                { name: 'Karim Two', email: 'karim@shop.com' } as any,
                'Asia/Dhaka',
            );

            expect(db.lead.create).toHaveBeenCalledTimes(2);
            expect(db.lead.create.mock.calls[0][0].data.email).toBe('Karim@Shop.com');
            expect(db.lead.create.mock.calls[0][0].data.email_norm).toBe('karim@shop.com');
            expect(db.lead.create.mock.calls[1][0].data.email).toBe('karim@shop.com');
            expect(db.lead.create.mock.calls[1][0].data.email_norm).toBe('karim@shop.com');
        });

        it('resolves a contact by mobile and does not search leads by email', async () => {
            db.crmContact.findMany.mockResolvedValueOnce([
                contactRow({
                    id: 'contact-mobile',
                    mobile: '01712345678',
                    mobile_norm: '+8801712345678',
                }),
            ]);
            db.lead.create.mockResolvedValueOnce({ id: 'lead-9' });

            await service.create('tenant-1', 'user-1', {
                name: 'Karim',
                mobile: '01712345678',
                email: 'Karim@Shop.com',
                linkedin_url: 'https://www.linkedin.com/in/Karim/',
            } as any, 'Asia/Dhaka');

            expect(db.lead.findFirst).not.toHaveBeenCalled();
            expect(db.crmContact.findMany).toHaveBeenCalledTimes(1);
            const where = db.crmContact.findMany.mock.calls[0][0].where;
            expect(where).toEqual(expect.objectContaining({
                tenant_id: 'tenant-1',
                OR: expect.arrayContaining([{ mobile_norm: '+8801712345678' }]),
            }));
            expect(JSON.stringify(where)).not.toMatch(/email/);
            expect(db.lead.create.mock.calls[0][0].data.contact_id).toBe('contact-mobile');
            expect(db.crmContact.update).not.toHaveBeenCalled();
        });

        it('stores the normalized keys alongside the raw values', async () => {
            db.lead.findFirst.mockResolvedValueOnce(null);
            db.lead.create.mockResolvedValueOnce({ id: 'lead-9' });

            await service.create('tenant-1', 'user-1', {
                name: 'Karim',
                mobile: '01712-345678',
                email: ' Karim@Shop.com ',
            } as any, 'Asia/Dhaka');

            const created = db.lead.create.mock.calls[0][0].data;
            expect(created.mobile).toBe('01712-345678');   // what the user typed
            expect(created.mobile_norm).toBe('+8801712345678');
            expect(created.email_norm).toBe('karim@shop.com');
            expect(created.linkedin_norm).toBeNull();
        });

        it('runs no duplicate query for a lead carrying no identity field at all', async () => {
            db.lead.create.mockResolvedValueOnce({ id: 'lead-9' });

            await service.create('tenant-1', 'user-1', { name: 'Walk-in customer' } as any, 'Asia/Dhaka');

            expect(db.lead.findFirst).not.toHaveBeenCalled();
            expect(db.lead.create).toHaveBeenCalled();
        });

        it('re-saves a lead\'s own email without searching other leads or contacts', async () => {
            db.lead.findFirst.mockResolvedValueOnce({
                id: 'lead-1',
                status: 'NEW',
                priority: 'MEDIUM',
                source_id: 'src-other',
                last_contacted_at: null,
                next_step_date: null,
                lost_reason: null,
                email: 'old@shop.com',
                email_norm: 'old@shop.com',
                mobile: '01712345678',
                mobile_norm: '+8801712345678',
                linkedin_url: null,
                linkedin_norm: null,
                organization_id: 'org-keep',
            });
            db.lead.update.mockResolvedValueOnce({ id: 'lead-1' });

            await service.update('tenant-1', 'lead-1', { email: 'karim@shop.com' } as any);

            expect(db.lead.findFirst).toHaveBeenCalledTimes(1);
            expect(db.lead.findFirst).toHaveBeenCalledWith({
                where: { id: 'lead-1', tenant_id: 'tenant-1' },
            });
            expect(db.crmContact.findMany).not.toHaveBeenCalled();
            expect(db.crmContact.create).not.toHaveBeenCalled();
            expect(db.crmContact.update).not.toHaveBeenCalled();
            const patched = db.lead.update.mock.calls[0][0].data;
            expect(patched.email).toBe('karim@shop.com');
            expect(patched.email_norm).toBe('karim@shop.com');
            expect(patched).not.toHaveProperty('contact_id');
            expect(patched).not.toHaveProperty('organization_id');
        });

        it('leaves an identity key alone when the edit never mentions it', async () => {
            db.lead.findFirst.mockResolvedValueOnce({ id: 'lead-1', status: 'NEW' });
            db.lead.update.mockResolvedValueOnce({ id: 'lead-1' });

            await service.update('tenant-1', 'lead-1', { name: 'Karim Rahman' } as any);

            // Writing email_norm: null here would strip the lead of its own
            // protection against a duplicate arriving later.
            const patched = db.lead.update.mock.calls[0][0].data;
            expect(patched).not.toHaveProperty('email_norm');
            expect(patched).not.toHaveProperty('mobile_norm');
            expect(patched).not.toHaveProperty('linkedin_norm');
        });
    });

    describe('contact linking', () => {
        const editable = (extra: Record<string, unknown> = {}) => ({
            id: 'lead-1',
            tenant_id: 'tenant-1',
            status: 'NEW',
            priority: 'MEDIUM',
            source_id: 'src-other',
            last_contacted_at: null,
            next_step_date: null,
            lost_reason: null,
            name: 'Karim',
            mobile: '01700000000',
            mobile_norm: '+8801700000000',
            email: null,
            address: null,
            linkedin_url: null,
            linkedin_norm: null,
            organization_id: null as string | null,
            ...extra,
        });

        it('creates one contact when the mobile matches nothing and stores its id', async () => {
            const order: string[] = [];
            db.$transaction.mockImplementation(async (fn: any) => {
                order.push('begin');
                const result = await fn(db);
                order.push('end');
                return result;
            });
            db.crmContact.create.mockImplementation(async () => {
                order.push('contact');
                return { id: 'contact-new', organization_id: null };
            });
            db.lead.create.mockImplementation(async () => {
                order.push('lead');
                return { id: 'lead-9' };
            });

            await service.create('tenant-1', 'user-1', {
                name: 'Karim',
                mobile: '01712-345678',
                email: 'Karim@Shop.com',
                address: 'Dhaka',
                linkedin_url: 'https://www.linkedin.com/in/karim',
            } as any, 'Asia/Dhaka');

            expect(order).toEqual(['begin', 'contact', 'lead', 'end']);
            expect(db.crmContact.create).toHaveBeenCalledTimes(1);
            expect(db.crmContact.create.mock.calls[0][0].data).toEqual(expect.objectContaining({
                tenant_id: 'tenant-1',
                name: 'Karim',
                mobile: '01712-345678',
                email: 'Karim@Shop.com',
                address: 'Dhaka',
                linkedin_url: 'https://www.linkedin.com/in/karim',
                mobile_norm: '+8801712345678',
                email_norm: 'karim@shop.com',
                linkedin_norm: 'linkedin.com/in/karim',
            }));
            expect(db.crmContact.create.mock.calls[0][0].data).not.toHaveProperty('company');
            expect(db.crmContact.create.mock.calls[0][0].data).not.toHaveProperty('notes');
            expect(db.crmContact.update).not.toHaveBeenCalled();
            expect(db.lead.create.mock.calls[0][0].data.contact_id).toBe('contact-new');
        });

        it('links a lead mobile to a contact whose raw mobile normalizes and whose norm is null', async () => {
            db.crmContact.findMany.mockResolvedValueOnce([
                contactRow({
                    id: 'contact-newer',
                    mobile: '01712345678',
                    mobile_norm: null,
                    organization_id: 'org-new',
                    created_at: new Date('2024-06-01T00:00:00.000Z'),
                }),
                contactRow({
                    id: 'contact-older',
                    mobile: '+8801712345678',
                    mobile_norm: null,
                    organization_id: 'org-old',
                    created_at: new Date('2020-01-01T00:00:00.000Z'),
                }),
            ]);
            db.lead.create.mockResolvedValueOnce({ id: 'lead-9' });

            await service.create(
                'tenant-1',
                'user-1',
                { name: 'Karim', mobile: '01712-345678' } as any,
                'Asia/Dhaka',
            );

            const created = db.lead.create.mock.calls[0][0].data;
            expect(created.contact_id).toBe('contact-older');
            expect(created.organization_id).toBe('org-old');
            expect(db.crmContact.create).not.toHaveBeenCalled();
            expect(db.crmContact.update).not.toHaveBeenCalled();
        });

        it('creates a contact per lead when they share only an email', async () => {
            db.crmContact.findMany.mockImplementation(async (args: any) => {
                const where = JSON.stringify(args?.where ?? {});
                if (/email/i.test(where)) {
                    return [contactRow({
                        id: 'contact-email',
                        email: 'shared@shop.com',
                        email_norm: 'shared@shop.com',
                    })];
                }
                return [];
            });
            db.crmContact.create
                .mockResolvedValueOnce({ id: 'contact-a', organization_id: null })
                .mockResolvedValueOnce({ id: 'contact-b', organization_id: null });
            db.lead.create
                .mockResolvedValueOnce({ id: 'lead-1' })
                .mockResolvedValueOnce({ id: 'lead-2' });

            await service.create(
                'tenant-1',
                'user-1',
                { name: 'Karim', email: 'shared@shop.com' } as any,
                'Asia/Dhaka',
            );
            await service.create(
                'tenant-1',
                'user-1',
                { name: 'Rahim', email: 'Shared@Shop.com' } as any,
                'Asia/Dhaka',
            );

            expect(db.crmContact.findMany.mock.calls.some((call: any[]) =>
                /email/i.test(JSON.stringify(call[0]?.where ?? {})),
            )).toBe(false);
            expect(db.crmContact.create).toHaveBeenCalledTimes(2);
            expect(db.lead.create.mock.calls.map((call: any[]) => call[0].data.contact_id)).toEqual([
                'contact-a',
                'contact-b',
            ]);
            expect(db.crmContact.update).not.toHaveBeenCalled();
        });

        it('attaches a lead with a new mobile to the contact that already has its LinkedIn', async () => {
            db.crmContact.findMany
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([
                    contactRow({
                        id: 'contact-li',
                        mobile: '01500000000',
                        mobile_norm: '+8801500000000',
                        linkedin_url: 'https://www.linkedin.com/in/Karim/',
                        linkedin_norm: 'linkedin.com/in/karim',
                        organization_id: 'org-li',
                    }),
                ]);
            db.lead.create.mockResolvedValueOnce({ id: 'lead-9' });

            await service.create('tenant-1', 'user-1', {
                name: 'Someone Else',
                mobile: '01900000000',
                linkedin_url: 'linkedin.com/in/karim',
            } as any, 'Asia/Dhaka');

            expect(db.crmContact.findMany).toHaveBeenCalledTimes(2);
            const linkedinWhere = db.crmContact.findMany.mock.calls[1][0].where;
            expect(linkedinWhere).toEqual(expect.objectContaining({
                OR: expect.arrayContaining([{ linkedin_norm: 'linkedin.com/in/karim' }]),
            }));
            expect(JSON.stringify(linkedinWhere)).not.toMatch(/email/);
            expect(db.crmContact.create).not.toHaveBeenCalled();
            expect(db.crmContact.update).not.toHaveBeenCalled();
            const created = db.lead.create.mock.calls[0][0].data;
            expect(created.contact_id).toBe('contact-li');
            expect(created.organization_id).toBe('org-li');
            expect(created.mobile).toBe('01900000000');
        });

        it('stores a non-number mobile as null and does not match a second one to the first', async () => {
            db.crmContact.findMany.mockResolvedValue([
                contactRow({ id: 'contact-junk', mobile: 'N/A', mobile_norm: null }),
            ]);
            db.crmContact.create
                .mockResolvedValueOnce({ id: 'contact-1', organization_id: null })
                .mockResolvedValueOnce({ id: 'contact-2', organization_id: null });
            db.lead.create
                .mockResolvedValueOnce({ id: 'lead-1' })
                .mockResolvedValueOnce({ id: 'lead-2' });

            await service.create('tenant-1', 'user-1', { name: 'A', mobile: 'N/A' } as any, 'Asia/Dhaka');
            await service.create('tenant-1', 'user-1', { name: 'B', mobile: 'N/A' } as any, 'Asia/Dhaka');

            expect(db.crmContact.create).toHaveBeenCalledTimes(2);
            for (const call of db.crmContact.create.mock.calls) {
                expect(call[0].data.mobile).toBeNull();
                expect(call[0].data.mobile_norm).toBeNull();
            }
            expect(db.lead.create.mock.calls[0][0].data.mobile).toBe('N/A');
            expect(db.lead.create.mock.calls[0][0].data.mobile_norm).toBeNull();
            expect(db.lead.create.mock.calls[0][0].data.contact_id).toBe('contact-1');
            expect(db.lead.create.mock.calls[1][0].data.contact_id).toBe('contact-2');
            expect(db.crmContact.update).not.toHaveBeenCalled();
        });

        it('copies organization_id from the contact only when the lead does not have one', async () => {
            db.crmContact.findMany.mockResolvedValueOnce([
                contactRow({
                    id: 'contact-org',
                    mobile: '01712345678',
                    mobile_norm: '+8801712345678',
                    organization_id: 'org-9',
                }),
            ]);
            db.lead.create.mockResolvedValueOnce({ id: 'lead-9' });

            await service.create(
                'tenant-1',
                'user-1',
                { name: 'Karim', mobile: '01712345678' } as any,
                'Asia/Dhaka',
            );

            expect(db.lead.create.mock.calls[0][0].data.organization_id).toBe('org-9');
            expect(db.lead.create.mock.calls[0][0].data.contact_id).toBe('contact-org');

            db.lead.findFirst.mockResolvedValueOnce(editable({ organization_id: null }));
            db.crmContact.findMany.mockResolvedValueOnce([
                contactRow({
                    id: 'contact-2',
                    mobile: '01800000000',
                    mobile_norm: '+8801800000000',
                    organization_id: 'org-2',
                }),
            ]);
            db.lead.update.mockResolvedValueOnce({ id: 'lead-1' });

            await service.update('tenant-1', 'lead-1', { mobile: '01800000000' } as any);

            const filled = db.lead.update.mock.calls[0][0].data;
            expect(filled.contact_id).toBe('contact-2');
            expect(filled.organization_id).toBe('org-2');
            expect(db.crmContact.update).not.toHaveBeenCalled();

            db.lead.findFirst.mockResolvedValueOnce(editable({ organization_id: 'org-keep' }));
            db.crmContact.findMany.mockResolvedValueOnce([
                contactRow({
                    id: 'contact-3',
                    mobile: '01900000000',
                    mobile_norm: '+8801900000000',
                    organization_id: 'org-other',
                }),
            ]);
            db.lead.update.mockResolvedValueOnce({ id: 'lead-1' });

            await service.update('tenant-1', 'lead-1', { mobile: '01900000000' } as any);

            const kept = db.lead.update.mock.calls[1][0].data;
            expect(kept.contact_id).toBe('contact-3');
            expect(kept).not.toHaveProperty('organization_id');

            db.lead.findFirst.mockResolvedValueOnce(editable({ organization_id: 'org-keep' }));
            db.crmContact.findMany.mockResolvedValueOnce([
                contactRow({
                    id: 'contact-4',
                    mobile: '01600000000',
                    mobile_norm: '+8801600000000',
                    organization_id: null,
                }),
            ]);
            db.lead.update.mockResolvedValueOnce({ id: 'lead-1' });

            await service.update('tenant-1', 'lead-1', { mobile: '01600000000' } as any);

            const notNulled = db.lead.update.mock.calls[2][0].data;
            expect(notNulled.contact_id).toBe('contact-4');
            expect(notNulled.organization_id).not.toBeNull();
            expect(notNulled).not.toHaveProperty('organization_id');
        });

        it('does not re-resolve the contact when mobile and LinkedIn are unchanged', async () => {
            db.lead.findFirst.mockResolvedValueOnce(editable({
                mobile: '01712345678',
                mobile_norm: '+8801712345678',
                linkedin_url: 'linkedin.com/in/karim',
                linkedin_norm: 'linkedin.com/in/karim',
                organization_id: null,
            }));
            db.lead.update.mockResolvedValueOnce({ id: 'lead-1' });

            await service.update('tenant-1', 'lead-1', {
                name: 'Karim Rahman',
                mobile: '01712-345678',
                linkedin_url: 'https://www.linkedin.com/in/Karim/',
                email: 'karim@shop.com',
            } as any);

            expect(db.crmContact.findMany).not.toHaveBeenCalled();
            expect(db.crmContact.create).not.toHaveBeenCalled();
            expect(db.crmContact.update).not.toHaveBeenCalled();
            const patched = db.lead.update.mock.calls[0][0].data;
            expect(patched).not.toHaveProperty('contact_id');
            expect(patched).not.toHaveProperty('organization_id');
            expect(patched.email_norm).toBe('karim@shop.com');
        });
    });

    describe('create() — opening next step', () => {
        it('seeds a PLANNED activity and derives the rollup from it', async () => {
            db.lead.findFirst.mockResolvedValueOnce(null);
            db.lead.create.mockResolvedValueOnce({ id: 'lead-9' });

            await service.create('tenant-1', 'user-1', {
                name: 'Karim',
                mobile: '01722222222',
                next_step: 'Call back Thursday',
                next_step_date: '2026-09-01T00:00:00Z',
                next_step_assigned_to: 'user-2',
            } as any, 'Asia/Dhaka');

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
            db.lead.findFirst.mockResolvedValueOnce(null);
            db.lead.create.mockResolvedValueOnce({ id: 'lead-9' });

            await service.create('tenant-1', 'user-1', {
                name: 'Karim',
                mobile: '01722222222',
            } as any, 'Asia/Dhaka');

            expect(db.crmActivity.create).not.toHaveBeenCalled();
            expect(db.lead.update).not.toHaveBeenCalled();
        });
    });

    describe('lead owner', () => {
        it('defaults the owner to the creating user when the payload names none', async () => {
            db.lead.findFirst.mockResolvedValueOnce(null);
            db.lead.create.mockResolvedValueOnce({ id: 'lead-30' });

            await service.create('tenant-1', 'user-1', { name: 'Rahim' } as any, 'Asia/Dhaka');

            expect(db.lead.create.mock.calls[0][0].data.assigned_to).toBe('user-1');
        });

        it('keeps the owner the payload names', async () => {
            db.lead.findFirst.mockResolvedValueOnce(null);
            db.lead.create.mockResolvedValueOnce({ id: 'lead-31' });

            await service.create('tenant-1', 'user-1', { name: 'Rahim', assigned_to: 'user-9' } as any, 'Asia/Dhaka');

            expect(db.lead.create.mock.calls[0][0].data.assigned_to).toBe('user-9');
        });

        it('files a lead against the creator even when the payload unassigns it', async () => {
            db.lead.findFirst.mockResolvedValueOnce(null);
            db.lead.create.mockResolvedValueOnce({ id: 'lead-32' });

            await service.create('tenant-1', 'user-1', { name: 'Rahim', assigned_to: null } as any, 'Asia/Dhaka');

            expect(db.lead.create.mock.calls[0][0].data.assigned_to).toBe('user-1');
        });

        it('clears the owner when an update explicitly unassigns it', async () => {
            const existing = {
                id: 'lead-33',
                tenant_id: 'tenant-1',
                status: LeadStatus.CONTACTED,
                priority: 'HIGH',
                source_id: 'src-other',
                last_contacted_at: null,
                next_step_date: null,
                lost_reason: null,
                assigned_to: 'user-9',
            };
            db.lead.findFirst.mockResolvedValueOnce(existing);
            db.lead.update.mockResolvedValueOnce({ ...existing, assigned_to: null });

            await service.update('tenant-1', 'lead-33', { assigned_to: null } as any);

            expect(db.lead.update).toHaveBeenCalledWith(
                expect.objectContaining({ data: expect.objectContaining({ assigned_to: null }) }),
            );
        });
    });

    describe('create() — lost_reason validation', () => {
        it('rejects creating a LOST lead without a lost_reason', async () => {
            db.lead.findFirst.mockResolvedValueOnce(null);

            await expect(
                service.create('tenant-1', 'user-1', {
                    name: 'Bad Lead',
                    mobile: '01711111111',
                    status: LeadStatus.LOST,
                } as any, 'Asia/Dhaka'),
            ).rejects.toThrow(BadRequestException);
            expect(db.lead.create).not.toHaveBeenCalled();
        });

        it('accepts creating a LOST lead when lost_reason is provided', async () => {
            db.lead.findFirst.mockResolvedValueOnce(null);
            db.lead.create.mockResolvedValueOnce({ id: 'lead-2' });

            await service.create('tenant-1', 'user-1', {
                name: 'Bad Lead',
                mobile: '01711111111',
                status: LeadStatus.LOST,
                lost_reason: 'Went with a competitor',
            } as any, 'Asia/Dhaka');

            expect(db.lead.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ lost_reason: 'Went with a competitor', score: 0 }),
                }),
            );
        });
    });

    describe('create() — custom_fields', () => {
        it('persists the sanitized custom_fields object, not the raw dto value', async () => {
            db.lead.findFirst.mockResolvedValueOnce(null);
            db.lead.create.mockResolvedValueOnce({ id: 'lead-20' });
            customFieldsService.sanitizeValues.mockResolvedValueOnce({ cf_1: 'Gold' });

            await service.create('tenant-1', 'user-1', {
                name: 'Custom Field Lead',
                mobile: '01733333333',
                custom_fields: { cf_1: 'gold  ', unknown_key: 'nope' },
            } as any, 'Asia/Dhaka');

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

        it('adds the tenant\'s stages with their own counts', async () => {
            db.lead.groupBy
                .mockResolvedValueOnce([{ status: LeadStatus.QUALIFIED, _count: { _all: 3 } }])
                .mockResolvedValueOnce([
                    { status_id: 'st-qual', _count: { _all: 1 } },
                    { status_id: 'st-neg', _count: { _all: 2 } },
                ]);
            db.leadStatusOption.findMany.mockResolvedValue([
                { id: 'st-qual', code: 'QUALIFIED', name: 'Qualified', lifecycle: 'QUALIFIED', is_system: true, is_active: true, sort_order: 3 },
                { id: 'st-neg', code: 'NEGOTIATION', name: 'Negotiation', lifecycle: 'QUALIFIED', is_system: false, is_active: true, sort_order: 4 },
            ]);

            const result = await service.getStatusSummary('tenant-1');

            expect(result.stages.map((s: any) => [s.name, s.count])).toEqual([
                ['Qualified', 1],
                ['Negotiation', 2],
            ]);
        });
    });

    describe('listAssignees()', () => {
        it('lists every member of the workspace as id, name and email — nothing else', async () => {
            db.tenantUser = {
                findMany: jest.fn().mockResolvedValue([
                    { user: { id: 'u-1', name: 'Asha', email: 'asha@example.com' } },
                    { user: { id: 'u-2', name: null, email: 'bilal@example.com' } },
                ]),
            };

            await expect(service.listAssignees('tenant-1')).resolves.toEqual([
                { userId: 'u-1', name: 'Asha', email: 'asha@example.com' },
                { userId: 'u-2', name: null, email: 'bilal@example.com' },
            ]);
            expect(db.tenantUser.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { tenant_id: 'tenant-1' },
                    select: { user: { select: { id: true, name: true, email: true } } },
                }),
            );
        });
    });

    describe('importRows()', () => {
        it('creates a new lead from a valid row with defaults applied', async () => {
            db.lead.findFirst.mockResolvedValueOnce(null);
            db.lead.create.mockResolvedValueOnce({ id: 'lead-10' });

            const result = await service.importRows('tenant-1', [
                { name: 'Alice', mobile: '01800000001', email: 'alice@example.com' },
            ], 'skip', 'Asia/Dhaka');

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
            db.lead.findFirst.mockResolvedValueOnce(null);
            db.lead.create.mockResolvedValueOnce({ id: 'lead-10' });

            await service.importRows(
                'tenant-1',
                [{ name: 'Alice', mobile: '01800000001', next_step: 'Call back', next_step_date: '2026-09-01' }],
                'skip',
                'Asia/Dhaka',
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
            db.lead.findFirst.mockResolvedValueOnce(null);
            db.lead.create.mockResolvedValueOnce({ id: 'lead-11' });

            await service.importRows('tenant-1', [{ name: 'Bob', mobile: '01800000003' }], 'skip', 'Asia/Dhaka');

            expect(db.crmActivity.create).not.toHaveBeenCalled();
        });

        // An upsert import is a bulk sync that re-runs over unchanged rows.
        // Seeding unconditionally would pile up one duplicate activity per run.
        it('does not re-seed an activity that already matches on a re-import', async () => {
            db.lead.findFirst.mockResolvedValueOnce(existingByMobile('01800000002'));
            db.lead.update.mockResolvedValueOnce({ id: 'lead-existing' });
            db.crmActivity.count.mockResolvedValueOnce(1);

            await service.importRows(
                'tenant-1',
                [{ name: 'Bob', mobile: '01800000002', next_step: 'Call back', next_step_date: '2026-09-01' }],
                'upsert',
                'Asia/Dhaka',
            );

            expect(db.crmActivity.create).not.toHaveBeenCalled();
        });

        it('skips a duplicate mobile in skip mode', async () => {
            db.lead.findFirst.mockResolvedValueOnce(existingByMobile('01800000002'));

            const result = await service.importRows('tenant-1', [
                { name: 'Bob', mobile: '01800000002' },
            ], 'skip', 'Asia/Dhaka');

            expect(result).toEqual({ created: 0, updated: 0, skipped: 1, errors: [] });
            expect(db.lead.update).not.toHaveBeenCalled();
        });

        it('updates a duplicate mobile in upsert mode', async () => {
            db.lead.findFirst.mockResolvedValueOnce(existingByMobile('01800000002'));
            db.lead.update.mockResolvedValueOnce({ id: 'lead-existing' });

            const result = await service.importRows('tenant-1', [
                { name: 'Bob Updated', mobile: '01800000002', priority: 'HIGH' },
            ], 'upsert', 'Asia/Dhaka');

            expect(result).toEqual({ created: 0, updated: 1, skipped: 0, errors: [] });
            expect(db.lead.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: 'lead-existing' },
                    data: expect.objectContaining({ name: 'Bob Updated', priority: 'HIGH' }),
                }),
            );
        });

        it('does not overwrite existing optional fields when they are absent from the import row', async () => {
            db.lead.findFirst.mockResolvedValueOnce(existingByMobile('01800000002'));
            db.lead.update.mockResolvedValueOnce({ id: 'lead-existing' });

            await service.importRows('tenant-1', [
                { name: 'Bob', mobile: '01800000002' },  // no email, address, remarks, category, priority, source, status
            ], 'upsert', 'Asia/Dhaka');

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
            db.lead.findFirst.mockResolvedValueOnce(existingByMobile('01800000003'));
            db.lead.update.mockResolvedValueOnce({ id: 'lead-existing' });

            await service.importRows('tenant-1', [
                { name: 'Bob', mobile: '01800000003' },  // no status, priority, source
            ], 'upsert', 'Asia/Dhaka');

            const updateCall = db.lead.update.mock.calls[0][0];
            expect(updateCall.data).not.toHaveProperty('status');
            expect(updateCall.data).not.toHaveProperty('priority');
            expect(updateCall.data).not.toHaveProperty('source');
        });

        it('creates a row whose only match would be an email', async () => {
            // Email alone is not the same lead. The lookup still returns the
            // old email holder if the importer asks for it, which it must not.
            db.lead.findFirst.mockResolvedValueOnce({
                id: 'lead-existing',
                mobile_norm: null,
                email_norm: 'alice@example.com',
                linkedin_norm: null,
            });
            db.lead.create.mockResolvedValueOnce({ id: 'lead-new' });

            const result = await service.importRows('tenant-1', [
                { name: 'Alice', email: 'ALICE@example.com' },
            ], 'skip', 'Asia/Dhaka');

            expect(result).toEqual({ created: 1, updated: 0, skipped: 0, errors: [] });
            expect(db.lead.create).toHaveBeenCalledTimes(1);
            expect(db.lead.create.mock.calls[0][0].data.email).toBe('ALICE@example.com');
        });

        it('skips a row whose LinkedIn URL matches an existing lead', async () => {
            db.lead.findFirst.mockResolvedValueOnce({
                id: 'lead-existing',
                mobile_norm: null,
                email_norm: null,
                linkedin_norm: 'linkedin.com/in/alice',
            });

            const result = await service.importRows('tenant-1', [
                { name: 'Alice', linkedin_url: 'https://www.LinkedIn.com/in/Alice/?utm_source=x' },
            ], 'skip', 'Asia/Dhaka');

            expect(result.skipped).toBe(1);
            expect(db.lead.create).not.toHaveBeenCalled();
        });

        it('creates both rows of a file that share only an email', async () => {
            db.lead.findFirst.mockResolvedValue(null);
            db.lead.create.mockResolvedValue({ id: 'lead-10' });

            const result = await service.importRows('tenant-1', [
                { name: 'Alice', email: 'alice@example.com' },
                { name: 'Alice Rahman', email: 'ALICE@Example.com ' },
            ], 'skip', 'Asia/Dhaka');

            expect(result.created).toBe(2);
            expect(result.skipped).toBe(0);
            expect(result.errors).toEqual([]);
            expect(result.duplicates).toBeUndefined();
            expect(db.lead.create).toHaveBeenCalledTimes(2);
        });

        it('does not let a shared email make a later row overwrite an earlier one', async () => {
            db.lead.create.mockResolvedValue({ id: 'lead-10' });
            db.lead.findFirst
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce({
                    id: 'lead-10',
                    mobile_norm: null,
                    email_norm: 'alice@example.com',
                    linkedin_norm: null,
                });
            db.lead.update.mockResolvedValue({ id: 'lead-10' });

            const result = await service.importRows('tenant-1', [
                { name: 'Alice', email: 'alice@example.com' },
                { name: 'Alice Rahman', email: 'alice@example.com' },
            ], 'upsert', 'Asia/Dhaka');

            expect(result).toEqual({ created: 2, updated: 0, skipped: 0, errors: [] });
            expect(db.lead.update).not.toHaveBeenCalled();
            expect(db.lead.create).toHaveBeenCalledTimes(2);
        });

        it('does not call a shared email a same-file duplicate, and still does for a mobile', async () => {
            db.lead.findFirst.mockResolvedValue(null);
            db.lead.create.mockResolvedValue({ id: 'lead-10' });

            const byEmail = await service.importRows('tenant-1', [
                { name: 'Alice', email: 'alice@example.com', mobile: '01800000001' },
                { name: 'Bob', email: 'ALICE@example.com', mobile: '01800000002' },
            ], 'skip', 'Asia/Dhaka');

            expect(byEmail.duplicates).toBeUndefined();
            expect(byEmail.created).toBe(2);
            expect(byEmail.skipped).toBe(0);

            const byMobile = await service.importRows('tenant-1', [
                { name: 'Alice', mobile: '01800000001' },
                { name: 'Alice Rahman', mobile: '+8801800000001' },
            ], 'skip', 'Asia/Dhaka');

            expect(byMobile.created).toBe(1);
            expect(byMobile.skipped).toBe(1);
            expect(byMobile.duplicates).toEqual(['Row 3: same mobile number as row 2 — skipped']);
        });

        it('does not treat two rows without any identity field as duplicates', async () => {
            db.lead.findFirst.mockResolvedValue(null);
            db.lead.create.mockResolvedValue({ id: 'lead-10' });

            const result = await service.importRows('tenant-1', [
                { name: 'Walk-in one' },
                { name: 'Walk-in two' },
            ], 'skip', 'Asia/Dhaka');

            expect(result.created).toBe(2);
            expect(result.duplicates).toBeUndefined();
        });

        it('writes the normalized keys on both create and update', async () => {
            db.lead.findFirst.mockResolvedValueOnce(null);
            db.lead.create.mockResolvedValueOnce({ id: 'lead-10' });
            await service.importRows('tenant-1', [
                { name: 'Alice', mobile: '01800-000001', email: 'Alice@Example.com' },
            ], 'skip', 'Asia/Dhaka');
            expect(db.lead.create.mock.calls[0][0].data).toEqual(
                expect.objectContaining({
                    mobile_norm: '+8801800000001',
                    email_norm: 'alice@example.com',
                }),
            );

            db.lead.findFirst.mockResolvedValueOnce(existingByMobile('01800000001'));
            db.lead.update.mockResolvedValueOnce({ id: 'lead-existing' });
            await service.importRows('tenant-1', [
                { name: 'Alice', mobile: '01800-000001', email: 'Alice@Example.com' },
            ], 'upsert', 'Asia/Dhaka');
            expect(db.lead.update.mock.calls[0][0].data).toEqual(
                expect.objectContaining({
                    mobile_norm: '+8801800000001',
                    email_norm: 'alice@example.com',
                }),
            );
        });

        it('reports a row error for missing required fields and continues', async () => {
            db.lead.findFirst.mockResolvedValueOnce(null);
            db.lead.create.mockResolvedValueOnce({ id: 'lead-11' });

            const result = await service.importRows('tenant-1', [
                { name: '', mobile: '' },
                { name: 'Carol', mobile: '01800000003' },
            ], 'skip', 'Asia/Dhaka');

            expect(result.created).toBe(1);
            expect(result.errors).toEqual(['Row 2: missing required field(s): name']);
        });

        it('falls back to MEDIUM for an unrecognised priority', async () => {
            db.lead.findFirst.mockResolvedValueOnce(null);
            db.lead.create.mockResolvedValueOnce({ id: 'lead-12' });

            const result = await service.importRows('tenant-1', [
                { name: 'Dana', mobile: '01800000004', priority: 'not-a-priority' },
            ], 'skip', 'Asia/Dhaka');

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
            ], 'skip', 'Asia/Dhaka');

            expect(result.created).toBe(0);
            expect(result.errors).toEqual([
                'Row 2: unknown source "nope" — add it under CRM → Settings → Lead Sources, or correct the spreadsheet',
            ]);
            expect(db.lead.create).not.toHaveBeenCalled();
        });

        it('matches a source by its display name, not just its code', async () => {
            db.lead.findFirst.mockResolvedValueOnce(null);
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
            ], 'skip', 'Asia/Dhaka');

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
            ], 'skip', 'Asia/Dhaka');

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
            db.lead.findFirst.mockResolvedValueOnce(null);
            db.lead.create.mockResolvedValueOnce({ id: 'lead-13' });

            const result = await service.importRows('tenant-1', [
                { name: 'Farah', mobile: '01800000006', Region: 'Dhaka' },
            ], 'skip', 'Asia/Dhaka');

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
            db.lead.findFirst.mockResolvedValueOnce(null);
            db.lead.create.mockResolvedValueOnce({ id: 'lead-14' });

            const result = await service.importRows('tenant-1', [
                { name: 'Alice', mobile: '01900000001', REGION: 'Dhaka' },
            ], 'skip', 'Asia/Dhaka');

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
            db.lead.findFirst.mockResolvedValueOnce(null);
            db.lead.create.mockResolvedValueOnce({ id: 'lead-15' });

            const result = await service.importRows('tenant-1', [
                { name: 'Alice', mobile: '01900000002', cf_1: 'Dhaka' },
            ], 'skip', 'Asia/Dhaka');

            expect(result.created).toBe(1);
            expect(db.lead.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ custom_fields: { cf_1: 'Dhaka' } }),
                }),
            );
        });
    });

    describe('findAll — owner filter', () => {
        beforeEach(() => {
            db.lead.findMany.mockResolvedValue([]);
            db.lead.count.mockResolvedValue(0);
        });

        it('filters to a named owner', async () => {
            await service.findAll('tenant-1', { assignedTo: 'user-9' } as any);

            expect(db.lead.findMany.mock.calls[0][0].where).toEqual(
                expect.objectContaining({ assigned_to: 'user-9' }),
            );
        });

        it('filters to leads nobody owns when given the unassigned sentinel', async () => {
            await service.findAll('tenant-1', { assignedTo: UNASSIGNED_OWNER_FILTER } as any);

            expect(db.lead.findMany.mock.calls[0][0].where).toEqual(
                expect.objectContaining({ assigned_to: null }),
            );
        });

        it('does not filter on owner at all when none is given', async () => {
            await service.findAll('tenant-1', {} as any);

            expect(db.lead.findMany.mock.calls[0][0].where).not.toHaveProperty('assigned_to');
        });
    });

    describe('findAll — category and source filters', () => {
        beforeEach(() => {
            db.lead.findMany.mockResolvedValue([]);
            db.lead.count.mockResolvedValue(0);
        });

        it('filters to one category and one source by row id', async () => {
            await service.findAll('tenant-1', { category: 'cat-1', source: 'src-1' } as any);

            expect(db.lead.findMany.mock.calls[0][0].where).toEqual(
                expect.objectContaining({ category_id: 'cat-1', source_id: 'src-1' }),
            );
        });

        it('filters to leads with no category, or no source, when given the none sentinel', async () => {
            await service.findAll('tenant-1', { category: NO_TAXONOMY_FILTER, source: NO_TAXONOMY_FILTER } as any);

            const where = db.lead.findMany.mock.calls[0][0].where;
            expect(where).toEqual(expect.objectContaining({ category_id: null, source_id: null }));
            // The count must agree with the rows, or a board column's total lies.
            expect(db.lead.count.mock.calls[0][0].where).toEqual(where);
        });
    });

    describe('findAll — only-mine scope', () => {
        beforeEach(() => {
            db.lead.findMany.mockResolvedValue([]);
            db.lead.count.mockResolvedValue(0);
        });

        it('narrows to the caller', async () => {
            await service.findAll('tenant-1', { mine: true, userId: 'user-7' } as any);

            expect(db.lead.findMany.mock.calls[0][0].where).toEqual(
                expect.objectContaining({ assigned_to: 'user-7' }),
            );
        });

        it('overrides a stale owner filter rather than contradicting it', async () => {
            // The scope outlives any one page, so a remembered owner filter must
            // not be able to widen it back out to somebody else's leads.
            await service.findAll(
                'tenant-1',
                { mine: true, userId: 'user-7', assignedTo: 'user-9' } as any,
            );

            expect(db.lead.findMany.mock.calls[0][0].where.assigned_to).toBe('user-7');
        });

        it('beats the unassigned sentinel too, which would otherwise empty the list', async () => {
            await service.findAll(
                'tenant-1',
                { mine: true, userId: 'user-7', assignedTo: UNASSIGNED_OWNER_FILTER } as any,
            );

            expect(db.lead.findMany.mock.calls[0][0].where.assigned_to).toBe('user-7');
        });

        it('leaves the list unscoped when there is no signed-in user to resolve', async () => {
            await service.findAll('tenant-1', { mine: true } as any);

            expect(db.lead.findMany.mock.calls[0][0].where).not.toHaveProperty('assigned_to');
        });

        it('composes with the other filters instead of replacing them', async () => {
            await service.findAll(
                'tenant-1',
                { mine: true, userId: 'user-7', status: 'NEW', priority: 'HIGH' } as any,
            );

            expect(db.lead.findMany.mock.calls[0][0].where).toEqual(
                expect.objectContaining({ assigned_to: 'user-7', status: 'NEW', priority: 'HIGH' }),
            );
        });
    });

    describe('findAll — email presence filter', () => {
        beforeEach(() => {
            db.lead.findMany.mockResolvedValue([]);
            db.lead.count.mockResolvedValue(0);
        });

        /** Both halves match `''` as well as NULL — see EMPTY_EMAIL_WHERE. */
        const NO_EMAIL = { OR: [{ email: null }, { email: '' }] };

        it('filters to leads with no email at all', async () => {
            await service.findAll('tenant-1', { emailPresence: 'empty' } as any);

            expect(db.lead.findMany.mock.calls[0][0].where.AND).toEqual([NO_EMAIL]);
        });

        it('filters to leads that do have one', async () => {
            await service.findAll('tenant-1', { emailPresence: 'has' } as any);

            expect(db.lead.findMany.mock.calls[0][0].where.AND).toEqual([{ NOT: NO_EMAIL }]);
        });

        it('does not filter on email at all when none is given', async () => {
            await service.findAll('tenant-1', {} as any);

            expect(db.lead.findMany.mock.calls[0][0].where).not.toHaveProperty('AND');
        });

        it('leaves free-text search its own OR, so the two combine rather than clobber', async () => {
            await service.findAll('tenant-1', { emailPresence: 'empty', search: 'karim' } as any);

            const where = db.lead.findMany.mock.calls[0][0].where;
            expect(where.AND).toEqual([NO_EMAIL]);
            expect(where.OR).toEqual(
                expect.arrayContaining([{ name: { contains: 'karim', mode: 'insensitive' } }]),
            );
        });

        it('counts the same filtered set it lists', async () => {
            await service.findAll('tenant-1', { emailPresence: 'empty' } as any);

            expect(db.lead.count.mock.calls[0][0].where).toEqual(
                db.lead.findMany.mock.calls[0][0].where,
            );
        });

        /**
         * Both this filter and the staleness one live under `AND`, and the
         * second used to *assign* it rather than append — safe only while it was
         * the sole occupant. Asking for both silently dropped this one.
         */
        it('survives alongside the staleness filter, which shares the AND', async () => {
            await service.findAll('tenant-1', { emailPresence: 'empty', staleDays: 14 } as any);

            const { where } = db.lead.findMany.mock.calls[0][0];
            expect(where.AND).toHaveLength(2);
            expect(where.AND[0]).toEqual(NO_EMAIL);
            expect(where.AND[1].OR[0]).toHaveProperty('last_activity_at');
        });
    });

    /**
     * The CRM dashboard's attention tiles link into this list, so the filters
     * behind those links must reproduce the counts the tiles rendered — the
     * dashboard builds its own counts from the same exported helpers.
     */
    describe('findAll — open pipeline and stale filters', () => {
        beforeEach(() => {
            db.lead.findMany.mockResolvedValue([]);
            db.lead.count.mockResolvedValue(0);
        });

        it('expands the open sentinel to the three working stages', async () => {
            await service.findAll('tenant-1', { status: OPEN_LEAD_STATUS_FILTER } as any);

            expect(db.lead.findMany.mock.calls[0][0].where.status).toEqual({
                in: ['NEW', 'CONTACTED', 'QUALIFIED'],
            });
        });

        it('still filters to a single stage when given a real status', async () => {
            await service.findAll('tenant-1', { status: 'QUALIFIED' } as any);

            expect(db.lead.findMany.mock.calls[0][0].where.status).toBe('QUALIFIED');
        });

        it('matches leads last worked before the window, and those never worked', async () => {
            jest.useFakeTimers().setSystemTime(new Date('2026-08-31T09:00:00.000Z'));
            try {
                await service.findAll('tenant-1', { staleDays: 14 } as any);
            } finally {
                jest.useRealTimers();
            }

            const cutoff = new Date('2026-08-17T09:00:00.000Z');
            expect(db.lead.findMany.mock.calls[0][0].where.AND).toEqual([
                {
                    OR: [
                        // `last_activity_at`, not `last_contacted_at`: scheduling a
                        // follow-up or rewriting the next step is working the lead,
                        // and the tile this backs is labelled "no activity".
                        { last_activity_at: { lt: cutoff } },
                        // A bare `last_activity_at: { lt: cutoff }` excludes NULL in
                        // SQL, dropping every never-worked lead — the strongest
                        // neglect signal there is. created_at keeps a lead filed
                        // this morning out of it.
                        { last_activity_at: null, created_at: { lt: cutoff } },
                    ],
                },
            ]);
        });

        it('honours a window other than the default', async () => {
            jest.useFakeTimers().setSystemTime(new Date('2026-08-31T09:00:00.000Z'));
            try {
                await service.findAll('tenant-1', { staleDays: 30 } as any);
            } finally {
                jest.useRealTimers();
            }

            const [branch] = db.lead.findMany.mock.calls[0][0].where.AND;
            expect(branch.OR[0].last_activity_at.lt).toEqual(new Date('2026-08-01T09:00:00.000Z'));
        });

        it('keeps the stale clause out of the search OR', async () => {
            // Merged into the top-level OR, "matches the search AND is stale"
            // would quietly widen into "matches the search OR is stale".
            await service.findAll('tenant-1', { staleDays: 14, search: 'karim' } as any);

            const { where } = db.lead.findMany.mock.calls[0][0];
            expect(where.OR).toHaveLength(4);
            expect(where.OR.every((clause: any) => !('last_activity_at' in clause))).toBe(true);
            expect(where.AND).toHaveLength(1);
        });

        it('does not filter on staleness when no window is given', async () => {
            await service.findAll('tenant-1', {} as any);

            expect(db.lead.findMany.mock.calls[0][0].where).not.toHaveProperty('AND');
        });
    });

    /**
     * The table's advanced filters. They used to filter only the rows already on
     * the page, so two leads matching "Grade = A" showed up one on page 4 and the
     * other on page 5. Here they narrow the query itself, count included.
     */
    describe('findAll — column filters', () => {
        beforeEach(() => {
            db.lead.findMany.mockResolvedValue([]);
            db.lead.count.mockResolvedValue(0);
        });

        const whereFor = async (filters: Record<string, string>, extra: Record<string, unknown> = {}) => {
            await service.findAll('tenant-1', { filters, ...extra } as any);
            return db.lead.findMany.mock.calls[0][0].where;
        };

        it('filters on a custom field before paginating, and counts the same rows', async () => {
            const where = await whereFor({ cf_cf_2: 'A' });

            expect(where.AND).toEqual([
                {
                    OR: [
                        { custom_fields: { path: ['cf_2'], string_contains: 'A' } },
                        { custom_fields: { path: ['cf_2'], string_contains: 'a' } },
                    ],
                },
            ]);
            expect(db.lead.count.mock.calls[0][0].where).toEqual(where);
        });

        it('tries a custom-field value in the casings it is likely stored in', async () => {
            const where = await whereFor({ cf_cf_1: 'old dhaka' });

            const variants = where.AND[0].OR.map((c: any) => c.custom_fields.string_contains);
            expect(variants).toEqual(['old dhaka', 'OLD DHAKA', 'Old Dhaka']);
        });

        it('matches text columns as a case-insensitive contains, with wildcards taken literally', async () => {
            const where = await whereFor({ name: 'karim', remarks: '50%_off' });

            expect(where.AND).toEqual([
                { name: { contains: 'karim', mode: 'insensitive' } },
                { remarks: { contains: '50\\%\\_off', mode: 'insensitive' } },
            ]);
        });

        it('matches category, source and owner by the name the table shows', async () => {
            const where = await whereFor({ category: 'whole', source: 'walk', assignee: 'rifat' });

            expect(where.AND).toEqual([
                { categoryOption: { name: { contains: 'whole', mode: 'insensitive' } } },
                { sourceOption: { name: { contains: 'walk', mode: 'insensitive' } } },
                { assignee: { name: { contains: 'rifat', mode: 'insensitive' } } },
            ]);
        });

        it('matches status by stage name, or by lifecycle for a lead with no stage yet', async () => {
            const where = await whereFor({ status: 'new' });

            expect(where.AND).toEqual([
                {
                    OR: [
                        { statusOption: { name: { contains: 'new', mode: 'insensitive' } } },
                        { status_id: null, status: { in: ['NEW'] } },
                    ],
                },
            ]);
        });

        it('matches priority against its codes', async () => {
            expect((await whereFor({ priority: 'high' })).AND).toEqual([{ priority: { in: ['HIGH'] } }]);
        });

        it('matches a score exactly, and nothing for text that is not a number', async () => {
            expect((await whereFor({ score: '40' })).AND).toEqual([{ score: 40 }]);
            db.lead.findMany.mockClear();
            expect((await whereFor({ score: 'forty' })).AND).toEqual([{ id: { in: [] } }]);
        });

        it('ignores columns it cannot filter and blank values', async () => {
            const where = await whereFor({ created_at: '2026', password: 'x', name: '  ' });

            expect(where).not.toHaveProperty('AND');
        });

        it('keeps the other filters that also live in AND', async () => {
            const where = await whereFor({ name: 'karim' }, { emailPresence: 'empty', staleDays: 14 });

            expect(where.AND).toHaveLength(3);
            expect(where.AND[2]).toEqual({ name: { contains: 'karim', mode: 'insensitive' } });
        });
    });

    describe('findAll sorting', () => {
        beforeEach(() => {
            db.lead.findMany.mockResolvedValue([]);
            db.lead.count.mockResolvedValue(0);
        });

        it('passes an allowlisted sort to orderBy', async () => {
            await service.findAll('tenant-1', { timezone: 'Asia/Dhaka', sortBy: 'name', sortDir: 'desc' });
            const arg = (db.lead.findMany as jest.Mock).mock.calls[0][0];
            expect(arg.orderBy).toEqual({ name: 'desc' });
        });

        it('falls back to default order for an unknown sort key', async () => {
            await service.findAll('tenant-1', { timezone: 'Asia/Dhaka', sortBy: 'password', sortDir: 'asc' });
            const arg = (db.lead.findMany as jest.Mock).mock.calls[0][0];
            expect(arg.orderBy).toEqual([{ next_step_date: 'asc' }, { updated_at: 'desc' }]);
        });

        it('falls back to default order when no sort is given', async () => {
            await service.findAll('tenant-1', { timezone: 'Asia/Dhaka',});
            const arg = (db.lead.findMany as jest.Mock).mock.calls[0][0];
            expect(arg.orderBy).toEqual([{ next_step_date: 'asc' }, { updated_at: 'desc' }]);
        });

        it('filters created_at to the inclusive Dhaka day range', async () => {
            await service.findAll('tenant-1', { timezone: 'Asia/Dhaka', createdFrom: '2026-08-19', createdTo: '2026-08-19' });
            const arg = (db.lead.findMany as jest.Mock).mock.calls[0][0];
            expect(arg.where.created_at).toEqual({
                gte: new Date('2026-08-18T18:00:00.000Z'),
                lte: new Date('2026-08-19T17:59:59.999Z'),
            });
        });
    });

    describe('photos', () => {
        const KEY = 'retail/tenant-1/crm-photos/rahim';
        const OTHER_KEY = 'retail/tenant-1/crm-photos/newer';

        /** update() reads the whole row, so every case needs an editable lead. */
        function existingLead(extra: Record<string, unknown> = {}) {
            return {
                id: 'lead-1',
                tenant_id: 'tenant-1',
                status: LeadStatus.NEW,
                priority: 'MEDIUM',
                source_id: 'src-other',
                last_contacted_at: null,
                next_step_date: null,
                photo_storage_key: KEY,
                ...extra,
            };
        }

        it('stores the photo url and key on create', async () => {
            db.lead.findFirst.mockResolvedValueOnce(null);
            db.lead.create.mockResolvedValueOnce({ id: 'lead-9' });

            await service.create('tenant-1', 'user-1', {
                name: 'Rahim',
                photo_url: 'https://cdn.example/rahim.jpg',
                photo_storage_key: KEY,
            } as any, 'Asia/Dhaka');

            const created = db.lead.create.mock.calls[0][0].data;
            expect(created.photo_url).toBe('https://cdn.example/rahim.jpg');
            expect(created.photo_storage_key).toBe(KEY);
        });

        it('stores nulls when a lead is created without a photo', async () => {
            db.lead.findFirst.mockResolvedValueOnce(null);
            db.lead.create.mockResolvedValueOnce({ id: 'lead-9' });

            await service.create('tenant-1', 'user-1', { name: 'Rahim' } as any, 'Asia/Dhaka');

            const created = db.lead.create.mock.calls[0][0].data;
            expect(created.photo_url).toBeNull();
            expect(created.photo_storage_key).toBeNull();
        });

        it("refuses a storage key from another tenant's folder", async () => {
            db.lead.findFirst.mockResolvedValueOnce(null);

            await expect(
                service.create('tenant-1', 'user-1', {
                    name: 'Rahim',
                    photo_url: 'https://cdn.example/rahim.jpg',
                    photo_storage_key: 'retail/tenant-2/crm-photos/rahim',
                } as any, 'Asia/Dhaka'),
            ).rejects.toBeInstanceOf(BadRequestException);
            expect(db.lead.create).not.toHaveBeenCalled();
        });

        it('deletes the previous asset when the photo is replaced', async () => {
            db.lead.findFirst.mockResolvedValueOnce(existingLead());
            db.lead.update.mockResolvedValueOnce({ id: 'lead-1' });

            await service.update('tenant-1', 'lead-1', {
                photo_url: 'https://cdn.example/newer.jpg',
                photo_storage_key: OTHER_KEY,
            } as any);

            const data = db.lead.update.mock.calls[0][0].data;
            expect(data.photo_url).toBe('https://cdn.example/newer.jpg');
            expect(data.photo_storage_key).toBe(OTHER_KEY);
            expect(assets.deleteFile).toHaveBeenCalledWith(KEY);
        });

        it('deletes the previous asset when the photo is cleared', async () => {
            db.lead.findFirst.mockResolvedValueOnce(existingLead());
            db.lead.update.mockResolvedValueOnce({ id: 'lead-1' });

            await service.update('tenant-1', 'lead-1', {
                photo_url: '',
                photo_storage_key: '',
            } as any);

            const data = db.lead.update.mock.calls[0][0].data;
            expect(data.photo_url).toBeNull();
            expect(data.photo_storage_key).toBeNull();
            expect(assets.deleteFile).toHaveBeenCalledWith(KEY);
        });

        it('deletes nothing when an update does not touch the photo', async () => {
            db.lead.findFirst.mockResolvedValueOnce(existingLead());
            db.lead.update.mockResolvedValueOnce({ id: 'lead-1' });

            await service.update('tenant-1', 'lead-1', { name: 'Rahim Uddin' } as any);

            const data = db.lead.update.mock.calls[0][0].data;
            expect(data.photo_url).toBeUndefined();
            expect(data.photo_storage_key).toBeUndefined();
            expect(assets.deleteFile).not.toHaveBeenCalled();
        });

        it('deletes nothing when the same photo is re-saved', async () => {
            db.lead.findFirst.mockResolvedValueOnce(existingLead());
            db.lead.update.mockResolvedValueOnce({ id: 'lead-1' });

            await service.update('tenant-1', 'lead-1', {
                photo_url: 'https://cdn.example/rahim.jpg',
                photo_storage_key: KEY,
            } as any);

            expect(assets.deleteFile).not.toHaveBeenCalled();
        });

        it('reclaims the photo when the lead is deleted', async () => {
            db.lead.findFirst.mockResolvedValueOnce(existingLead());
            db.lead.findMany.mockResolvedValueOnce([{ photo_storage_key: KEY }]);

            await service.remove('tenant-1', 'lead-1');

            expect(assets.deleteFile).toHaveBeenCalledWith(KEY);
            expect(db.lead.delete).toHaveBeenCalledWith({ where: { id: 'lead-1' } });
        });

        it('reclaims photos on a bulk delete', async () => {
            db.lead.findMany.mockResolvedValueOnce([
                { photo_storage_key: KEY },
                { photo_storage_key: OTHER_KEY },
            ]);

            await service.bulkAction('tenant-1', {
                ids: ['lead-1', 'lead-2'],
                action: LeadBulkAction.DELETE,
            } as any);

            expect(assets.deleteFile).toHaveBeenCalledWith(KEY);
            expect(assets.deleteFile).toHaveBeenCalledWith(OTHER_KEY);
        });
    });

    describe('stages', () => {
        const openLead = {
            id: 'lead-s',
            tenant_id: 'tenant-1',
            mobile: '01712121212',
            status: LeadStatus.CONTACTED,
            status_id: 'st-con',
            lost_reason: null,
            priority: 'MEDIUM',
            last_contacted_at: null,
            next_step_date: null,
            source_id: 'src-other',
        };
        const dataOfUpdate = () => db.lead.update.mock.calls[0][0].data;

        beforeEach(() => {
            db.lead.update.mockResolvedValue(openLead);
        });

        it('files a new lead on the NEW stage', async () => {
            db.lead.findFirst.mockResolvedValue(null);
            db.lead.create.mockResolvedValue({ id: 'lead-new' });

            await service.create('tenant-1', 'user-1', { name: 'A' } as any, 'Asia/Dhaka');

            expect(db.lead.create.mock.calls[0][0].data).toEqual(
                expect.objectContaining({ status: 'NEW', status_id: 'st-new' }),
            );
        });

        it('creates a lead on a custom stage with its open lifecycle', async () => {
            db.lead.findFirst.mockResolvedValue(null);
            db.lead.create.mockResolvedValue({ id: 'lead-new' });

            await service.create('tenant-1', 'user-1', { name: 'A', status_id: 'st-neg' } as any, 'Asia/Dhaka');

            expect(db.lead.create.mock.calls[0][0].data).toEqual(
                expect.objectContaining({ status: 'QUALIFIED', status_id: 'st-neg', closed_at: undefined }),
            );
        });

        it('moves to a custom stage without touching the close date or lost reason', async () => {
            db.lead.findFirst.mockResolvedValue(openLead);

            await service.update('tenant-1', 'lead-s', { status_id: 'st-neg' } as any);

            expect(dataOfUpdate()).toEqual(
                expect.objectContaining({ status: 'QUALIFIED', status_id: 'st-neg' }),
            );
            expect(db.crmActivity.updateMany).not.toHaveBeenCalled();
        });

        it('requires a lost reason when the chosen stage closes the lead as lost', async () => {
            db.lead.findFirst.mockResolvedValue(openLead);

            await expect(
                service.update('tenant-1', 'lead-s', { status_id: 'st-lost' } as any),
            ).rejects.toThrow(BadRequestException);
        });

        it('closes the lead when moved to the lost stage with a reason', async () => {
            db.lead.findFirst.mockResolvedValue(openLead);

            await service.update('tenant-1', 'lead-s', { status_id: 'st-lost', lost_reason: 'Price' } as any);

            expect(dataOfUpdate()).toEqual(
                expect.objectContaining({
                    status: 'LOST',
                    status_id: 'st-lost',
                    lost_reason: 'Price',
                    closed_at: expect.any(Date),
                    score: 0,
                }),
            );
        });

        it('keeps a custom stage when an old client re-sends the lifecycle it shows', async () => {
            db.lead.findFirst.mockResolvedValue({ ...openLead, status: 'QUALIFIED', status_id: 'st-neg' });

            await service.update('tenant-1', 'lead-s', { status: LeadStatus.QUALIFIED, remarks: 'x' } as any);

            expect(dataOfUpdate()).not.toHaveProperty('status_id');
            expect(dataOfUpdate()).not.toHaveProperty('status');
        });

        it('lets status_id win over a disagreeing status', async () => {
            db.lead.findFirst.mockResolvedValue(openLead);

            await service.update('tenant-1', 'lead-s', { status_id: 'st-neg', status: 'LOST' } as any);

            expect(dataOfUpdate()).toEqual(
                expect.objectContaining({ status: 'QUALIFIED', status_id: 'st-neg' }),
            );
        });

        it('bulk-moves leads to a stage, writing both columns', async () => {
            db.lead.findMany.mockResolvedValue([
                { id: 'a', status: LeadStatus.CONTACTED, custom_fields: null },
                { id: 'b', status: LeadStatus.CONTACTED, custom_fields: null },
            ]);
            db.lead.findFirst.mockImplementation(async ({ where }: any) => ({ ...openLead, id: where.id }));

            await service.bulkAction('tenant-1', {
                ids: ['a', 'b'],
                action: LeadBulkAction.STATUS,
                value: 'st-neg',
            } as any);

            expect(db.lead.update).toHaveBeenCalledTimes(2);
            expect(db.lead.update.mock.calls.map((call: any[]) => call[0].where.id)).toEqual(['a', 'b']);
            expect(dataOfUpdate()).toEqual(
                expect.objectContaining({ status_id: 'st-neg', status: 'QUALIFIED' }),
            );
        });

        it('refuses a bulk move onto a closing stage', async () => {
            await expect(
                service.bulkAction('tenant-1', { ids: ['a'], action: LeadBulkAction.STATUS, value: 'st-lost' } as any),
            ).rejects.toThrow(BadRequestException);
            expect(db.lead.update).not.toHaveBeenCalled();
        });

        it('filters the list to one stage', async () => {
            db.lead.findMany.mockResolvedValue([]);
            db.lead.count.mockResolvedValue(0);

            await service.findAll('tenant-1', { statusId: 'st-neg' } as any);

            expect(db.lead.findMany.mock.calls[0][0].where.status_id).toBe('st-neg');
        });

        it('sorts by the stage order the tenant set, not the enum', async () => {
            db.lead.findMany.mockResolvedValue([]);
            db.lead.count.mockResolvedValue(0);

            await service.findAll('tenant-1', { sortBy: 'status', sortDir: 'asc' } as any);

            expect(db.lead.findMany.mock.calls[0][0].orderBy).toEqual({ statusOption: { sort_order: 'asc' } });
        });

        it('keeps a custom stage when a re-imported sheet names only its lifecycle', async () => {
            // An export taken before stage names were exported says QUALIFIED for a
            // lead on "Negotiation"; re-importing it must not pull the lead off.
            taxonomyService.list.mockImplementation(async (_t: string, kind: string) =>
                kind === 'statuses' ? STAGES : [],
            );
            db.lead.findFirst.mockResolvedValueOnce(existingByMobile('01800000079'));
            db.lead.findUnique.mockResolvedValue({ status: 'QUALIFIED' });
            db.lead.update.mockResolvedValue({ id: 'lead-existing' });

            await service.importRows('tenant-1', [
                { name: 'Imp', mobile: '01800000079', status: 'QUALIFIED' },
            ], 'upsert', 'Asia/Dhaka');

            const data = db.lead.update.mock.calls[0][0].data;
            expect(data).not.toHaveProperty('status_id');
            expect(data).not.toHaveProperty('status');
        });

        it('still moves a lead when the re-imported lifecycle differs', async () => {
            taxonomyService.list.mockImplementation(async (_t: string, kind: string) =>
                kind === 'statuses' ? STAGES : [],
            );
            db.lead.findFirst.mockResolvedValueOnce(existingByMobile('01800000080'));
            db.lead.findUnique.mockResolvedValue({ status: 'QUALIFIED' });
            db.lead.update.mockResolvedValue({ id: 'lead-existing' });

            await service.importRows('tenant-1', [
                { name: 'Imp', mobile: '01800000080', status: 'Contacted' },
            ], 'upsert', 'Asia/Dhaka');

            expect(db.lead.update.mock.calls[0][0].data).toEqual(
                expect.objectContaining({ status: 'CONTACTED', status_id: 'st-con' }),
            );
        });

        it('imports a status cell naming a custom stage', async () => {
            taxonomyService.list.mockImplementation(async (_t: string, kind: string) =>
                kind === 'statuses' ? STAGES : [],
            );
            db.lead.findFirst.mockResolvedValue(null);
            db.lead.create.mockResolvedValue({ id: 'lead-imp' });

            const result = await service.importRows('tenant-1', [
                { name: 'Imp', mobile: '01800000077', status: 'negotiation' },
            ], 'skip', 'Asia/Dhaka');

            expect(result.errors).toEqual([]);
            expect(db.lead.create.mock.calls[0][0].data).toEqual(
                expect.objectContaining({ status: 'QUALIFIED', status_id: 'st-neg' }),
            );
        });

        it('rejects an imported status cell naming a lost-lifecycle stage', async () => {
            taxonomyService.list.mockImplementation(async (_t: string, kind: string) =>
                kind === 'statuses' ? STAGES : [],
            );

            const result = await service.importRows('tenant-1', [
                { name: 'Imp', mobile: '01800000078', status: 'Lost' },
            ], 'skip', 'Asia/Dhaka');

            expect(result.created).toBe(0);
            expect(result.errors[0]).toMatch(/lost_reason/);
        });
    });

    describe('bulkAction() — edit field', () => {
        const lead = (id: string, extra: Record<string, unknown> = {}) => ({
            id,
            tenant_id: 'tenant-1',
            status: LeadStatus.CONTACTED,
            status_id: 'st-con',
            lost_reason: null,
            priority: 'MEDIUM',
            last_contacted_at: null,
            next_step_date: null,
            source_id: 'src-other',
            custom_fields: null,
            ...extra,
        });
        const rows: Record<string, ReturnType<typeof lead>> = {
            a: lead('a'),
            b: lead('b'),
            won: lead('won', { status: LeadStatus.CONVERTED, status_id: 'st-won' }),
        };
        const updatedIds = () => db.lead.update.mock.calls.map((call: any[]) => call[0].where.id);
        const dataFor = (id: string) =>
            db.lead.update.mock.calls.find((call: any[]) => call[0].where.id === id)?.[0].data;

        beforeEach(() => {
            db.lead.findMany.mockImplementation(async ({ where }: any) =>
                where.id.in.map((id: string) => rows[id]).filter(Boolean),
            );
            db.lead.findFirst.mockImplementation(async ({ where }: any) => rows[where.id] ?? null);
            db.lead.update.mockImplementation(async ({ where }: any) => rows[where.id]);
        });

        const edit = (ids: string[], changes: Record<string, unknown>) =>
            service.bulkAction('tenant-1', { ids, action: LeadBulkAction.UPDATE, changes } as any);

        it('sets one field on every selected lead and skips converted ones', async () => {
            const result = await edit(['a', 'b', 'won'], { priority: 'URGENT' });

            expect(result).toEqual({ count: 2, skipped: 1 });
            expect(updatedIds()).toEqual(['a', 'b']);
            expect(dataFor('a')).toEqual(expect.objectContaining({ priority: 'URGENT' }));
        });

        // The list's old bulk paths were a raw updateMany: no rescoring, and a
        // converted lead in the selection was quietly moved back onto an open stage.
        it('rescores each lead it changes', async () => {
            await edit(['a'], { priority: 'URGENT' });

            expect(dataFor('a').score).toEqual(expect.any(Number));
        });

        it('leaves converted leads alone on a bulk status move', async () => {
            const result = await service.bulkAction('tenant-1', {
                ids: ['a', 'won'],
                action: LeadBulkAction.STATUS,
                value: 'st-neg',
            } as any);

            expect(result).toEqual({ count: 1, skipped: 1 });
            expect(updatedIds()).toEqual(['a']);
        });

        it('unassigns through the assign action', async () => {
            await service.bulkAction('tenant-1', { ids: ['a', 'won'], action: LeadBulkAction.ASSIGN, value: '' } as any);

            expect(updatedIds()).toEqual(['a']);
            expect(dataFor('a').assigned_to).toBeNull();
        });

        it('moves leads to an open stage', async () => {
            await edit(['a'], { status_id: 'st-neg' });

            expect(dataFor('a')).toEqual(expect.objectContaining({ status_id: 'st-neg', status: 'QUALIFIED' }));
        });

        it('refuses a closing stage before touching any lead', async () => {
            await expect(edit(['a', 'b'], { status_id: 'st-lost' })).rejects.toThrow(BadRequestException);
            expect(db.lead.update).not.toHaveBeenCalled();
        });

        it('clears the category with an empty value', async () => {
            await edit(['a'], { category: '' });

            expect(dataFor('a')).toEqual(expect.objectContaining({ category_id: null, category: null }));
        });

        it('refuses an unknown source before touching any lead', async () => {
            taxonomyService.resolveByIdOrCode.mockResolvedValue(null);

            await expect(edit(['a', 'b'], { source: 'no-such-source' })).rejects.toThrow(BadRequestException);
            expect(db.lead.update).not.toHaveBeenCalled();
        });

        it('sets a custom field without disturbing the lead\'s other custom values', async () => {
            rows.a = lead('a', { custom_fields: { area: 'Mirpur', tier: 'Gold', retired_key: 'kept' } });
            customFieldsService.sanitizeValues.mockResolvedValue({ tier: 'Silver' });

            const result = await edit(['a', 'won'], { custom_fields: { tier: 'Silver' } });

            expect(customFieldsService.sanitizeValues).toHaveBeenCalledWith('tenant-1', 'LEAD', { tier: 'Silver' });
            expect(result).toEqual({ count: 1, skipped: 1 });
            expect(dataFor('a')).toEqual({
                custom_fields: { area: 'Mirpur', tier: 'Silver', retired_key: 'kept' },
            });
            rows.a = lead('a');
        });

        it('refuses a custom field the tenant does not have', async () => {
            customFieldsService.sanitizeValues.mockResolvedValue(undefined);

            await expect(edit(['a'], { custom_fields: { nope: 'x' } })).rejects.toThrow(BadRequestException);
            expect(db.lead.update).not.toHaveBeenCalled();
        });

        it('refuses a change set that changes nothing', async () => {
            await expect(edit(['a'], {})).rejects.toThrow(BadRequestException);
            await expect(
                service.bulkAction('tenant-1', { ids: ['a'], action: LeadBulkAction.UPDATE } as any),
            ).rejects.toThrow(BadRequestException);
            expect(db.lead.update).not.toHaveBeenCalled();
        });
    });
});
