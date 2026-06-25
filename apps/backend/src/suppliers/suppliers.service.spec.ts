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
                count: jest.fn(),
                findFirst: jest.fn(),
                update: jest.fn(),
            },
            supplierCreditTransaction: {
                count: jest.fn(),
                findMany: jest.fn(),
                create: jest.fn(),
            },
            $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
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

    it('returns paginated supplier lists', async () => {
        db.supplier.findMany.mockResolvedValue([{ id: 'sup-1' }]);
        db.supplier.count.mockResolvedValue(1);

        const result = await service.findAll('tenant-1', 1, 100);

        expect(result.items).toEqual([{ id: 'sup-1' }]);
        expect(result.total).toBe(1);
    });

    it('throws when supplier is missing', async () => {
        db.supplier.findFirst.mockResolvedValue(null);

        await expect(service.findOne('tenant-1', 'missing')).rejects.toThrow(NotFoundException);
    });

    it('records a supplier credit payment and reduces due balance', async () => {
        db.supplier.findFirst.mockResolvedValue({ id: 'sup-1', due_balance: 500 });
        db.supplierCreditTransaction.create.mockResolvedValue({ id: 'tx-1', type: 'PAYMENT' });
        db.supplier.update.mockResolvedValue({ id: 'sup-1', due_balance: 300 });

        const result = await service.recordCreditPayment('tenant-1', 'sup-1', 'user-1', { amount: 200 });

        expect(db.supplierCreditTransaction.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                tenant_id: 'tenant-1',
                supplier_id: 'sup-1',
                type: 'PAYMENT',
                amount: 200,
                balance_after: 300,
            }),
        });
        expect(result.type).toBe('PAYMENT');
    });

    it('rejects supplier payment above payable balance', async () => {
        db.supplier.findFirst.mockResolvedValue({ id: 'sup-1', due_balance: 100 });

        await expect(
            service.recordCreditPayment('tenant-1', 'sup-1', 'user-1', { amount: 150 }),
        ).rejects.toThrow(BadRequestException);
    });
});