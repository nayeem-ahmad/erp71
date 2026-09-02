import { Test, TestingModule } from '@nestjs/testing';
import { SalesReturnsService } from './sales-returns.service';
import { DatabaseService } from '../database/database.service';
import { BadRequestException } from '@nestjs/common';
import { applyInventoryMovement, resolveWarehouseId } from '../database/inventory.utils';
import { autoPostFromRules } from '../accounting/posting.utils';

jest.mock('../database/inventory.utils', () => ({
  applyInventoryMovement: jest.fn(),
  resolveWarehouseId: jest.fn(),
}));

jest.mock('../accounting/posting.utils', () => ({
  autoPostFromRules: jest.fn(),
}));

describe('SalesReturnsService', () => {
  let service: SalesReturnsService;
  let db: any;

  beforeEach(async () => {
    jest.clearAllMocks();
    db = {
      $transaction: jest.fn().mockImplementation(async (cb) => cb(db)),
      // resolveProductCosts runs on the create and edit paths to cost the
      // returned goods. No settings row and no pool is the common case.
      inventorySettings: { findUnique: jest.fn().mockResolvedValue(null) },
      productCost: { findMany: jest.fn().mockResolvedValue([]) },
      productPrice: { findMany: jest.fn().mockResolvedValue([]) },
      sale: {
          findUnique: jest.fn()
      },
      productStock: {
          updateMany: jest.fn()
      },
      salesReturn: {
          create: jest.fn(),
          findMany: jest.fn(),
          count: jest.fn(),
          findFirst: jest.fn()
      },
        voucher: {
          findMany: jest.fn(),
          findFirst: jest.fn(),
        },
        postingEvent: {
          findMany: jest.fn(),
        },
      customer: {
          update: jest.fn(),
          findUnique: jest.fn()
      },
      customerCreditTransaction: {
          create: jest.fn()
      },
      product: {
          findFirst: jest.fn().mockResolvedValue({ id: 'p-9' })
      }
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalesReturnsService,
        { provide: DatabaseService, useValue: db }
      ],
    }).compile();

    service = module.get<SalesReturnsService>(SalesReturnsService);
    (resolveWarehouseId as jest.Mock).mockResolvedValue('wh-1');
    (applyInventoryMovement as jest.Mock).mockResolvedValue(0);
    (autoPostFromRules as jest.Mock).mockResolvedValue({
      postingStatus: 'posted',
      voucherId: 'voucher-1',
      voucherNumber: 'CP-00001',
      voucherType: 'cash_payment',
    });
    db.voucher.findMany.mockResolvedValue([]);
    db.voucher.findFirst.mockResolvedValue(null);
    db.postingEvent.findMany.mockResolvedValue([]);
  });

  it('create() should process return completely and increment stock', async () => {
      const mockSale = {
          id: 'sale-1',
          customer_id: 'cust-1',
          items: [
              { id: 'item-1', product_id: 'p-1', quantity: 5, price_at_sale: 10, returns: [] }
          ]
      };
      db.sale.findUnique.mockResolvedValue(mockSale);
      db.salesReturn.create.mockResolvedValue({ id: 'return-99' });

      await service.create('tenant-1', 'user-1', {
          storeId: 'store-1',
          saleId: 'sale-1',
          items: [
              { saleItemId: 'item-1', quantity: 2 }
          ]
      });

      expect(applyInventoryMovement).toHaveBeenCalledWith(
        db,
        expect.objectContaining({
          tenantId: 'tenant-1',
          productId: 'p-1',
          warehouseId: 'wh-1',
          quantityDelta: 2,
          movementType: 'SALES_RETURN',
          // Regression: referenceId must be the row id, not the RET- string,
          // so movements trace back to the return like every other caller.
          referenceId: 'return-99',
        }),
      );
      expect(db.customer.update).toHaveBeenCalledWith({
          where: { id: 'cust-1' },
          data: { total_spent: { decrement: 20 } } // 2 * 10
      });
  });

  it('create() reduces customer due and writes a credit ledger entry when returning a credit sale', async () => {
      // Regression: returning a credit sale used to leave the customer still
      // owing for the goods they gave back — total_spent moved but due_balance
      // and the credit ledger did not.
      const mockSale = {
          id: 'sale-1',
          customer_id: 'cust-1',
          total_amount: 100,
          amount_paid: 0, // fully on credit
          payments: [],
          items: [
              { id: 'item-1', product_id: 'p-1', quantity: 5, price_at_sale: 10, returns: [] }
          ]
      };
      db.sale.findUnique.mockResolvedValue(mockSale);
      db.salesReturn.create.mockResolvedValue({ id: 'return-99' });
      db.customer.findUnique.mockResolvedValue({ due_balance: 100 });

      await service.create('tenant-1', 'user-1', {
          storeId: 'store-1',
          saleId: 'sale-1',
          items: [{ saleItemId: 'item-1', quantity: 3 }], // refund 30
      });

      expect(db.customerCreditTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            customer_id: 'cust-1',
            type: 'ADJUSTMENT',
            amount: -30,
            balance_after: 70,
            reference_type: 'SALES_RETURN',
            reference_id: 'return-99',
          }),
        }),
      );
      expect(db.customer.update).toHaveBeenCalledWith({
          where: { id: 'cust-1' },
          data: { due_balance: 70 },
      });
  });

  it('create() should reject overly high returning quantities', async () => {
      const mockSale = {
        id: 'sale-1',
        items: [
            { id: 'item-1', product_id: 'p-1', quantity: 5, returns: [{ quantity: 4 }] }
        ]
    };
    db.sale.findUnique.mockResolvedValue(mockSale);

    await expect(service.create('tenant-1', 'user-1', {
        storeId: 'store-1',
        saleId: 'sale-1',
        items: [{ saleItemId: 'item-1', quantity: 2 }] // Attempting to return 2 but only 1 left.
    })).rejects.toThrow(BadRequestException);
  });

  it('create() should throw if sale not found', async () => {
    db.sale.findUnique.mockResolvedValue(null);
    await expect(service.create('tenant-1', 'user-1', { saleId: 'fake' } as any)).rejects.toThrow(BadRequestException);
  });

  it('findAll() should return all returns for a tenant', async () => {
    db.salesReturn.findMany.mockResolvedValue([{ id: 'ret-1' }]);
    db.salesReturn.count.mockResolvedValue(1);
    const res = await service.findAll('tenant-1');
    expect(db.salesReturn.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenant_id: 'tenant-1' },
        include: { sale: true, items: { include: { product: true } } },
        orderBy: { created_at: 'desc' },
      }),
    );
    expect(res.items).toHaveLength(1);
    expect(res.total).toBe(1);
  });

  it('findAll() should filter created_at to the inclusive Dhaka day range', async () => {
    db.salesReturn.findMany.mockResolvedValue([]);
    db.salesReturn.count.mockResolvedValue(0);

    await service.findAll('tenant-1', 1, 20, { timezone: 'Asia/Dhaka', createdFrom: '2026-08-19', createdTo: '2026-08-19' });

    expect(db.salesReturn.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          created_at: {
            gte: new Date('2026-08-18T18:00:00.000Z'),
            lte: new Date('2026-08-19T17:59:59.999Z'),
          },
        }),
      }),
    );
  });

  it('findOne() should return a single return with details', async () => {
    db.salesReturn.findFirst.mockResolvedValue({ id: 'ret-1' });
    const res = await service.findOne('tenant-1', 'ret-1');
    expect(db.salesReturn.findFirst).toHaveBeenCalled();
    expect(res.id).toEqual('ret-1');
  });
});

describe('SalesReturnsService — returns without a sale', () => {
  let service: SalesReturnsService;
  let db: any;

  beforeEach(async () => {
    jest.clearAllMocks();
    db = {
      $transaction: jest.fn().mockImplementation(async (cb) => cb(db)),
      // resolveProductCosts runs on the create and edit paths to cost the
      // returned goods. No settings row and no pool is the common case.
      inventorySettings: { findUnique: jest.fn().mockResolvedValue(null) },
      productCost: { findMany: jest.fn().mockResolvedValue([]) },
      productPrice: { findMany: jest.fn().mockResolvedValue([]) },
      sale: { findUnique: jest.fn() },
      product: { findFirst: jest.fn().mockResolvedValue({ id: 'p-9' }) },
      salesReturn: { create: jest.fn().mockResolvedValue({ id: 'ret-1', return_number: 'RET-1', total_refund: 250, items: [] }) },
      customer: { update: jest.fn(), findUnique: jest.fn() },
      customerCreditTransaction: { create: jest.fn() },
      voucher: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null) },
      postingEvent: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [SalesReturnsService, { provide: DatabaseService, useValue: db }],
    }).compile();
    service = module.get<SalesReturnsService>(SalesReturnsService);
    (resolveWarehouseId as jest.Mock).mockResolvedValue('wh-1');
    (applyInventoryMovement as jest.Mock).mockResolvedValue(0);
    (autoPostFromRules as jest.Mock).mockResolvedValue({ postingStatus: 'posted' });
  });

  const line = { productId: 'p-9', quantity: 5, unitPrice: 50 };

  it('records a return with no sale, pricing it from the line', async () => {
    await service.create('t1', 'u1', { storeId: 's1', items: [line] } as any);

    // No sale was named, so none should be looked up.
    expect(db.sale.findUnique).not.toHaveBeenCalled();

    const data = db.salesReturn.create.mock.calls[0][0].data;
    expect(data.sale_id).toBeNull();
    expect(data.total_refund).toBe(250);
    expect(data.items.create[0]).toMatchObject({ sale_item_id: null, product_id: 'p-9', quantity: 5, refund_amount: 250 });
  });

  it('restocks the goods even without a parent sale', async () => {
    await service.create('t1', 'u1', { storeId: 's1', items: [line] } as any);

    expect(applyInventoryMovement).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ productId: 'p-9', quantityDelta: 5, movementType: 'SALES_RETURN' }),
    );
  });

  it('settles in cash, the only defensible default when the tender is unknown', async () => {
    await service.create('t1', 'u1', { storeId: 's1', items: [line] } as any);

    expect((autoPostFromRules as jest.Mock).mock.calls[0][0].conditionValue).toBe('cash');
  });

  it('requires a product and a price on each line', async () => {
    await expect(
      service.create('t1', 'u1', { storeId: 's1', items: [{ quantity: 1, unitPrice: 5 }] } as any),
    ).rejects.toThrow(/productId is required/);

    await expect(
      service.create('t1', 'u1', { storeId: 's1', items: [{ productId: 'p-9', quantity: 1 }] } as any),
    ).rejects.toThrow(/unitPrice is required/);
  });

  it('still rejects a sale id that does not exist', async () => {
    db.sale.findUnique.mockResolvedValue(null);

    await expect(
      service.create('t1', 'u1', { storeId: 's1', saleId: 'missing', items: [line] } as any),
    ).rejects.toThrow('Sale not found');
  });
});

describe('SalesReturnsService — posting condition value', () => {
    let service: SalesReturnsService;

    /** @param sale the row tx.sale.findUnique should return */
    const buildModule = async (sale: unknown) => {
        const tx = {
            sale: { findUnique: jest.fn().mockResolvedValue(sale) },
            salesReturn: {
                create: jest.fn().mockResolvedValue({
                    id: 'ret-1',
                    return_number: 'RET-1',
                    total_refund: 250,
                }),
            },
            customer: {
                update: jest.fn().mockResolvedValue({}),
                findUnique: jest.fn().mockResolvedValue({ due_balance: 500 }),
            },
            customerCreditTransaction: { create: jest.fn().mockResolvedValue({}) },
        };
        const db = { $transaction: jest.fn().mockImplementation(async (fn: any) => fn(tx)) };
        const module: TestingModule = await Test.createTestingModule({
            providers: [SalesReturnsService, { provide: DatabaseService, useValue: db }],
        }).compile();
        return module.get<SalesReturnsService>(SalesReturnsService);
    };

    const saleRow = (overrides: Record<string, unknown>) => ({
        id: 'sale-1',
        store_id: 'store-1',
        customer_id: 'cust-1',
        total_amount: 500,
        amount_paid: 500,
        payments: [{ payment_method: 'Cash', amount: 500 }],
        items: [{ id: 'si-1', product_id: 'p-1', quantity: 2, price_at_sale: 250, returns: [] }],
        ...overrides,
    });

    const dto = { saleId: 'sale-1', storeId: 'store-1', items: [{ saleItemId: 'si-1', quantity: 1 }] };

    const lastPosting = () => jest.mocked(autoPostFromRules).mock.calls.at(-1)![0];

    beforeEach(() => jest.mocked(autoPostFromRules).mockClear());

    it('classifies a credit sale return as credit, not cash', async () => {
        // Regression: conditionValue was hardcoded 'cash', so returning a credit sale
        // posted Dr Sales Revenue / Cr Cash in Hand - refunding cash the shop never
        // received, and leaving the receivable untouched.
        service = await buildModule(saleRow({ amount_paid: 0, payments: [] }));
        await service.create('tenant-1', 'user-1', dto as any);
        expect(lastPosting().conditionValue).toBe('credit');
    });

    it('classifies a bKash sale return as bkash', async () => {
        service = await buildModule(saleRow({ payments: [{ payment_method: 'bKash', amount: 500 }] }));
        await service.create('tenant-1', 'user-1', dto as any);
        expect(lastPosting().conditionValue).toBe('bkash');
    });

    it('classifies a fully paid cash sale return as cash', async () => {
        service = await buildModule(saleRow({}));
        await service.create('tenant-1', 'user-1', dto as any);
        expect(lastPosting().conditionValue).toBe('cash');
    });

    it('requests payments ordered by created_at so the refund account is deterministic', async () => {
        // Postgres does not guarantee row order without an ORDER BY, and
        // sales.service.ts rebuilds payment rows via delete-and-recreate on
        // update, which scrambles physical row order. Without an explicit
        // orderBy here, sale.payments?.[0] used to pick refunds could return a
        // different payment method than the one the original sale posted
        // against, so a split-tender, fully-paid sale could credit a
        // different account on return than it debited on sale — silently and
        // nondeterministically.
        const tx = {
            sale: { findUnique: jest.fn().mockResolvedValue(saleRow({})) },
            salesReturn: {
                create: jest.fn().mockResolvedValue({
                    id: 'ret-1',
                    return_number: 'RET-1',
                    total_refund: 250,
                }),
            },
            customer: { update: jest.fn().mockResolvedValue({}) },
        };
        const db = { $transaction: jest.fn().mockImplementation(async (fn: any) => fn(tx)) };
        const module: TestingModule = await Test.createTestingModule({
            providers: [SalesReturnsService, { provide: DatabaseService, useValue: db }],
        }).compile();
        service = module.get<SalesReturnsService>(SalesReturnsService);

        await service.create('tenant-1', 'user-1', dto as any);

        const findUniqueArgs = tx.sale.findUnique.mock.calls.at(-1)![0];
        expect(findUniqueArgs.include.payments).toEqual({ orderBy: { created_at: 'asc' } });
    });
});
