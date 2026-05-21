import { Test, TestingModule } from '@nestjs/testing';
import { SalesService } from './sales.service';
import { DatabaseService } from '../database/database.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { applyInventoryMovement, resolveWarehouseId } from '../database/inventory.utils';
import { autoPostFromRules } from '../accounting/posting.utils';

jest.mock('../database/inventory.utils', () => ({
  applyInventoryMovement: jest.fn(),
  resolveWarehouseId: jest.fn(),
}));

jest.mock('../accounting/posting.utils', () => ({
  autoPostFromRules: jest.fn(),
}));

describe('SalesService', () => {
  let service: SalesService;
  let db: any;
  let tx: any;

  beforeEach(async () => {
    jest.clearAllMocks();
    tx = {
      product: {
        findMany: jest.fn(),
      },
      sale: {
        create: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      saleItem: {
        create: jest.fn(),
        deleteMany: jest.fn(),
      },
      productStock: {
        updateMany: jest.fn(),
      },
      customer: {
        update: jest.fn(),
      },
      paymentRecord: {
        deleteMany: jest.fn(),
        create: jest.fn(),
      },
      inventorySettings: {
        findUnique: jest.fn(),
      },
      warehouse: {
        findFirst: jest.fn(),
      },
      productSerial: {
        findUnique: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
      },
    };

    db = {
      $transaction: jest.fn().mockImplementation((cb) => cb(tx)),
      sale: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      voucher: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalesService,
        { provide: DatabaseService, useValue: db },
      ],
    }).compile();

    service = module.get<SalesService>(SalesService);
    (resolveWarehouseId as jest.Mock).mockResolvedValue('wh-1');
    (applyInventoryMovement as jest.Mock).mockResolvedValue(0);
    (autoPostFromRules as jest.Mock).mockResolvedValue({
      postingStatus: 'posted',
      voucherId: 'voucher-1',
      voucherNumber: 'CR-00001',
      voucherType: 'cash_receive',
    });
    tx.product.findMany.mockResolvedValue([{ id: 'prod-1', name: 'Product 1', warranty_enabled: false }]);
    tx.productSerial.findUnique.mockResolvedValue(null);
    tx.productSerial.update.mockResolvedValue({});
    tx.productSerial.create.mockResolvedValue({});
    db.voucher.findMany.mockResolvedValue([]);
    db.voucher.findFirst.mockResolvedValue(null);
  });

  describe('create() — Story 10.3: Atomic Sale Transaction', () => {
    it('should create a sale and atomically decrement stock', async () => {
      const sale = { id: 'sale-1', total_amount: 30 };
      tx.sale.create.mockResolvedValue(sale);
      tx.saleItem.create.mockResolvedValue({});
      tx.productStock.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.create('tenant-1', {
        storeId: 'store-1',
        totalAmount: 30,
        amountPaid: 30,
        items: [{ productId: 'prod-1', quantity: 2, priceAtSale: 15 }],
      });

      expect(tx.saleItem.create).toHaveBeenCalledWith({
        data: { sale_id: 'sale-1', product_id: 'prod-1', quantity: 2, price_at_sale: 15 },
      });
      expect(applyInventoryMovement).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          tenantId: 'tenant-1',
          productId: 'prod-1',
          warehouseId: 'wh-1',
          quantityDelta: -2,
          movementType: 'SALE',
        }),
      );
      expect(result.id).toBe('sale-1');
    });

    it('should throw BadRequestException when stock is insufficient', async () => {
      tx.product.findMany.mockResolvedValue([
        { id: 'prod-low', name: 'Low Stock Product', warranty_enabled: false },
      ]);
      tx.sale.create.mockResolvedValue({ id: 'sale-2' });
      tx.saleItem.create.mockResolvedValue({});
      (applyInventoryMovement as jest.Mock).mockRejectedValueOnce(new BadRequestException('Insufficient stock'));

      await expect(
        service.create('tenant-1', {
          storeId: 'store-1',
          totalAmount: 15,
          amountPaid: 15,
          items: [{ productId: 'prod-low', quantity: 100, priceAtSale: 15 }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should update customer total_spent when customerId is provided', async () => {
      tx.sale.create.mockResolvedValue({ id: 'sale-3', total_amount: 50 });
      tx.saleItem.create.mockResolvedValue({});
      tx.productStock.updateMany.mockResolvedValue({ count: 1 });
      tx.customer.update.mockResolvedValue({});

      await service.create('tenant-1', {
        storeId: 'store-1',
        customerId: 'cust-1',
        totalAmount: 50,
        amountPaid: 50,
        items: [{ productId: 'prod-1', quantity: 1, priceAtSale: 50 }],
      });

      expect(tx.customer.update).toHaveBeenCalledWith({
        where: { id: 'cust-1' },
        data: { total_spent: { increment: 50 } },
      });
    });

    it('should not update customer when no customerId', async () => {
      tx.sale.create.mockResolvedValue({ id: 'sale-4' });
      tx.saleItem.create.mockResolvedValue({});
      tx.productStock.updateMany.mockResolvedValue({ count: 1 });

      await service.create('tenant-1', {
        storeId: 'store-1',
        totalAmount: 20,
        amountPaid: 20,
        items: [{ productId: 'prod-1', quantity: 1, priceAtSale: 20 }],
      });

      expect(tx.customer.update).not.toHaveBeenCalled();
    });
  });

  describe('create() — Story 10.4: Advanced Payments (Split/Cards)', () => {
    it('should create a sale with split payment methods', async () => {
      const sale = { id: 'sale-5' };
      tx.sale.create.mockResolvedValue(sale);
      tx.saleItem.create.mockResolvedValue({});
      tx.productStock.updateMany.mockResolvedValue({ count: 1 });

      await service.create('tenant-1', {
        storeId: 'store-1',
        totalAmount: 100,
        amountPaid: 100,
        items: [{ productId: 'prod-1', quantity: 1, priceAtSale: 100 }],
        payments: [
          { paymentMethod: 'CASH', amount: 60 },
          { paymentMethod: 'BKASH', amount: 40 },
        ],
      });

      expect(tx.sale.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          payments: {
            create: [
              { payment_method: 'CASH', amount: 60 },
              { payment_method: 'BKASH', amount: 40 },
            ],
          },
        }),
      });
    });

    it('should create a sale without explicit payments payload', async () => {
      tx.sale.create.mockResolvedValue({ id: 'sale-6' });
      tx.saleItem.create.mockResolvedValue({});
      tx.productStock.updateMany.mockResolvedValue({ count: 1 });

      await service.create('tenant-1', {
        storeId: 'store-1',
        totalAmount: 20,
        amountPaid: 20,
        items: [{ productId: 'prod-1', quantity: 1, priceAtSale: 20 }],
      });

      expect(tx.sale.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ payments: undefined }),
      });
    });

    it('should process multiple items atomically', async () => {
      tx.sale.create.mockResolvedValue({ id: 'sale-7' });
      tx.saleItem.create.mockResolvedValue({});
      (applyInventoryMovement as jest.Mock).mockResolvedValue(0);
      tx.product.findMany.mockResolvedValue([
        { id: 'prod-A', name: 'Product A', warranty_enabled: false },
        { id: 'prod-B', name: 'Product B', warranty_enabled: false },
      ]);

      await service.create('tenant-1', {
        storeId: 'store-1',
        totalAmount: 50,
        amountPaid: 50,
        items: [
          { productId: 'prod-A', quantity: 2, priceAtSale: 10 },
          { productId: 'prod-B', quantity: 3, priceAtSale: 10 },
        ],
      });

      expect(tx.saleItem.create).toHaveBeenCalledTimes(2);
      expect(applyInventoryMovement).toHaveBeenCalledTimes(2);
    });

    it('should reject sale when a warranty serial is already sold', async () => {
      tx.product.findMany.mockResolvedValue([
        { id: 'prod-w', name: 'Warranty Product', warranty_enabled: true },
      ]);
      tx.sale.create.mockResolvedValue({ id: 'sale-8', total_amount: 100 });
      tx.saleItem.create.mockResolvedValue({});
      tx.productSerial.findUnique.mockResolvedValue({
        id: 'serial-1',
        status: 'SOLD',
        source_id: 'prior-sale-1',
      });

      await expect(
        service.create('tenant-1', {
          storeId: 'store-1',
          totalAmount: 100,
          amountPaid: 100,
          items: [
            {
              productId: 'prod-w',
              quantity: 1,
              priceAtSale: 100,
              serialNumbers: ['SERIAL-001'],
            },
          ],
        }),
      ).rejects.toThrow(BadRequestException);

      expect(tx.productSerial.create).not.toHaveBeenCalled();
      expect(tx.productSerial.update).not.toHaveBeenCalled();
    });
  });

  describe('findAll()', () => {
    it('should return cursor-paginated sales for a tenant', async () => {
      db.sale.findMany.mockResolvedValue([{ id: 's1' }, { id: 's2' }]);
      db.voucher.findMany.mockResolvedValue([]);

      const result = await service.findAll('tenant-1');

      expect(db.sale.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenant_id: 'tenant-1' } }),
      );
      expect(result.items).toHaveLength(2);
      expect(result).toHaveProperty('nextCursor');
      expect(result).toHaveProperty('hasMore');
    });
  });

  describe('findOne()', () => {
    it('should return a sale with items and payments', async () => {
      db.sale.findFirst.mockResolvedValue({ id: 's1', items: [], payments: [] });

      const result = await service.findOne('tenant-1', 's1');

      expect(result.id).toBe('s1');
    });

    it('should throw NotFoundException when sale does not exist', async () => {
      db.sale.findFirst.mockResolvedValue(null);

      await expect(service.findOne('tenant-1', 'missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update()', () => {
    it('should update a sale note', async () => {
      tx.sale.findFirst.mockResolvedValue({ id: 's1', items: [], payments: [], total_amount: 20, customer_id: null });
      tx.sale.update.mockResolvedValue({ id: 's1', note: 'Updated note' });

      const result = await service.update('tenant-1', 's1', { note: 'Updated note' });

      expect(tx.sale.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: expect.objectContaining({ note: 'Updated note' }),
        include: {
          items: { include: { product: true } },
          payments: true,
        },
      });
      expect(result).toBeDefined();
    });

    it('should throw NotFoundException when sale to update is not found', async () => {
      tx.sale.findFirst.mockResolvedValue(null);

      await expect(service.update('tenant-1', 'bad-id', { note: 'x' })).rejects.toThrow(NotFoundException);
    });
  });
});
