import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BrandsService } from './brands.service';
import { DatabaseService } from '../database/database.service';

describe('BrandsService', () => {
    let service: BrandsService;
    let db: any;

    beforeEach(async () => {
        jest.clearAllMocks();

        db = {
            brand: {
                findUnique: jest.fn(),
                findFirst: jest.fn(),
                findMany: jest.fn(),
                count: jest.fn(),
                create: jest.fn(),
                update: jest.fn(),
                delete: jest.fn(),
            },
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                BrandsService,
                { provide: DatabaseService, useValue: db },
            ],
        }).compile();

        service = module.get<BrandsService>(BrandsService);
    });

    // ─── create ────────────────────────────────────────────────────────────────

    describe('create', () => {
        const tenantId = 'tenant-1';
        const dto = {
            name: 'Nike',
            description: 'Sportswear',
            logo_url: 'https://example.com/logo.png',
            website_url: 'https://nike.com',
        };

        it('should create a brand when name is unique', async () => {
            db.brand.findUnique.mockResolvedValue(null);
            const created = { id: 'brand-1', tenant_id: tenantId, ...dto };
            db.brand.create.mockResolvedValue(created);

            const result = await service.create(tenantId, dto);

            expect(db.brand.findUnique).toHaveBeenCalledWith({
                where: { tenant_id_name: { tenant_id: tenantId, name: dto.name } },
            });
            expect(db.brand.create).toHaveBeenCalledWith({
                data: {
                    tenant_id: tenantId,
                    name: dto.name,
                    description: dto.description,
                    logo_url: dto.logo_url,
                    website_url: dto.website_url,
                },
            });
            expect(result).toEqual(created);
        });

        it('should create a brand with minimal fields (no optional fields)', async () => {
            db.brand.findUnique.mockResolvedValue(null);
            const minDto = { name: 'Adidas' };
            const created = { id: 'brand-2', tenant_id: tenantId, name: 'Adidas' };
            db.brand.create.mockResolvedValue(created);

            const result = await service.create(tenantId, minDto as any);

            expect(result).toEqual(created);
        });

        it('should throw BadRequestException when brand name already exists', async () => {
            db.brand.findUnique.mockResolvedValue({ id: 'existing-brand' });

            const promise = service.create(tenantId, dto);

            await expect(promise).rejects.toThrow(BadRequestException);
            await expect(promise).rejects.toThrow('A brand with this name already exists.');
            expect(db.brand.create).not.toHaveBeenCalled();
        });
    });

    // ─── findAll ────────────────────────────────────────────────────────────────

    describe('findAll', () => {
        it('should return all non-deleted brands for tenant', async () => {
            const tenantId = 'tenant-1';
            const brands = [
                { id: 'brand-1', name: 'Adidas', deleted_at: null },
                { id: 'brand-2', name: 'Nike', deleted_at: null },
            ];
            db.brand.findMany.mockResolvedValue(brands);
            db.brand.count.mockResolvedValue(2);

            const result = await service.findAll(tenantId);

            expect(db.brand.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { tenant_id: tenantId, deleted_at: null },
                    orderBy: { name: 'asc' },
                }),
            );
            expect(result.items).toEqual(brands);
            expect(result.total).toBe(2);
        });

        it('should return empty array when no brands exist', async () => {
            db.brand.findMany.mockResolvedValue([]);
            db.brand.count.mockResolvedValue(0);

            const result = await service.findAll('tenant-empty');

            expect(result.items).toEqual([]);
            expect(result.total).toBe(0);
        });
    });

    // ─── findOne ────────────────────────────────────────────────────────────────

    describe('findOne', () => {
        const tenantId = 'tenant-1';
        const brandId = 'brand-1';

        it('should return a brand when it exists', async () => {
            const brand = { id: brandId, name: 'Nike', tenant_id: tenantId, deleted_at: null };
            db.brand.findFirst.mockResolvedValue(brand);

            const result = await service.findOne(tenantId, brandId);

            expect(db.brand.findFirst).toHaveBeenCalledWith({
                where: { id: brandId, tenant_id: tenantId, deleted_at: null },
            });
            expect(result).toEqual(brand);
        });

        it('should throw NotFoundException when brand does not exist', async () => {
            db.brand.findFirst.mockResolvedValue(null);

            const promise = service.findOne(tenantId, 'nonexistent');

            await expect(promise).rejects.toThrow(NotFoundException);
            await expect(promise).rejects.toThrow('Brand not found');
        });
    });

    // ─── update ────────────────────────────────────────────────────────────────

    describe('update', () => {
        const tenantId = 'tenant-1';
        const brandId = 'brand-1';
        const existingBrand = { id: brandId, name: 'Nike', tenant_id: tenantId, deleted_at: null };

        it('should update a brand with new name when no duplicate exists', async () => {
            const dto = { name: 'Nike Pro', description: 'Updated description' };
            db.brand.findFirst.mockResolvedValueOnce(existingBrand);
            db.brand.findUnique.mockResolvedValue(null);
            const updated = { ...existingBrand, ...dto };
            db.brand.update.mockResolvedValue(updated);

            const result = await service.update(tenantId, brandId, dto);

            expect(db.brand.findUnique).toHaveBeenCalledWith({
                where: { tenant_id_name: { tenant_id: tenantId, name: dto.name } },
            });
            expect(db.brand.update).toHaveBeenCalledWith({
                where: { id: brandId },
                data: { name: dto.name, description: dto.description },
            });
            expect(result).toEqual(updated);
        });

        it('should update without duplicate check when name is unchanged', async () => {
            const dto = { name: 'Nike', description: 'Updated' };
            db.brand.findFirst.mockResolvedValueOnce(existingBrand);
            const updated = { ...existingBrand, description: 'Updated' };
            db.brand.update.mockResolvedValue(updated);

            await service.update(tenantId, brandId, dto);

            expect(db.brand.findUnique).not.toHaveBeenCalled();
        });

        it('should update without checking name when name not provided', async () => {
            const dto = { description: 'Updated description only' };
            db.brand.findFirst.mockResolvedValueOnce(existingBrand);
            const updated = { ...existingBrand, description: dto.description };
            db.brand.update.mockResolvedValue(updated);

            await service.update(tenantId, brandId, dto as any);

            expect(db.brand.findUnique).not.toHaveBeenCalled();
            expect(db.brand.update).toHaveBeenCalled();
        });

        it('should throw NotFoundException when brand not found', async () => {
            db.brand.findFirst.mockResolvedValue(null);

            const promise = service.update(tenantId, 'nonexistent', { name: 'X' });

            await expect(promise).rejects.toThrow(NotFoundException);
            await expect(promise).rejects.toThrow('Brand not found');
            expect(db.brand.update).not.toHaveBeenCalled();
        });

        it('should throw BadRequestException when new name conflicts with another brand', async () => {
            const dto = { name: 'Adidas' };
            db.brand.findFirst.mockResolvedValueOnce(existingBrand);
            db.brand.findUnique.mockResolvedValue({ id: 'other-brand', name: 'Adidas' });

            const promise = service.update(tenantId, brandId, dto);

            await expect(promise).rejects.toThrow(BadRequestException);
            await expect(promise).rejects.toThrow('A brand with this name already exists.');
            expect(db.brand.update).not.toHaveBeenCalled();
        });

        it('should update logo_url and website_url fields', async () => {
            const dto = { logo_url: 'https://new.com/logo.png', website_url: 'https://new.com' };
            db.brand.findFirst.mockResolvedValueOnce(existingBrand);
            db.brand.update.mockResolvedValue({ ...existingBrand, ...dto });

            await service.update(tenantId, brandId, dto as any);

            expect(db.brand.update).toHaveBeenCalledWith({
                where: { id: brandId },
                data: { logo_url: dto.logo_url, website_url: dto.website_url },
            });
        });
    });

    // ─── remove ────────────────────────────────────────────────────────────────

    describe('remove', () => {
        const tenantId = 'tenant-1';
        const brandId = 'brand-1';
        const existingBrand = { id: brandId, name: 'Nike', tenant_id: tenantId, deleted_at: null };

        it('should soft-delete a brand and return success', async () => {
            db.brand.findFirst.mockResolvedValue(existingBrand);
            db.brand.update.mockResolvedValue({ ...existingBrand, deleted_at: new Date() });

            const result = await service.remove(tenantId, brandId);

            expect(db.brand.update).toHaveBeenCalledWith(
                expect.objectContaining({ where: { id: brandId } }),
            );
            expect(result).toEqual({ success: true });
        });

        it('should throw NotFoundException when brand not found', async () => {
            db.brand.findFirst.mockResolvedValue(null);

            const promise = service.remove(tenantId, 'nonexistent');

            await expect(promise).rejects.toThrow(NotFoundException);
            await expect(promise).rejects.toThrow('Brand not found');
            expect(db.brand.update).not.toHaveBeenCalled();
        });
    });

    // ─── importRows ─────────────────────────────────────────────────────────────

    describe('importRows', () => {
        const tenantId = 'tenant-1';

        it('creates new brands', async () => {
            db.brand.findUnique.mockResolvedValue(null);
            db.brand.create.mockResolvedValue({});
            const result = await service.importRows(tenantId, [{ name: 'Nike', description: 'Sport' }], 'skip');
            expect(result).toEqual({ created: 1, updated: 0, skipped: 0, errors: [] });
            expect(db.brand.create).toHaveBeenCalledWith({
                data: { tenant_id: tenantId, name: 'Nike', description: 'Sport' },
            });
        });

        it('skips duplicate when mode is skip', async () => {
            db.brand.findUnique.mockResolvedValue({ id: 'brand-1' });
            const result = await service.importRows(tenantId, [{ name: 'Nike' }], 'skip');
            expect(result).toEqual({ created: 0, updated: 0, skipped: 1, errors: [] });
            expect(db.brand.create).not.toHaveBeenCalled();
        });

        it('updates duplicate when mode is upsert', async () => {
            db.brand.findUnique.mockResolvedValue({ id: 'brand-1' });
            db.brand.update.mockResolvedValue({});
            const result = await service.importRows(tenantId, [{ name: 'Nike', description: 'Updated' }], 'upsert');
            expect(result).toEqual({ created: 0, updated: 1, skipped: 0, errors: [] });
            expect(db.brand.update).toHaveBeenCalledWith({
                where: { id: 'brand-1' },
                data: { name: 'Nike', description: 'Updated' },
            });
        });

        it('errors on missing required name field', async () => {
            const result = await service.importRows(tenantId, [{ description: 'no name' }], 'skip');
            expect(result.errors).toHaveLength(1);
            expect(result.errors[0]).toMatch(/Row 2.*name/);
            expect(db.brand.create).not.toHaveBeenCalled();
        });

        it('continues on row error and processes remaining rows', async () => {
            db.brand.findUnique.mockResolvedValue(null);
            db.brand.create.mockRejectedValueOnce(new Error('DB error')).mockResolvedValueOnce({});
            const result = await service.importRows(tenantId, [{ name: 'A' }, { name: 'B' }], 'skip');
            expect(result.created).toBe(1);
            expect(result.errors).toHaveLength(1);
        });
    });
});
