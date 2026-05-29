import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { SuppliersService } from './suppliers.service';

describe('SuppliersService', () => {
    let service: SuppliersService;
    let db: any;

    beforeEach(async () => {
        db = {
            supplier: {
                findUnique: jest.fn(),
                create: jest.fn(),
                findMany: jest.fn(),
                findFirst: jest.fn(),
            },
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                SuppliersService,
                { provide: DatabaseService, useValue: db },
            ],
        }).compile();

        service = module.get<SuppliersService>(SuppliersService);
    });

    it('creates a supplier for the tenant', async () => {
        db.supplier.findUnique.mockResolvedValue(null);
        db.supplier.create.mockResolvedValue({ id: 'sup-1', name: 'ACME Supply' });

        const result = await service.create('tenant-1', { name: 'ACME Supply' });

        expect(db.supplier.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ tenant_id: 'tenant-1', name: 'ACME Supply' }),
        });
        expect(result.id).toBe('sup-1');
    });

    it('rejects duplicate supplier names per tenant', async () => {
        db.supplier.findUnique.mockResolvedValue({ id: 'sup-existing' });

        await expect(service.create('tenant-1', { name: 'ACME Supply' })).rejects.toThrow(BadRequestException);
    });

    it('returns ordered supplier lists', async () => {
        db.supplier.findMany.mockResolvedValue([{ id: 'sup-1' }]);

        await service.findAll('tenant-1');

        expect(db.supplier.findMany).toHaveBeenCalledWith({
            where: { tenant_id: 'tenant-1', deleted_at: null },
            orderBy: { name: 'asc' },
        });
    });

    it('throws when supplier is missing', async () => {
        db.supplier.findFirst.mockResolvedValue(null);

        await expect(service.findOne('tenant-1', 'missing')).rejects.toThrow(NotFoundException);
    });
});