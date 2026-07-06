import { Test, TestingModule } from '@nestjs/testing';
import { SalesOrdersService } from './sales-orders.service';
import { DatabaseService } from '../database/database.service';
import { BadRequestException } from '@nestjs/common';

describe('SalesOrdersService', () => {
  let service: SalesOrdersService;
  let db: any;

  beforeEach(async () => {
    db = {
      $transaction: jest.fn().mockImplementation(async (cb) => cb(db)),
      salesOrder: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        findFirst: jest.fn()
      },
      productStock: {
        updateMany: jest.fn(),
        findUnique: jest.fn(),
        upsert: jest.fn(),
      },
      product: {
        findUnique: jest.fn().mockResolvedValue({ type: 'GOODS' }),
      },
      inventoryMovement: {
        create: jest.fn(),
      },
      warehouse: {
        findFirst: jest.fn(),
        create: jest.fn(),
        count: jest.fn(),
      },
      store: {
        findFirst: jest.fn(),
      },
      inventorySettings: {
        findUnique: jest.fn(),
      },
      customer: {
        update: jest.fn()
      },
      orderDeposit: {
        create: jest.fn()
      }
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalesOrdersService,
        { provide: DatabaseService, useValue: db }
      ],
    }).compile();

    service = module.get<SalesOrdersService>(SalesOrdersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('create() should successfully create a draft sales order', async () => {
    const mockOrder = {
        storeId: 'store-1',
        totalAmount: 50,
        items: [{ productId: 'prod-1', quantity: 1, priceAtOrder: 50 }]
    };
    db.salesOrder.create.mockResolvedValue({ id: 'order-1' });

    const result = await service.create('tenant-1', 'user-1', mockOrder);
    expect(db.salesOrder.create).toHaveBeenCalled();
    expect(result).toEqual({ id: 'order-1' });
  });

  it('updateStatus() should decrement stock when delivering', async () => {
    const mockOrder = {
        id: 'order-1',
        tenant_id: 'tenant-1',
        status: 'CONFIRMED',
        total_amount: 100,
        customer_id: 'cust-1',
        items: [{ product_id: 'prod-1', quantity: 2 }]
    };

    db.salesOrder.findUnique.mockResolvedValue(mockOrder);
    db.warehouse.findFirst.mockResolvedValue({ id: 'wh-1' });
    db.productStock.updateMany.mockResolvedValue({ count: 1 });
    db.productStock.findUnique.mockResolvedValue({ quantity: 8 });
    db.inventoryMovement.create.mockResolvedValue({ id: 'move-1' });
    db.salesOrder.update.mockResolvedValue({ ...mockOrder, status: 'DELIVERED' });

    const result = await service.updateStatus('tenant-1', 'order-1', { status: 'DELIVERED' });
    expect(db.productStock.updateMany).toHaveBeenCalledWith({
      where: { product_id: 'prod-1', tenant_id: 'tenant-1', warehouse_id: 'wh-1', quantity: { gte: 2 } },
        data: { quantity: { decrement: 2 } }
    });
    expect(db.customer.update).toHaveBeenCalled();
    expect(result.status).toEqual('DELIVERED');
  });

  it('updateStatus() should throw BadRequest if stock is insufficient', async () => {
    const mockOrder = {
      id: 'order-1',
      tenant_id: 'tenant-1',
      status: 'CONFIRMED',
      items: [{ product_id: 'prod-1', quantity: 999 }]
    };

    db.salesOrder.findUnique.mockResolvedValue(mockOrder);
    db.warehouse.findFirst.mockResolvedValue({ id: 'wh-1' });
    db.productStock.updateMany.mockResolvedValue({ count: 0 }); // simulate failure

    await expect(service.updateStatus('tenant-1', 'order-1', { status: 'DELIVERED' }))
      .rejects.toThrow(BadRequestException);
  });

  it('updateStatus() should skip stock logic for non-DELIVERED status', async () => {
    const mockOrder = { id: 'o-1', tenant_id: 't-1', status: 'DRAFT', items: [] };
    db.salesOrder.findUnique.mockResolvedValue(mockOrder);
    db.salesOrder.update.mockResolvedValue({ status: 'CONFIRMED' });

    await service.updateStatus('t-1', 'o-1', { status: 'CONFIRMED' });
    expect(db.productStock.updateMany).not.toHaveBeenCalled();
    expect(db.salesOrder.update).toHaveBeenCalledWith({
        where: { id: 'o-1' },
        data: { status: 'CONFIRMED' }
    });
  });

  it('addDeposit() should set status to PARTIAL for small deposits', async () => {
      db.salesOrder.findUnique.mockResolvedValue({ id: 'o1', total_amount: 100, amount_paid: 0, payment_status: 'UNPAID' });
      db.salesOrder.update.mockResolvedValue({});
      await service.addDeposit('t1', 'o1', { amount: 10, paymentMethod: 'CASH' });
      expect(db.salesOrder.update).toHaveBeenCalledWith(expect.objectContaining({
          data: expect.objectContaining({ payment_status: 'PARTIAL' })
      }));
  });

  it('addDeposit() should set status to PAID if amount matches exactly', async () => {
    db.salesOrder.findUnique.mockResolvedValue({ id: 'o1', total_amount: 100, amount_paid: 50, payment_status: 'PARTIAL' });
    db.salesOrder.update.mockResolvedValue({});
    await service.addDeposit('t1', 'o1', { amount: 50, paymentMethod: 'CASH' });
    expect(db.salesOrder.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ payment_status: 'PAID' })
    }));
  });

  it('findAll() should return all orders for a tenant', async () => {
    db.salesOrder.findMany.mockResolvedValue([{ id: 'order-1' }]);
    db.salesOrder.count.mockResolvedValue(1);
    const result = await service.findAll('tenant-1');
    expect(db.salesOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenant_id: 'tenant-1' },
        include: { customer: true, items: { include: { product: true } }, deposits: true },
        orderBy: { created_at: 'desc' },
      }),
    );
    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(1);
  });

  it('findOne() should return a single order with details', async () => {
    db.salesOrder.findFirst.mockResolvedValue({ id: 'order-1' });
    const result = await service.findOne('tenant-1', 'order-1');
    expect(db.salesOrder.findFirst).toHaveBeenCalledWith({
      where: { id: 'order-1', tenant_id: 'tenant-1' },
      include: { customer: true, items: { include: { product: true } }, deposits: true }
    });
    expect(result.id).toEqual('order-1');
  });
});
