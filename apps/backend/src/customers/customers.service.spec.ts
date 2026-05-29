import { Test, TestingModule } from '@nestjs/testing';
import { CustomersService } from './customers.service';
import { DatabaseService } from '../database/database.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EncryptionService } from '../common/encryption.service';

describe('CustomersService', () => {
  let service: CustomersService;
  let db: any;
  let encryption: { encrypt: jest.Mock; decrypt: jest.Mock };

  beforeEach(async () => {
    encryption = {
      encrypt: jest.fn((value: string) => value),
      decrypt: jest.fn((value: string) => value),
    };

    db = {
      customer: {
        findUnique: jest.fn(),
        create: jest.fn(),
        count: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
      },
      sale: {
        count: jest.fn(),
        findMany: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomersService,
        { provide: DatabaseService, useValue: db },
        { provide: EncryptionService, useValue: encryption },
      ],
    }).compile();

    service = module.get<CustomersService>(CustomersService);
  });

  it('should allow creation of new customer if phone unique', async () => {
      db.customer.findUnique.mockResolvedValue(null);
      db.customer.findFirst.mockResolvedValue(null);
      db.customer.create.mockResolvedValue({ id: 'cust-1' });

      const res = await service.create('tenant-1', {
          name: 'Nayeem', phone: '+123', email: '', address: ''
      });
      expect(res.id).toEqual('cust-1');
  });

  it('should throw Error when phone matches existing customer', async () => {
      db.customer.findUnique.mockResolvedValue({ id: 'existing-cust' });
      
      await expect(service.create('tenant-1', { name: 'Oops', phone: '+123' } as any)).rejects.toThrow(BadRequestException);
  });

  it('findAll() should return all customers', async () => {
    db.customer.findMany.mockResolvedValue([{ id: 'c1' }]);
    db.customer.count.mockResolvedValue(1);
    const res = await service.findAll('t1');
    expect(res.items).toHaveLength(1);
    expect(res.total).toBe(1);
  });

  it('findOne() should return details', async () => {
    db.customer.findFirst.mockResolvedValue({ id: 'c1' });
    const res = await service.findOne('t1', 'c1');
    expect(res.id).toEqual('c1');
  });

  it('findOne() should throw if not found', async () => {
    db.customer.findFirst.mockResolvedValue(null);
    await expect(service.findOne('t1', 'fake')).rejects.toThrow(NotFoundException);
  });

  describe('getPurchaseHistory()', () => {
    it('returns paginated purchase history', async () => {
      db.customer.findFirst.mockResolvedValue({
        id: 'c1',
      });
      db.sale.count.mockResolvedValue(2);
      db.sale.findMany.mockResolvedValue([
        {
          id: 's1', total_amount: 1000, created_at: new Date('2026-04-01'),
          items: [
            { id: 'i1', product_id: 'p1', quantity: 2, price_at_sale: 300, product: { name: 'Widget' } },
            { id: 'i2', product_id: 'p2', quantity: 1, price_at_sale: 400, product: { name: 'Gadget' } },
          ],
        },
        {
          id: 's2', total_amount: 500, created_at: new Date('2026-03-01'),
          items: [
            { id: 'i3', product_id: 'p1', quantity: 3, price_at_sale: 100, product: { name: 'Widget' } },
          ],
        },
      ]);

      const result = await service.getPurchaseHistory('t1', 'c1');

      expect(db.sale.count).toHaveBeenCalledWith({ where: { customer_id: 'c1' } });
      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
      expect(result.totalPages).toBe(1);
      expect(result.data).toHaveLength(2);
      expect(result.data[0].items[0].product.name).toBe('Widget');
    });

    it('returns an empty page when customer has no sales', async () => {
      db.customer.findFirst.mockResolvedValue({
        id: 'c2',
      });
      db.sale.count.mockResolvedValue(0);
      db.sale.findMany.mockResolvedValue([]);

      const result = await service.getPurchaseHistory('t1', 'c2');

      expect(result.total).toBe(0);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
      expect(result.totalPages).toBe(0);
      expect(result.data).toEqual([]);
    });

    it('throws NotFoundException when customer does not exist', async () => {
      db.customer.findFirst.mockResolvedValue(null);
      await expect(service.getPurchaseHistory('t1', 'nonexistent')).rejects.toThrow(NotFoundException);
    });
  });
});
