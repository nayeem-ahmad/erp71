import { Test, TestingModule } from '@nestjs/testing';
import { ProductsService } from './products.service';
import { DatabaseService } from '../database/database.service';
import { RedisService } from '../cache/redis.service';
import { NotFoundException } from '@nestjs/common';

describe('ProductsService', () => {
  let service: ProductsService;
  let db: any;
  let tx: any;

  beforeEach(async () => {
    tx = {
      store: {
        findFirst: jest.fn().mockResolvedValue({ id: 'store-1', tenant_id: 'tenant-1', name: 'Main Store' }),
      },
      warehouse: {
        findFirst: jest.fn().mockResolvedValue({ id: 'warehouse-1', store_id: 'store-1', tenant_id: 'tenant-1', is_default: true, is_active: true }),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(),
      },
      inventoryMovement: {
        create: jest.fn(),
      },
      inventorySettings: {
        findUnique: jest.fn().mockResolvedValue({ default_product_warehouse_id: 'warehouse-1' }),
      },
      productGroup: {
        findFirst: jest.fn(),
      },
      productSubgroup: {
        findFirst: jest.fn(),
      },
      product: {
        create: jest.fn(),
        findFirst: jest.fn(),
      },
      productStock: {
        create: jest.fn(),
        upsert: jest.fn().mockResolvedValue({ id: 'stock-1', quantity: 50 }),
        updateMany: jest.fn(),
        findUnique: jest.fn(),
      },
    };

    db = {
      $transaction: jest.fn().mockImplementation((cb) => cb(tx)),
      product: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn(),
        updateMany: jest.fn(),
        deleteMany: jest.fn(),
      },
    };

    const redis = { get: jest.fn().mockResolvedValue(null), set: jest.fn(), invalidatePattern: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: DatabaseService, useValue: db },
        { provide: RedisService, useValue: redis },
      ],
    }).compile();

    service = module.get<ProductsService>(ProductsService);
  });

  describe('create()', () => {
    it('should create a product with initial stock', async () => {
      const product = { id: 'prod-1', name: 'Coffee', sku: 'CF-001', price: 10 };
      tx.product.create.mockResolvedValue(product);
      tx.product.findFirst.mockResolvedValue({ id: 'prod-1', name: 'Coffee', sku: 'CF-001', price: 10, reorder_level: 8, safety_stock: 3, lead_time_days: 5, stocks: [] });

      const result = await service.create('tenant-1', {
        name: 'Coffee',
        sku: 'CF-001',
        price: 10,
        warrantyEnabled: true,
        warrantyDurationDays: 365,
        initialStock: 50,
        reorderLevel: 8,
        safetyStock: 3,
        leadTimeDays: 5,
      });

      expect(tx.product.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenant_id: 'tenant-1',
          name: 'Coffee',
          price: 10,
          warranty_enabled: true,
          warranty_duration_days: 365,
          reorder_level: 8,
          safety_stock: 3,
          lead_time_days: 5,
        }),
        include: expect.any(Object),
      });
      expect(tx.productStock.upsert).toHaveBeenCalled();
      expect(tx.inventoryMovement.create).toHaveBeenCalled();
      expect(result.id).toBe('prod-1');
    });

    it('should create a product without initial stock', async () => {
      const product = { id: 'prod-2', name: 'Tea', sku: 'T-001', price: 5 };
      tx.product.create.mockResolvedValue(product);
      tx.product.findFirst.mockResolvedValue({ id: 'prod-2', name: 'Tea', sku: 'T-001', price: 5, stocks: [] });

      const result = await service.create('tenant-1', {
        name: 'Tea',
        sku: 'T-001',
        price: 5,
      });

      expect(tx.product.create).toHaveBeenCalled();
      expect(tx.productStock.upsert).not.toHaveBeenCalled();
      expect(result.id).toBe('prod-2');
    });
  });

  describe('findAll()', () => {
    it('should return paginated products for the tenant', async () => {
      const items = [
        { id: 'p1', name: 'A', stocks: [] },
        { id: 'p2', name: 'B', stocks: [] },
      ];
      db.product.findMany.mockResolvedValue(items);
      db.product.count.mockResolvedValue(2);

      const result = await service.findAll('tenant-1');

      expect(db.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenant_id: 'tenant-1', deleted_at: null }),
          orderBy: { name: 'asc' },
          skip: 0,
          take: 20,
        }),
      );
      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);
    });
  });

  describe('findOne()', () => {
    it('should return a single product', async () => {
      db.product.findFirst.mockResolvedValue({ id: 'p1', stocks: [] });

      const result = await service.findOne('tenant-1', 'p1');

      expect(result.id).toBe('p1');
    });

    it('should throw NotFoundException when product not found', async () => {
      db.product.findFirst.mockResolvedValue(null);

      await expect(service.findOne('tenant-1', 'missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update()', () => {
    it('should update a product by tenant and id', async () => {
      db.product.findFirst.mockResolvedValue({ id: 'p1', tenant_id: 'tenant-1', name: 'Old', stocks: [] });
      db.product.update.mockResolvedValue({ id: 'p1', tenant_id: 'tenant-1', name: 'Updated', stocks: [] });

      const result = await service.update('tenant-1', 'p1', { name: 'Updated' });

      expect(db.product.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: expect.objectContaining({ name: 'Updated' }),
        include: expect.any(Object),
      });
      expect(result.name).toBe('Updated');
    });

    it('should update warranty fields when provided', async () => {
      db.product.findFirst.mockResolvedValue({ id: 'p1', tenant_id: 'tenant-1', name: 'Old', stocks: [] });
      db.product.update.mockResolvedValue({
        id: 'p1',
        tenant_id: 'tenant-1',
        name: 'Old',
        warranty_enabled: true,
        warranty_duration_days: 730,
        stocks: [],
      });

      await service.update('tenant-1', 'p1', {
        warrantyEnabled: true,
        warrantyDurationDays: 730,
      });

      expect(db.product.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: expect.objectContaining({
          warranty_enabled: true,
          warranty_duration_days: 730,
        }),
        include: expect.any(Object),
      });
    });
  });

  describe('remove()', () => {
    it('should soft-delete a product by setting deleted_at', async () => {
      db.product.findFirst.mockResolvedValue({ id: 'p1', tenant_id: 'tenant-1', deleted_at: null });
      db.product.update.mockResolvedValue({ id: 'p1', tenant_id: 'tenant-1', deleted_at: new Date() });

      await service.remove('tenant-1', 'p1');

      expect(db.product.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'p1' },
          data: expect.objectContaining({ deleted_at: expect.any(Date) }),
        }),
      );
    });
  });
});
