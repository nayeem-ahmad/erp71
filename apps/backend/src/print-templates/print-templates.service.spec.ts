import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
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

        it('falls back to the tenant default for other document types', async () => {
            db.printTemplate.findMany.mockResolvedValue([
                template({ id: 'default', is_default: true }),
                template({ id: 'invoice', is_default: false, doc_types: ['SALES_INVOICE'] }),
            ]);

            const result = await service.resolve('ten1', PrintDocType.VOUCHER);

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
});
