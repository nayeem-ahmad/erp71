import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrintTemplatesService } from './print-templates.service';
import { DatabaseService } from '../database/database.service';
import { PrintDocType } from './print-templates.dto';

const config = { version: 1, layout: 'logo-left' } as any;

function template(overrides: Record<string, unknown> = {}) {
    return {
        id: 'tpl1',
        tenant_id: 'ten1',
        name: 'Default',
        is_default: true,
        doc_types: [] as string[],
        config,
        created_at: new Date('2026-07-01'),
        updated_at: new Date('2026-07-01'),
        ...overrides,
    };
}

describe('PrintTemplatesService', () => {
    let service: PrintTemplatesService;
    let db: any;

    beforeEach(async () => {
        db = {
            printTemplate: {
                findFirst: jest.fn(),
                findMany: jest.fn(),
                count: jest.fn(),
                create: jest.fn(),
                update: jest.fn(),
                updateMany: jest.fn(),
                delete: jest.fn(),
            },
            tenant: {
                findUnique: jest.fn(),
            },
            printTemplateStoreAssignment: {
                findUnique: jest.fn(),
                findMany: jest.fn(),
                upsert: jest.fn(),
                deleteMany: jest.fn(),
            },
            store: { findFirst: jest.fn() },
            $transaction: jest.fn().mockImplementation(async (cb: any) => cb(db)),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                PrintTemplatesService,
                { provide: DatabaseService, useValue: db },
            ],
        }).compile();

        service = module.get<PrintTemplatesService>(PrintTemplatesService);
        jest.clearAllMocks();
    });

    describe('create()', () => {
        it('makes the first template the default', async () => {
            db.printTemplate.count.mockResolvedValue(0);
            db.printTemplate.create.mockResolvedValue(template());

            await service.create('ten1', { name: 'Default', config });

            expect(db.printTemplate.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ tenant_id: 'ten1', is_default: true }),
                }),
            );
        });

        it('leaves later templates non-default unless asked', async () => {
            db.printTemplate.count.mockResolvedValue(2);
            db.printTemplate.create.mockResolvedValue(template({ is_default: false }));

            await service.create('ten1', { name: 'Thermal', config });

            expect(db.printTemplate.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ is_default: false }),
                }),
            );
            expect(db.printTemplate.updateMany).not.toHaveBeenCalled();
        });

        it('demotes the previous default when a new default is created', async () => {
            db.printTemplate.count.mockResolvedValue(1);
            db.printTemplate.create.mockResolvedValue(template());

            await service.create('ten1', { name: 'New', config, is_default: true });

            expect(db.printTemplate.updateMany).toHaveBeenCalledWith({
                where: { tenant_id: 'ten1', is_default: true },
                data: { is_default: false },
            });
        });
    });

    describe('update()', () => {
        it('rejects a template belonging to another tenant', async () => {
            db.printTemplate.findFirst.mockResolvedValue(null);

            await expect(service.update('ten1', 'tpl1', { name: 'x' }))
                .rejects.toBeInstanceOf(NotFoundException);
            expect(db.printTemplate.update).not.toHaveBeenCalled();
        });

        it('demotes other defaults but not itself', async () => {
            db.printTemplate.findFirst.mockResolvedValue(template({ is_default: false }));
            db.printTemplate.update.mockResolvedValue(template());

            await service.update('ten1', 'tpl1', { is_default: true });

            expect(db.printTemplate.updateMany).toHaveBeenCalledWith({
                where: { tenant_id: 'ten1', is_default: true, id: { not: 'tpl1' } },
                data: { is_default: false },
            });
        });

        it('only writes the fields that were sent', async () => {
            db.printTemplate.findFirst.mockResolvedValue(template());
            db.printTemplate.update.mockResolvedValue(template({ name: 'Renamed' }));

            await service.update('ten1', 'tpl1', { name: 'Renamed' });

            expect(db.printTemplate.update).toHaveBeenCalledWith({
                where: { id: 'tpl1' },
                data: { name: 'Renamed' },
            });
        });
    });

    describe('remove()', () => {
        it('promotes the oldest remaining template when the default is deleted', async () => {
            db.printTemplate.findFirst
                .mockResolvedValueOnce(template({ is_default: true }))
                .mockResolvedValueOnce(template({ id: 'tpl2', is_default: false }));

            await service.remove('ten1', 'tpl1');

            expect(db.printTemplate.delete).toHaveBeenCalledWith({ where: { id: 'tpl1' } });
            expect(db.printTemplate.update).toHaveBeenCalledWith({
                where: { id: 'tpl2' },
                data: { is_default: true },
            });
        });

        it('does not promote anything when a non-default is deleted', async () => {
            db.printTemplate.findFirst.mockResolvedValue(template({ is_default: false }));

            await service.remove('ten1', 'tpl1');

            expect(db.printTemplate.update).not.toHaveBeenCalled();
        });

        it('rejects a template belonging to another tenant', async () => {
            db.printTemplate.findFirst.mockResolvedValue(null);

            await expect(service.remove('ten1', 'tpl1'))
                .rejects.toBeInstanceOf(NotFoundException);
            expect(db.printTemplate.delete).not.toHaveBeenCalled();
        });
    });

    describe('resolve()', () => {
        it('prefers a template assigned to the document type', async () => {
            db.printTemplate.findMany.mockResolvedValue([
                template({ id: 'default', is_default: true }),
                template({ id: 'invoice', is_default: false, doc_types: ['SALES_INVOICE'] }),
            ]);

            const result = await service.resolve('ten1', PrintDocType.SALES_INVOICE);

            expect(result.template_id).toBe('invoice');
        });

        it('resolves DAILY_REPORT against the default template', async () => {
            db.printTemplate.findMany.mockResolvedValue([
                template({ id: 'default', is_default: true }),
                template({ id: 'invoice', is_default: false, doc_types: ['SALES_INVOICE'] }),
            ]);
            expect(PrintDocType.DAILY_REPORT).toBe('DAILY_REPORT');
            const result = await service.resolve('ten1', PrintDocType.DAILY_REPORT);
            expect(result).toBeTruthy();
            expect(result.template_id).toBe('default');
        });

        it('falls back to the tenant default for other document types', async () => {
            db.printTemplate.findMany.mockResolvedValue([
                template({ id: 'default', is_default: true }),
                template({ id: 'invoice', is_default: false, doc_types: ['SALES_INVOICE'] }),
            ]);

            const result = await service.resolve('ten1', PrintDocType.VOUCHER);

            expect(result.template_id).toBe('default');
        });

        /*
         * A shop usually wants a plainer letterhead on the challan the rider
         * carries than on the invoice the customer keeps, which is the whole
         * reason DELIVERY_CHALLAN is its own assignable type rather than
         * riding on SALES_INVOICE.
         */
        it('gives the delivery challan its own template, not the invoice one', async () => {
            db.printTemplate.findMany.mockResolvedValue([
                template({ id: 'default', is_default: true }),
                template({ id: 'invoice', is_default: false, doc_types: ['SALES_INVOICE'] }),
                template({ id: 'challan', is_default: false, doc_types: ['DELIVERY_CHALLAN'] }),
            ]);

            const result = await service.resolve('ten1', PrintDocType.DELIVERY_CHALLAN);

            expect(result.template_id).toBe('challan');
        });

        it('falls back to the tenant default when no challan template is assigned', async () => {
            db.printTemplate.findMany.mockResolvedValue([
                template({ id: 'default', is_default: true }),
                template({ id: 'invoice', is_default: false, doc_types: ['SALES_INVOICE'] }),
            ]);

            const result = await service.resolve('ten1', PrintDocType.DELIVERY_CHALLAN);

            expect(result.template_id).toBe('default');
        });

        it('derives a config from branding when no template exists', async () => {
            db.printTemplate.findMany.mockResolvedValue([]);
            db.tenant.findUnique.mockResolvedValue({
                brand_logo_url: 'https://cdn.example.com/logo.png',
                brand_primary_color: '#0f766e',
            });

            const result = await service.resolve('ten1', PrintDocType.SALES_INVOICE);

            expect(result.template_id).toBeNull();
            expect(result.config).toEqual({
                logo: { url: 'https://cdn.example.com/logo.png' },
                company: { color: '#0f766e' },
                title: { color: '#0f766e' },
                rule: { color: '#0f766e' },
            });
        });

        it('ignores a branding colour that is not a hex value', async () => {
            db.printTemplate.findMany.mockResolvedValue([]);
            db.tenant.findUnique.mockResolvedValue({
                brand_logo_url: null,
                brand_primary_color: 'teal',
            });

            const result = await service.resolve('ten1');

            expect((result.config.company as any).color).toBe('#1d4ed8');
        });
    });

    describe('list()', () => {
        it('scopes the query to the tenant', async () => {
            db.printTemplate.findMany.mockResolvedValue([template()]);

            await service.list('ten1');

            expect(db.printTemplate.findMany).toHaveBeenCalledWith({
                where: { tenant_id: 'ten1' },
                orderBy: [{ is_default: 'desc' }, { name: 'asc' }],
            });
        });
    });
    describe('resolve() with a store', () => {
        it('prefers a store override over the tenant doc-type template', async () => {
            db.store.findFirst.mockResolvedValue({ id: 's1' });
            db.printTemplateStoreAssignment.findUnique.mockResolvedValue({
                template: template({ id: 'gulshan', is_default: false, doc_types: [] }),
            });
            db.printTemplate.findMany.mockResolvedValue([
                template({ id: 'default', is_default: true }),
                template({ id: 'invoice', is_default: false, doc_types: ['SALES_INVOICE'] }),
            ]);

            const result = await service.resolve('ten1', PrintDocType.SALES_INVOICE, 's1');
            expect(result.template_id).toBe('gulshan');
            expect(db.printTemplateStoreAssignment.findUnique).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: {
                        tenant_id_store_id_doc_type: {
                            tenant_id: 'ten1',
                            store_id: 's1',
                            doc_type: 'SALES_INVOICE',
                        },
                    },
                }),
            );
        });

        it('falls back to the tenant chain when the store has no override', async () => {
            db.store.findFirst.mockResolvedValue({ id: 's1' });
            db.printTemplateStoreAssignment.findUnique.mockResolvedValue(null);
            db.printTemplate.findMany.mockResolvedValue([
                template({ id: 'invoice', is_default: false, doc_types: ['SALES_INVOICE'] }),
            ]);

            const result = await service.resolve('ten1', PrintDocType.SALES_INVOICE, 's1');
            expect(result.template_id).toBe('invoice');
        });

        it('ignores a storeId that is not this tenant\u2019s store', async () => {
            db.store.findFirst.mockResolvedValue(null);
            db.printTemplate.findMany.mockResolvedValue([
                template({ id: 'invoice', is_default: false, doc_types: ['SALES_INVOICE'] }),
            ]);

            const result = await service.resolve('ten1', PrintDocType.SALES_INVOICE, 'foreign');
            expect(result.template_id).toBe('invoice');
            expect(db.store.findFirst).toHaveBeenCalledWith(
                expect.objectContaining({ where: { id: 'foreign', tenant_id: 'ten1' } }),
            );
            expect(db.printTemplateStoreAssignment.findUnique).not.toHaveBeenCalled();
        });

        it('skips the override step when storeId is omitted', async () => {
            db.printTemplate.findMany.mockResolvedValue([
                template({ id: 'invoice', is_default: false, doc_types: ['SALES_INVOICE'] }),
            ]);

            const result = await service.resolve('ten1', PrintDocType.SALES_INVOICE);
            expect(result.template_id).toBe('invoice');
            expect(db.store.findFirst).not.toHaveBeenCalled();
            expect(db.printTemplateStoreAssignment.findUnique).not.toHaveBeenCalled();
        });
    });

    describe('upsertAssignment()', () => {
        const uuidStore = '11111111-1111-4111-8111-111111111111';
        const uuidTpl = '22222222-2222-4222-8222-222222222222';
        const key = {
            tenant_id_store_id_doc_type: {
                tenant_id: 'ten1',
                store_id: uuidStore,
                doc_type: 'SALES_INVOICE',
            },
        };

        it('upserts a pin to a named template', async () => {
            db.store.findFirst.mockResolvedValue({ id: uuidStore });
            db.printTemplate.findFirst.mockResolvedValue(template({ id: uuidTpl, is_default: false }));
            db.printTemplateStoreAssignment.upsert.mockResolvedValue({});

            await service.upsertAssignment('ten1', {
                storeId: uuidStore,
                docType: PrintDocType.SALES_INVOICE,
                templateId: uuidTpl,
            });

            expect(db.printTemplateStoreAssignment.upsert).toHaveBeenCalledWith({
                where: key,
                create: {
                    tenant_id: 'ten1',
                    store_id: uuidStore,
                    doc_type: 'SALES_INVOICE',
                    template_id: uuidTpl,
                },
                update: { template_id: uuidTpl },
            });
        });

        it('stores a pin even when the named template is the company default', async () => {
            db.store.findFirst.mockResolvedValue({ id: uuidStore });
            db.printTemplate.findFirst.mockResolvedValue(template({ id: uuidTpl, is_default: true }));
            db.printTemplateStoreAssignment.upsert.mockResolvedValue({});

            await service.upsertAssignment('ten1', {
                storeId: uuidStore,
                docType: PrintDocType.SALES_INVOICE,
                templateId: uuidTpl,
            });

            expect(db.printTemplateStoreAssignment.upsert).toHaveBeenCalled();
            expect(db.printTemplateStoreAssignment.deleteMany).not.toHaveBeenCalled();
        });

        it('clears a missing pin as a no-op', async () => {
            db.store.findFirst.mockResolvedValue({ id: uuidStore });
            db.printTemplateStoreAssignment.deleteMany.mockResolvedValue({ count: 0 });

            await expect(
                service.upsertAssignment('ten1', {
                    storeId: uuidStore,
                    docType: PrintDocType.SALES_INVOICE,
                    templateId: null,
                }),
            ).resolves.toEqual({ success: true });
            expect(db.printTemplateStoreAssignment.deleteMany).toHaveBeenCalledWith({
                where: { tenant_id: 'ten1', store_id: uuidStore, doc_type: 'SALES_INVOICE' },
            });
            expect(db.printTemplateStoreAssignment.upsert).not.toHaveBeenCalled();
        });

        it('rejects a template from another tenant', async () => {
            db.store.findFirst.mockResolvedValue({ id: uuidStore });
            db.printTemplate.findFirst.mockResolvedValue(null);

            await expect(
                service.upsertAssignment('ten1', {
                    storeId: uuidStore,
                    docType: PrintDocType.SALES_INVOICE,
                    templateId: uuidTpl,
                }),
            ).rejects.toBeInstanceOf(BadRequestException);
            expect(db.printTemplate.findFirst).toHaveBeenCalledWith(
                expect.objectContaining({ where: { id: uuidTpl, tenant_id: 'ten1' } }),
            );
            expect(db.printTemplateStoreAssignment.upsert).not.toHaveBeenCalled();
        });

        it('rejects a store from another tenant', async () => {
            db.store.findFirst.mockResolvedValue(null);

            await expect(
                service.upsertAssignment('ten1', {
                    storeId: uuidStore,
                    docType: PrintDocType.SALES_INVOICE,
                    templateId: uuidTpl,
                }),
            ).rejects.toBeInstanceOf(BadRequestException);
            expect(db.printTemplateStoreAssignment.upsert).not.toHaveBeenCalled();
        });
    });

    describe('listAssignments()', () => {
        it('returns the tenant\u2019s override rows', async () => {
            db.printTemplateStoreAssignment.findMany.mockResolvedValue([
                { store_id: 's1', doc_type: 'SALES_INVOICE', template_id: 'tpl1' },
            ]);
            expect(await service.listAssignments('ten1')).toEqual([
                { store_id: 's1', doc_type: 'SALES_INVOICE', template_id: 'tpl1' },
            ]);
            expect(db.printTemplateStoreAssignment.findMany).toHaveBeenCalledWith(
                expect.objectContaining({ where: { tenant_id: 'ten1' } }),
            );
        });
    });
});
