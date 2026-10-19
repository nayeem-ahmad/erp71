import { Test, TestingModule } from '@nestjs/testing';
import { SalesReturnsService } from './sales-returns.service';
import { DatabaseService } from '../database/database.service';
import { BadRequestException } from '@nestjs/common';
import {
    applyInventoryMovement,
    resolveEntryWarehouses,
    resolveWarehouseId,
    reversalWarehouseResolver,
    usableWarehouseIds,
} from '../database/inventory.utils';
import { autoPostFromRules, voidAutoPostedVoucher } from '../accounting/posting.utils';

jest.mock('../database/inventory.utils', () => ({
  applyInventoryMovement: jest.fn(),
  resolveWarehouseId: jest.fn(),
  resolveEntryWarehouses: jest.fn(),
  reversalWarehouseResolver: jest.fn(),
  usableWarehouseIds: jest.fn(),
}));

/**
 * The warehouse helpers stubbed to the shape the real ones return, so these
 * tests stay about what the service does with a warehouse rather than about
 * how one is resolved — `inventory.utils.spec.ts` covers that.
 */
function stubWarehouseResolution(defaultWarehouseId = 'wh-1') {
  (resolveWarehouseId as jest.Mock).mockResolvedValue(defaultWarehouseId);
  (resolveEntryWarehouses as jest.Mock).mockImplementation(
    async (_tx: unknown, _tenantId: string, _storeId: string, entryWarehouseId?: string) => {
      const entryId = entryWarehouseId ?? defaultWarehouseId;
      return {
        entryWarehouseId: entryId,
        warehouseIdFor: (lineWarehouseId?: string | null) => lineWarehouseId || entryId,
      };
    },
  );
  (reversalWarehouseResolver as jest.Mock).mockImplementation(
    (_tx: unknown, _tenantId: string, _storeId: string, documentWarehouseId?: string | null) =>
      async (lineWarehouseId?: string | null) =>
        lineWarehouseId ?? documentWarehouseId ?? defaultWarehouseId,
  );
  (usableWarehouseIds as jest.Mock).mockResolvedValue(new Set<string>());
}

jest.mock('../accounting/posting.utils', () => ({
  autoPostFromRules: jest.fn(),
  voidAutoPostedVoucher: jest.fn(),
  postingIdempotencyKey: jest.requireActual('../accounting/posting.utils').postingIdempotencyKey,
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
      cashierSession: {
          // No shift open by default — a refund at the back office comes out
          // of no drawer.
          findFirst: jest.fn().mockResolvedValue(null)
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
    stubWarehouseResolution();
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

  it('create() refuses a unit a completed exchange already took', async () => {
      db.sale.findUnique.mockResolvedValue({
          id: 'sale-1',
          customer_id: null,
          items: [
              {
                  id: 'item-1',
                  product_id: 'p-1',
                  quantity: 1,
                  price_at_sale: 10,
                  returns: [],
                  exchangeLines: [{ returned_quantity: 1 }],
              },
          ],
      });

      await expect(
          service.create('tenant-1', 'user-1', {
              storeId: 'store-1',
              saleId: 'sale-1',
              items: [{ saleItemId: 'item-1', quantity: 1 }],
          }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(db.salesReturn.create).not.toHaveBeenCalled();
  });

  it('create() puts the goods back where the sale took them from', async () => {
      // Without this a two-warehouse tenant gets every return landing in the
      // configured default, which is exactly the mis-stocking the feature is
      // meant to prevent.
      db.sale.findUnique.mockResolvedValue({
          id: 'sale-1',
          customer_id: null,
          warehouse_id: 'wh-main',
          items: [
              { id: 'item-1', product_id: 'p-1', quantity: 5, price_at_sale: 10, warehouse_id: null, returns: [] },
              { id: 'item-2', product_id: 'p-2', quantity: 5, price_at_sale: 10, warehouse_id: 'wh-annex', returns: [] },
          ],
      });
      db.salesReturn.create.mockResolvedValue({ id: 'return-99' });
      (usableWarehouseIds as jest.Mock).mockResolvedValue(new Set(['wh-main', 'wh-annex']));

      await service.create('tenant-1', 'user-1', {
          storeId: 'store-1',
          saleId: 'sale-1',
          items: [
              { saleItemId: 'item-1', quantity: 1 },
              { saleItemId: 'item-2', quantity: 1 },
          ],
      });

      expect(db.salesReturn.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ warehouse_id: 'wh-main' }),
        }),
      );
      expect(applyInventoryMovement).toHaveBeenCalledWith(
        db,
        expect.objectContaining({ productId: 'p-1', warehouseId: 'wh-main' }),
      );
      expect(applyInventoryMovement).toHaveBeenCalledWith(
        db,
        expect.objectContaining({ productId: 'p-2', warehouseId: 'wh-annex' }),
      );
  });

  it('create() ignores a sale warehouse that has since been closed', async () => {
      // The goods really did come from there, but a deactivated warehouse is no
      // longer somewhere stock may be booked — and a closed warehouse must not
      // be able to block a refund.
      db.sale.findUnique.mockResolvedValue({
          id: 'sale-1',
          customer_id: null,
          warehouse_id: 'wh-closed',
          items: [
              { id: 'item-1', product_id: 'p-1', quantity: 5, price_at_sale: 10, warehouse_id: null, returns: [] },
          ],
      });
      db.salesReturn.create.mockResolvedValue({ id: 'return-98' });
      (usableWarehouseIds as jest.Mock).mockResolvedValue(new Set());

      await service.create('tenant-1', 'user-1', {
          storeId: 'store-1',
          saleId: 'sale-1',
          items: [{ saleItemId: 'item-1', quantity: 1 }],
      });

      expect(applyInventoryMovement).toHaveBeenCalledWith(
        db,
        expect.objectContaining({ productId: 'p-1', warehouseId: 'wh-1' }),
      );
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
        include: {
          sale: true,
          items: { include: { product: true } },
          payments: { orderBy: { created_at: 'asc' } },
        },
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

  it('findOne() includes the refund tenders, in the order they were saved', async () => {
    db.salesReturn.findFirst.mockResolvedValue({ id: 'ret-1' });
    await service.findOne('tenant-1', 'ret-1');
    expect(db.salesReturn.findFirst.mock.calls[0][0].include.payments).toEqual({ orderBy: { created_at: 'asc' } });
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
      cashierSession: { findFirst: jest.fn().mockResolvedValue(null) },
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
    stubWarehouseResolution();
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
            cashierSession: { findFirst: jest.fn().mockResolvedValue(null) },
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
            cashierSession: { findFirst: jest.fn().mockResolvedValue(null) },
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

describe('SalesReturnsService — refund tenders, edit and delete', () => {
  const actualPosting = jest.requireActual('../accounting/posting.utils');
  const LOCKED = { is_locked: true, period_label: 'October 2026' };

  // The rules' own accounts are deliberately not the ones the methods link
  // to — bKash's mode credits `bkash-rule` on its own — so a voucher shows
  // whether a tender reached its method's link or only its mode's fallback.
  const RULES: Record<string, { debit_account_id: string; credit_account_id: string }> = {
    'sale_return:payment_mode:cash': { debit_account_id: 'revenue', credit_account_id: 'cash-in-hand' },
    'sale_return:payment_mode:bank': { debit_account_id: 'revenue', credit_account_id: 'main-bank' },
    'sale_return:payment_mode:bkash': { debit_account_id: 'revenue', credit_account_id: 'bkash-rule' },
    'sale_return:payment_mode:credit': { debit_account_id: 'revenue', credit_account_id: 'ar' },
  };
  const ACCOUNTS: Record<string, string | null> = {
    'cash-in-hand': null,
    'main-bank': null,
    'bkash-rule': null,
    'bkash-acct': null,
    'bkash-new': null,
    revenue: null,
    ar: 'CUSTOMER',
  };
  const createdAt = new Date('2026-10-01T06:00:00.000Z');

  let service: SalesReturnsService;
  let tx: any;
  let seq: number;
  let methods: any[];
  /** Posting events by idempotency key, and the vouchers they point at by id. */
  let events: Map<string, any>;
  let vouchers: Map<string, any>;
  let ledger: any[];
  let customer: { id: string; due_balance: number; total_spent: number; store_id: string };
  let saleRow: any;
  let returnRow: any;
  let paymentRows: any[];
  /** External-sync mapping rows (entity_type, internal_id). */
  let mappings: any[];

  const keyOf = (legKey?: string) => actualPosting.postingIdempotencyKey('tenant-1', 'sale_return', 'ret-1', legKey);
  const voucherOn = (legKey?: string) => {
    const event = events.get(keyOf(legKey));
    return event?.voucher_id ? vouchers.get(event.voucher_id) : undefined;
  };
  /** The live voucher on that leg as [account, debit, credit] rows; undefined when there is none. */
  const voucherRows = (legKey?: string) =>
    voucherOn(legKey)?.details.map((d: any) => [d.account_id, Number(d.debit_amount), Number(d.credit_amount)]);
  const partyOn = (legKey: string | undefined, accountId: string) =>
    voucherOn(legKey)?.details.find((d: any) => d.account_id === accountId)?.party_id ?? null;

  const sale = (overrides: Record<string, unknown> = {}) => ({
    id: 'sale-1',
    store_id: 'store-1',
    customer_id: 'cust-1',
    total_amount: 1000,
    amount_paid: 1000,
    warehouse_id: null,
    payments: [{ payment_method: 'Cash', amount: 1000 }],
    items: [
      { id: 'si-1', product_id: 'p-1', quantity: 10, price_at_sale: 100, unit_cost_at_sale: 60, warehouse_id: null, returns: [], exchangeLines: [] },
    ],
    ...overrides,
  });
  /** Nothing paid at the counter: the customer owes the whole sale. */
  const creditSale = () => sale({ amount_paid: 0, payments: [] });

  const cash = (amount: number, extra: Record<string, unknown> = {}) =>
    ({ paymentMethod: 'Cash', paymentMethodId: 'pm-cash', amount, ...extra });
  const bkash = (amount: number, extra: Record<string, unknown> = {}) =>
    ({ paymentMethod: 'Mobile Wallet', paymentMethodId: 'pm-bkash', amount, ...extra });

  /** Returns `quantity` of the sale's one line (100 each), refunded by `payments` when given. */
  const createReturn = (quantity: number, payments?: Record<string, unknown>[]) =>
    service.create('tenant-1', 'user-1', {
      storeId: 'store-1',
      saleId: 'sale-1',
      items: [{ saleItemId: 'si-1', quantity }],
      ...(payments && { payments }),
    } as any);
  const lines = (quantity: number) => [{ saleItemId: 'si-1', productId: 'p-1', quantity }];
  /** Every write to the customer's total_spent since the last mockClear, as Prisma was asked. */
  const totalSpentWrites = () =>
    (tx.customer.update as jest.Mock).mock.calls
      .map(([args]: any[]) => args.data.total_spent)
      .filter((write: unknown) => write !== undefined);

  beforeEach(async () => {
    jest.clearAllMocks();
    seq = 0;
    events = new Map();
    vouchers = new Map();
    ledger = [];
    paymentRows = [];
    mappings = [];
    returnRow = null;
    saleRow = sale();
    customer = { id: 'cust-1', due_balance: 0, total_spent: 5000, store_id: 'store-1' };
    methods = [
      { id: 'pm-cash', name: 'Cash', account_id: 'cash-in-hand', all_branches: true, stores: [], sort_order: 1 },
      { id: 'pm-bkash', name: 'bKash', account_id: 'bkash-acct', all_branches: true, stores: [], sort_order: 3 },
    ].map((method) => ({ tenant_id: 'tenant-1', is_active: true, ...method }));

    tx = {
      sale: { findUnique: jest.fn(async () => saleRow) },
      cashierSession: { findFirst: jest.fn().mockResolvedValue(null) },
      product: { findFirst: jest.fn().mockResolvedValue({ id: 'p-9' }) },
      inventorySettings: { findUnique: jest.fn().mockResolvedValue(null) },
      productCost: { findMany: jest.fn().mockResolvedValue([]) },
      productPrice: { findMany: jest.fn().mockResolvedValue([]) },
      salesReturn: {
        create: jest.fn(async ({ data }: any) => {
          const { items, ...scalars } = data;
          returnRow = {
            id: 'ret-1',
            tenders_recorded: false,
            created_at: createdAt,
            ...scalars,
            items: items.create.map((item: any, index: number) => ({ id: `ri-${index}`, return_id: 'ret-1', ...item })),
          };
          return { ...returnRow };
        }),
        update: jest.fn(async ({ data }: any) => {
          const { items, ...scalars } = data;
          Object.assign(returnRow, scalars);
          if (items?.create) returnRow.items = items.create.map((item: any) => ({ return_id: 'ret-1', ...item }));
          return { ...returnRow };
        }),
        findFirst: jest.fn(async () => returnRow && { ...returnRow, sale: saleRow, payments: [...paymentRows] }),
        deleteMany: jest.fn(async () => {
          returnRow = null;
        }),
      },
      salesReturnItem: {
        deleteMany: jest.fn(async () => {
          returnRow.items = [];
        }),
      },
      salesReturnPayment: {
        createMany: jest.fn(async ({ data }: any) => {
          paymentRows.push(...data.map((row: any) => ({ id: `rp-${++seq}`, ...row })));
        }),
        deleteMany: jest.fn(async () => {
          paymentRows = [];
        }),
      },
      customer: {
        findUnique: jest.fn(async () => ({ ...customer })),
        update: jest.fn(async ({ data }: any) => {
          if (data.total_spent?.decrement !== undefined) customer.total_spent -= Number(data.total_spent.decrement);
          if (data.total_spent?.increment !== undefined) customer.total_spent += Number(data.total_spent.increment);
          if (data.due_balance !== undefined) customer.due_balance = Number(data.due_balance);
          return { ...customer };
        }),
      },
      customerCreditTransaction: {
        create: jest.fn(async ({ data }: any) => {
          ledger.push({ ...data, amount: Number(data.amount), balance_after: Number(data.balance_after) });
          return data;
        }),
        findMany: jest.fn(async ({ where }: any) =>
          ledger.filter((row) =>
            row.tenant_id === where.tenant_id
            && row.reference_type === where.reference_type
            && row.reference_id === where.reference_id)),
      },
      // Answers the filters resolveTenders uses the way Postgres would.
      paymentMethod: {
        findMany: jest.fn(async ({ where, orderBy }: any) => {
          const matched = methods.filter((method) => {
            if (method.tenant_id !== where.tenant_id) return false;
            if (where.id?.in && !where.id.in.includes(method.id)) return false;
            if (where.is_active !== undefined && method.is_active !== where.is_active) return false;
            if (where.OR && !where.OR.some((c: any) => c.name?.equals?.toLowerCase() === method.name.toLowerCase())) {
              return false;
            }
            return true;
          });
          return orderBy ? [...matched].sort((a, b) => a.sort_order - b.sort_order) : matched;
        }),
      },
      // The posting engine's tables, kept as state so a void really removes
      // what a post wrote.
      postingEvent: {
        findUnique: jest.fn(async ({ where }: any) => {
          const event = events.get(where.tenant_id_idempotency_key.idempotency_key);
          return event ? { ...event, voucher: event.voucher_id ? vouchers.get(event.voucher_id) ?? null : null } : null;
        }),
        create: jest.fn(async ({ data }: any) => {
          const event = { id: `pe-${++seq}`, voucher_id: null, ...data };
          events.set(data.idempotency_key, event);
          return event;
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const event = [...events.values()].find((e) => e.id === where.id);
          if (data.status !== undefined) event.status = data.status;
          if (data.voucher_id !== undefined) event.voucher_id = data.voucher_id;
          return event;
        }),
        delete: jest.fn(async ({ where }: any) => {
          for (const [key, event] of events) if (event.id === where.id) events.delete(key);
        }),
        findFirst: jest.fn(async ({ where }: any) =>
          [...events.values()].find((event) =>
            event.tenant_id === where.tenant_id
            && event.source_module === where.source_module
            && event.source_type === where.source_type
            && event.source_id === where.source_id) ?? null),
      },
      externalSyncMapping: {
        findFirst: jest.fn(async ({ where }: any) =>
          mappings.find((row) =>
            row.tenant_id === where.tenant_id
            && row.entity_type === where.entity_type
            && row.internal_id === where.internal_id) ?? null),
      },
      voucher: {
        create: jest.fn(async ({ data }: any) => {
          const voucher = {
            id: `v-${++seq}`,
            voucher_number: `V-${seq}`,
            voucher_type: data.voucher_type,
            date: data.date ?? new Date(),
            idempotency_key: data.idempotency_key,
            details: data.details.create,
          };
          vouchers.set(voucher.id, voucher);
          return voucher;
        }),
        delete: jest.fn(async ({ where }: any) => {
          vouchers.delete(where.id);
        }),
      },
      voucherDetail: { deleteMany: jest.fn() },
      fiscalPeriod: { findFirst: jest.fn().mockResolvedValue(null) },
      postingRule: {
        findFirst: jest.fn(async ({ where }: any) =>
          RULES[`${where.event_type}:${where.condition_key}:${where.condition_value}`] ?? null),
      },
      account: {
        findMany: jest.fn(async ({ where }: any) =>
          Object.entries(ACCOUNTS)
            .filter(([id]) => where.id.in.includes(id))
            .map(([id, party_type]) => ({ id, party_type }))),
      },
      voucherSequence: {
        upsert: jest.fn().mockResolvedValue({ next_number: 1, prefix: 'V' }),
        update: jest.fn().mockResolvedValue({}),
      },
      accountingSettings: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const db = { $transaction: jest.fn(async (fn: any) => fn(tx)) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [SalesReturnsService, { provide: DatabaseService, useValue: db }],
    }).compile();
    service = module.get<SalesReturnsService>(SalesReturnsService);
    stubWarehouseResolution();
    (applyInventoryMovement as jest.Mock).mockResolvedValue(0);
    // The real posting engine, so these tests read the vouchers it writes and
    // the voids it makes.
    (autoPostFromRules as jest.Mock).mockImplementation(actualPosting.autoPostFromRules);
    (voidAutoPostedVoucher as jest.Mock).mockImplementation(actualPosting.voidAutoPostedVoucher);
  });

  it('split full refund: one keyless voucher crediting Cash and bKash accounts; drawer-relevant payment rows saved; tenders_recorded true', async () => {
    await createReturn(3, [cash(200), bkash(100, { referenceNo: ' TX-1 ' })]);

    expect(voucherRows()).toEqual([
      ['revenue', 300, 0],
      ['cash-in-hand', 0, 200],
      ['bkash-acct', 0, 100],
    ]);
    expect(voucherRows('paid')).toBeUndefined();
    expect(vouchers.size).toBe(1);
    // The canonical type is what the drawer classifies; the method, its name
    // and the account it posted to ride alongside.
    expect(paymentRows).toEqual([
      expect.objectContaining({
        return_id: 'ret-1',
        payment_method: 'Cash',
        payment_method_id: 'pm-cash',
        payment_method_name: 'Cash',
        account_id: 'cash-in-hand',
        amount: 200,
        reference_no: null,
      }),
      expect.objectContaining({
        return_id: 'ret-1',
        payment_method: 'Mobile Wallet',
        payment_method_id: 'pm-bkash',
        payment_method_name: 'bKash',
        account_id: 'bkash-acct',
        amount: 100,
        reference_no: 'TX-1',
      }),
    ]);
    expect(returnRow.tenders_recorded).toBe(true);
    // Refunded in full: nothing comes off the due.
    expect(ledger).toEqual([]);
    expect(customer.total_spent).toBe(4700);
  });

  it("partial refund on a credit sale: AR voucher for the adjusted part + 'paid' voucher for the refund", async () => {
    saleRow = creditSale();
    customer.due_balance = 1000;

    await createReturn(3, [cash(100)]);

    expect(voucherRows()).toEqual([
      ['revenue', 200, 0],
      ['ar', 0, 200],
    ]);
    expect(partyOn(undefined, 'ar')).toBe('cust-1');
    expect(partyOn(undefined, 'revenue')).toBeNull();
    expect(voucherRows('paid')).toEqual([
      ['revenue', 100, 0],
      ['cash-in-hand', 0, 100],
    ]);
    expect(ledger).toEqual([
      expect.objectContaining({
        customer_id: 'cust-1',
        type: 'ADJUSTMENT',
        amount: -200,
        balance_after: 800,
        reference_type: 'SALES_RETURN',
        reference_id: 'ret-1',
        created_by: 'user-1',
      }),
    ]);
    expect(customer.due_balance).toBe(800);
    expect(customer.total_spent).toBe(4700);
  });

  it('credit sale, due 100, return 300, refund 0 → due −200 and an AR leg of 300', async () => {
    saleRow = creditSale();
    customer.due_balance = 100;

    await createReturn(3, []);

    // Not clamped to the due: the excess is an advance the customer holds.
    expect(ledger).toEqual([expect.objectContaining({ amount: -300, balance_after: -200 })]);
    expect(customer.due_balance).toBe(-200);
    expect(voucherRows()).toEqual([
      ['revenue', 300, 0],
      ['ar', 0, 300],
    ]);
    expect(partyOn(undefined, 'ar')).toBe('cust-1');
    expect(voucherRows('paid')).toBeUndefined();
    // Recorded with no tenders: the drawer counts nothing for it.
    expect(paymentRows).toEqual([]);
    expect(returnRow.tenders_recorded).toBe(true);
  });

  it('no customer and a partial refund → 400 with the exact copy', async () => {
    saleRow = sale({ customer_id: null });
    await expect(createReturn(3, [cash(100)])).rejects.toThrow(
      new BadRequestException("Refund the full amount, or pick the customer's sale"),
    );

    // A return with no sale has no customer either.
    await expect(
      service.create('tenant-1', 'user-1', {
        storeId: 'store-1',
        items: [{ productId: 'p-9', quantity: 1, unitPrice: 300 }],
        payments: [cash(100)],
      } as any),
    ).rejects.toThrow(new BadRequestException("Refund the full amount, or pick the customer's sale"));
  });

  it('refund above total → 400', async () => {
    await expect(createReturn(3, [cash(250), bkash(100)])).rejects.toThrow(
      new BadRequestException('The refund is more than the return total.'),
    );
  });

  it('a new tender on a method not offered at the branch → 400', async () => {
    methods[1].all_branches = false;
    await expect(createReturn(3, [bkash(300)])).rejects.toThrow(
      new BadRequestException("That payment method isn't available at this branch."),
    );
  });

  it('omitted payments posts exactly as today', async () => {
    saleRow = creditSale();
    customer.due_balance = 100;

    await createReturn(3);

    expect(autoPostFromRules).toHaveBeenCalledTimes(1);
    const posting = (autoPostFromRules as jest.Mock).mock.calls[0][0];
    expect(posting).toEqual(expect.objectContaining({
      eventType: 'sale_return',
      conditionKey: 'payment_mode',
      conditionValue: 'credit',
      sourceId: 'ret-1',
      amount: 300,
      partyType: 'CUSTOMER',
      partyId: 'cust-1',
    }));
    expect(posting.tenderLegs).toBeUndefined();
    expect(posting.legKey).toBeUndefined();
    expect(posting.date).toBeUndefined();
    // Today's clamp: only what the customer owed comes off.
    expect(ledger).toEqual([expect.objectContaining({ amount: -100, balance_after: 0 })]);
    expect(tx.salesReturnPayment.createMany).not.toHaveBeenCalled();
    expect(tx.paymentMethod.findMany).not.toHaveBeenCalled();
    expect(returnRow.tenders_recorded).toBe(false);
  });

  it('omitted payments on a bKash sale still refunds through the bKash rule', async () => {
    saleRow = sale({ payments: [{ payment_method: 'bKash', amount: 1000 }] });

    await createReturn(3);

    expect((autoPostFromRules as jest.Mock).mock.calls[0][0].conditionValue).toBe('bkash');
    expect(voucherRows()).toEqual([
      ['revenue', 300, 0],
      ['bkash-rule', 0, 300],
    ]);
  });

  it('update re-settles: old vouchers voided, opposite ADJUSTMENT written; an unchanged total leaves total_spent untouched', async () => {
    saleRow = creditSale();
    customer.due_balance = 1000;
    await createReturn(3, [cash(100)]);
    const returnNumber = returnRow.return_number;
    (tx.customer.update as jest.Mock).mockClear();

    await service.update('tenant-1', 'ret-1', { payments: [bkash(300)] } as any, 'user-2');

    // Refunded in full now: one keyless voucher, the old AR and 'paid' legs gone.
    expect(voucherRows()).toEqual([
      ['revenue', 300, 0],
      ['bkash-acct', 0, 300],
    ]);
    expect(voucherRows('paid')).toBeUndefined();
    expect(vouchers.size).toBe(1);
    // Reposted on the return's own date, so the edit does not move its period.
    expect(voucherOn().date).toEqual(createdAt);
    expect(ledger).toEqual([
      expect.objectContaining({ amount: -200, balance_after: 800 }),
      expect.objectContaining({
        type: 'ADJUSTMENT',
        amount: 200,
        balance_after: 1000,
        reference_type: 'SALES_RETURN',
        reference_id: 'ret-1',
        notes: `Reversed return ${returnNumber}`,
        created_by: 'user-2',
      }),
    ]);
    expect(customer.due_balance).toBe(1000);
    // Still ৳300 back: not restored and taken again, not touched at all.
    expect(totalSpentWrites()).toEqual([]);
    expect(customer.total_spent).toBe(4700);
    expect(paymentRows).toEqual([
      expect.objectContaining({ payment_method_id: 'pm-bkash', account_id: 'bkash-acct', amount: 300 }),
    ]);
  });

  it('update of a return from ৳300 to ৳200 increments total_spent by 100 (net)', async () => {
    await createReturn(3, [cash(300)]);
    expect(customer.total_spent).toBe(4700);
    (tx.customer.update as jest.Mock).mockClear();

    await service.update('tenant-1', 'ret-1', { items: lines(2), payments: [cash(200)] } as any, 'user-1');

    // One write for the difference — nothing records whether the return
    // lowered total_spent when it was saved (an imported one never did).
    expect(totalSpentWrites()).toEqual([{ decrement: -100 }]);
    expect(customer.total_spent).toBe(4800);
  });

  it('update of a legacy return unwinds its legacy ADJUSTMENT and voucher', async () => {
    saleRow = creditSale();
    customer.due_balance = 1000;
    await createReturn(3);
    expect(voucherRows()).toEqual([
      ['revenue', 300, 0],
      ['ar', 0, 300],
    ]);
    const returnNumber = returnRow.return_number;

    await service.update('tenant-1', 'ret-1', { payments: [cash(300)] } as any, 'user-1');

    expect(ledger).toEqual([
      expect.objectContaining({ amount: -300, balance_after: 700 }),
      expect.objectContaining({ amount: 300, balance_after: 1000, notes: `Reversed return ${returnNumber}` }),
    ]);
    expect(customer.due_balance).toBe(1000);
    expect(voucherRows()).toEqual([
      ['revenue', 300, 0],
      ['cash-in-hand', 0, 300],
    ]);
    expect(vouchers.size).toBe(1);
    expect(customer.total_spent).toBe(4700);
    expect(returnRow.tenders_recorded).toBe(true);
  });

  it('update of a legacy return with new lines and no payments settles it the legacy way again', async () => {
    saleRow = creditSale();
    customer.due_balance = 1000;
    await createReturn(3);

    await service.update('tenant-1', 'ret-1', { items: lines(2) } as any, 'user-1');

    expect(ledger.map((row) => [row.amount, row.balance_after])).toEqual([
      [-300, 700],
      [300, 1000],
      [-200, 800],
    ]);
    expect(customer.due_balance).toBe(800);
    expect(voucherRows()).toEqual([
      ['revenue', 200, 0],
      ['ar', 0, 200],
    ]);
    expect(customer.total_spent).toBe(4800);
    expect(returnRow.tenders_recorded).toBe(false);
    expect(paymentRows).toEqual([]);
  });

  it('update with items only keeps stored payments', async () => {
    customer.due_balance = 500;
    await createReturn(3, [cash(200), bkash(100, { referenceNo: 'TX-1' })]);
    // bKash has since been linked elsewhere: a kept tender reposts where it was saved.
    methods[1].account_id = 'bkash-new';

    await service.update('tenant-1', 'ret-1', { items: lines(4) } as any, 'user-1');

    // 400 back now: the 300 refunded as before, the other 100 against the due.
    expect(voucherRows()).toEqual([
      ['revenue', 100, 0],
      ['ar', 0, 100],
    ]);
    expect(voucherRows('paid')).toEqual([
      ['revenue', 300, 0],
      ['cash-in-hand', 0, 200],
      ['bkash-acct', 0, 100],
    ]);
    expect(paymentRows).toEqual([
      expect.objectContaining({ payment_method_id: 'pm-cash', account_id: 'cash-in-hand', amount: 200 }),
      expect.objectContaining({ payment_method_id: 'pm-bkash', account_id: 'bkash-acct', amount: 100, reference_no: 'TX-1' }),
    ]);
    expect(customer.due_balance).toBe(400);
    expect(customer.total_spent).toBe(4600);
    expect(returnRow.total_refund).toBe(400);
  });

  it('update with items only refuses when the stored payments exceed the new total', async () => {
    await createReturn(3, [cash(300)]);

    await expect(service.update('tenant-1', 'ret-1', { items: lines(2) } as any, 'user-1')).rejects.toThrow(
      new BadRequestException('The refund is more than the new return total — change the refund too.'),
    );
  });

  it('a reason-only update touches nothing', async () => {
    await createReturn(3, [cash(300)]);
    const before = voucherRows();

    await service.update('tenant-1', 'ret-1', { reason: 'Damaged box' } as any, 'user-1');

    expect(returnRow.reason).toBe('Damaged box');
    expect(voidAutoPostedVoucher).not.toHaveBeenCalled();
    expect(voucherRows()).toEqual(before);
    expect(paymentRows).toHaveLength(1);
    expect(customer.total_spent).toBe(4700);
  });

  it('remove unwinds vouchers and due', async () => {
    saleRow = creditSale();
    customer.due_balance = 1000;
    await createReturn(3, [cash(100)]);
    const returnNumber = returnRow.return_number;
    (tx.customer.update as jest.Mock).mockClear();

    await service.remove('tenant-1', 'ret-1', 'user-1');

    expect(vouchers.size).toBe(0);
    expect(events.size).toBe(0);
    expect(ledger.at(-1)).toEqual(expect.objectContaining({
      amount: 200,
      balance_after: 1000,
      reference_id: 'ret-1',
      notes: `Reversed return ${returnNumber}`,
    }));
    expect(customer.due_balance).toBe(1000);
    // A statistic, left as it is, as a delete always has.
    expect(totalSpentWrites()).toEqual([]);
    expect(customer.total_spent).toBe(4700);
    expect(paymentRows).toEqual([]);
    expect(returnRow).toBeNull();
  });

  it('a return in a closed fiscal period cannot be edited', async () => {
    await createReturn(3, [cash(300)]);
    tx.fiscalPeriod.findFirst.mockResolvedValue(LOCKED);

    await expect(service.update('tenant-1', 'ret-1', { payments: [bkash(300)] } as any, 'user-1')).rejects.toThrow(
      /FISCAL_PERIOD_LOCKED/,
    );
    await expect(service.remove('tenant-1', 'ret-1', 'user-1')).rejects.toThrow(/FISCAL_PERIOD_LOCKED/);
    expect(voucherRows()).toEqual([
      ['revenue', 300, 0],
      ['cash-in-hand', 0, 300],
    ]);
  });
  it('re-sending the stored tenders unchanged with a new reason writes only the reason', async () => {
    await createReturn(3, [cash(200), bkash(100, { referenceNo: 'TX-1' })]);
    const before = voucherRows();
    jest.clearAllMocks();

    await service.update(
      'tenant-1',
      'ret-1',
      { reason: 'Wrong size', payments: [cash(200), bkash(100, { referenceNo: 'TX-1' })] } as any,
      'user-1',
    );

    expect(tx.salesReturn.update).toHaveBeenCalledTimes(1);
    expect(tx.salesReturn.update).toHaveBeenCalledWith({ where: { id: 'ret-1' }, data: { reason: 'Wrong size' } });
    expect(returnRow.reason).toBe('Wrong size');
    expect(voidAutoPostedVoucher).not.toHaveBeenCalled();
    expect(autoPostFromRules).not.toHaveBeenCalled();
    expect(tx.customer.update).not.toHaveBeenCalled();
    expect(tx.customerCreditTransaction.create).not.toHaveBeenCalled();
    expect(tx.salesReturnPayment.deleteMany).not.toHaveBeenCalled();
    expect(tx.salesReturnPayment.createMany).not.toHaveBeenCalled();
    expect(voucherRows()).toEqual(before);
  });

  it('a corrected reference on the same tenders rewrites the rows, not the books', async () => {
    await createReturn(3, [cash(200), bkash(100, { referenceNo: 'TX-1' })]);
    const before = voucherRows();
    jest.clearAllMocks();

    await service.update('tenant-1', 'ret-1', { payments: [cash(200), bkash(100, { referenceNo: 'TX-9' })] } as any, 'user-1');

    expect(voidAutoPostedVoucher).not.toHaveBeenCalled();
    expect(autoPostFromRules).not.toHaveBeenCalled();
    expect(tx.customerCreditTransaction.create).not.toHaveBeenCalled();
    expect(paymentRows).toEqual([
      expect.objectContaining({ payment_method_id: 'pm-cash', account_id: 'cash-in-hand', amount: 200, reference_no: null }),
      expect.objectContaining({ payment_method_id: 'pm-bkash', account_id: 'bkash-acct', amount: 100, reference_no: 'TX-9' }),
    ]);
    expect(voucherRows()).toEqual(before);
  });

  it('a legacy return given an empty refund is re-settled, not taken for unchanged tenders', async () => {
    saleRow = creditSale();
    customer.due_balance = 1000;
    await createReturn(3);

    await service.update('tenant-1', 'ret-1', { payments: [] } as any, 'user-1');

    // Its missing rows meant "refund unknown", not "refunded nothing".
    expect(voidAutoPostedVoucher).toHaveBeenCalled();
    expect(ledger.map((row) => row.amount)).toEqual([-300, 300, -300]);
    expect(voucherRows()).toEqual([
      ['revenue', 300, 0],
      ['ar', 0, 300],
    ]);
    expect(returnRow.tenders_recorded).toBe(true);
  });

  describe('a return external sync imported', () => {
    const IMPORTED = 'This return came from an import — change it in the source system and re-sync.';

    /**
     * The return as the importer leaves it (external-sync.impacts.ts
     * applySaleReturnCredit): no tender rows, the whole total off the due
     * unclamped (100 owed → −200), a credit voucher posted from
     * 'external-sync', and a mapping row while the connection exists.
     */
    const importReturn = async ({ mapped = true } = {}) => {
      saleRow = creditSale();
      customer.due_balance = -200;
      returnRow = {
        id: 'ret-1',
        tenant_id: 'tenant-1',
        store_id: 'store-1',
        sale_id: 'sale-1',
        session_id: null,
        return_number: 'DZ-RET-7',
        total_refund: 300,
        reason: 'Imported',
        tenders_recorded: false,
        created_at: createdAt,
        warehouse_id: null,
        items: [{ id: 'ri-0', return_id: 'ret-1', sale_item_id: 'si-1', product_id: 'p-1', quantity: 3, refund_amount: 300, warehouse_id: null }],
      };
      ledger.push({
        tenant_id: 'tenant-1',
        customer_id: 'cust-1',
        store_id: 'store-1',
        type: 'ADJUSTMENT',
        amount: -300,
        balance_after: -200,
        reference_type: 'SALES_RETURN',
        reference_id: 'ret-1',
        notes: 'Imported sale return DZ-RET-7',
      });
      await actualPosting.autoPostFromRules({
        tx,
        tenantId: 'tenant-1',
        eventType: 'sale_return',
        conditionKey: 'payment_mode',
        conditionValue: 'credit',
        sourceModule: 'external-sync',
        sourceType: 'sale_return',
        sourceId: 'ret-1',
        amount: 300,
        description: 'Imported sale return DZ-RET-7',
        referenceNumber: 'DZ-RET-7',
        date: createdAt,
        storeId: 'store-1',
        partyType: 'CUSTOMER',
        partyId: 'cust-1',
      });
      if (mapped) {
        mappings.push({ tenant_id: 'tenant-1', entity_type: 'SALE_RETURN', external_id: 'dz-7', internal_id: 'ret-1' });
      }
      jest.clearAllMocks();
    };

    const expectUntouched = () => {
      expect(voidAutoPostedVoucher).not.toHaveBeenCalled();
      expect(autoPostFromRules).not.toHaveBeenCalled();
      expect(applyInventoryMovement).not.toHaveBeenCalled();
      expect(tx.salesReturn.update).not.toHaveBeenCalled();
      expect(tx.salesReturnItem.deleteMany).not.toHaveBeenCalled();
      expect(tx.salesReturnPayment.createMany).not.toHaveBeenCalled();
      expect(tx.salesReturnPayment.deleteMany).not.toHaveBeenCalled();
      expect(tx.customer.update).not.toHaveBeenCalled();
      expect(tx.customerCreditTransaction.create).not.toHaveBeenCalled();
      expect(voucherRows()).toEqual([
        ['revenue', 300, 0],
        ['ar', 0, 300],
      ]);
      expect(ledger).toHaveLength(1);
      expect(customer.due_balance).toBe(-200);
    };

    it('an edit to its lines is refused before anything is written', async () => {
      await importReturn();

      await expect(service.update('tenant-1', 'ret-1', { items: lines(2) } as any, 'user-1')).rejects.toThrow(
        new BadRequestException(IMPORTED),
      );
      expectUntouched();
    });

    it('an edit to its refund is refused', async () => {
      await importReturn();

      await expect(service.update('tenant-1', 'ret-1', { payments: [cash(300)] } as any, 'user-1')).rejects.toThrow(
        new BadRequestException(IMPORTED),
      );
      expectUntouched();
    });

    it('is still recognised by its voucher once the connection, and with it the mapping, is gone', async () => {
      await importReturn({ mapped: false });

      await expect(service.update('tenant-1', 'ret-1', { items: lines(2) } as any, 'user-1')).rejects.toThrow(
        new BadRequestException(IMPORTED),
      );
      expectUntouched();
    });

    it('a reason-only edit is allowed', async () => {
      await importReturn();

      await service.update('tenant-1', 'ret-1', { reason: 'Customer changed their mind' } as any, 'user-1');

      expect(returnRow.reason).toBe('Customer changed their mind');
      expect(voidAutoPostedVoucher).not.toHaveBeenCalled();
      expect(ledger).toHaveLength(1);
      expect(voucherRows()).toEqual([
        ['revenue', 300, 0],
        ['ar', 0, 300],
      ]);
    });

    it('delete voids its voucher and reverses its ADJUSTMENT exactly', async () => {
      await importReturn();

      await service.remove('tenant-1', 'ret-1', 'user-1');

      expect(vouchers.size).toBe(0);
      expect(events.size).toBe(0);
      expect(ledger).toEqual([
        expect.objectContaining({ amount: -300, balance_after: -200 }),
        expect.objectContaining({
          type: 'ADJUSTMENT',
          amount: 300,
          balance_after: 100,
          reference_type: 'SALES_RETURN',
          reference_id: 'ret-1',
          notes: 'Reversed return DZ-RET-7',
        }),
      ]);
      expect(customer.due_balance).toBe(100);
      expect(returnRow).toBeNull();
    });
  });
});
