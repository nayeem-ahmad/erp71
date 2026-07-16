import { Test, TestingModule } from '@nestjs/testing';
import { CustomersService } from './customers.service';
import { DatabaseService } from '../database/database.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EncryptionService } from '../common/encryption.service';
import { CustomerPaymentDirectionDto } from './customer.dto';

jest.mock('@erp71/database', () => {
  const actual = jest.requireActual('@erp71/database');
  return {
    ...actual,
    ensureCustomerPaymentPostingSetup: jest.fn().mockResolvedValue(undefined),
  };
});

// Default to 'skipped', not 'posted'. A mock that always reports success is why
// nobody noticed customer payments posted nothing for want of an AR account.
jest.mock('../accounting/posting.utils', () => ({
  autoPostFromRules: jest.fn().mockResolvedValue({ postingStatus: 'skipped' }),
  voidAutoPostedVoucher: jest.fn().mockResolvedValue(undefined),
  assertFiscalPeriodOpen: jest.fn().mockResolvedValue(undefined),
}));

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
        update: jest.fn(),
        count: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
      },
      customerGroup: {
        findFirst: jest.fn(),
      },
      customerCreditTransaction: {
        count: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      postingEvent: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      sale: {
        count: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
      },
      $transaction: jest.fn(),
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
          id: 's1', total_amount: 1000, sale_date: new Date('2026-04-01'),
          items: [
            { id: 'i1', product_id: 'p1', quantity: 2, price_at_sale: 300, product: { name: 'Widget' } },
            { id: 'i2', product_id: 'p2', quantity: 1, price_at_sale: 400, product: { name: 'Gadget' } },
          ],
        },
        {
          id: 's2', total_amount: 500, sale_date: new Date('2026-03-01'),
          items: [
            { id: 'i3', product_id: 'p1', quantity: 3, price_at_sale: 100, product: { name: 'Widget' } },
          ],
        },
      ]);

      const result = await service.getPurchaseHistory('t1', 'c1');

      expect(db.sale.count).toHaveBeenCalledWith({ where: { customer_id: 'c1' } });
      expect(db.sale.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { sale_date: 'desc' } }),
      );
      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
      expect(result.totalPages).toBe(1);
      expect(result.data).toHaveLength(2);
      expect(result.data[0].items[0].product.name).toBe('Widget');
    });

    it('filters by sale_date (not created_at) when a date range is given', async () => {
      db.customer.findFirst.mockResolvedValue({ id: 'c1' });
      db.sale.count.mockResolvedValue(0);
      db.sale.findMany.mockResolvedValue([]);

      await service.getPurchaseHistory('t1', 'c1', { from: '2026-06-01', to: '2026-06-30' });

      const countArgs = db.sale.count.mock.calls[0][0];
      expect(countArgs.where.sale_date.gte).toEqual(new Date('2026-06-01'));
      expect(countArgs.where.sale_date.lte).toEqual(new Date('2026-06-30'));
      expect(countArgs.where.created_at).toBeUndefined();

      const findArgs = db.sale.findMany.mock.calls[0][0];
      expect(findArgs.orderBy).toEqual({ sale_date: 'desc' });
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

  describe('getAnalytics()', () => {
    it('computes last purchase date and days-since from sale_date, not created_at', async () => {
      db.customer.findFirst.mockResolvedValue({
        id: 'c1', name: 'Alice', total_spent: 5000, created_at: new Date('2025-01-01'),
        segment_category: 'Regular', loyalty_points: 10, due_balance: 0,
      });
      db.sale.count.mockResolvedValue(3);
      const saleDate = new Date(Date.now() - 5 * 86_400_000);
      db.sale.findFirst.mockResolvedValue({ sale_date: saleDate, total_amount: 1000 });

      const result = await service.getAnalytics('t1', 'c1');

      expect(db.sale.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { sale_date: 'desc' },
          select: { sale_date: true, total_amount: true },
        }),
      );
      expect(result.last_purchase_date).toEqual(saleDate);
      expect(result.days_since_last_purchase).toBe(5);
    });

    it('returns null last_purchase_date when customer has no sales', async () => {
      db.customer.findFirst.mockResolvedValue({
        id: 'c2', name: 'Bob', total_spent: 0, created_at: new Date('2025-01-01'),
        segment_category: 'New', loyalty_points: 0, due_balance: 0,
      });
      db.sale.count.mockResolvedValue(0);
      db.sale.findFirst.mockResolvedValue(null);

      const result = await service.getAnalytics('t1', 'c2');

      expect(result.last_purchase_date).toBeNull();
      expect(result.days_since_last_purchase).toBeNull();
    });
  });

  describe('getCreditLedger()', () => {
    it('returns opening balance from last transaction before period', async () => {
      db.customer.findFirst.mockResolvedValue({
        id: 'c1',
        name: 'Alice',
        phone: '+1',
        due_balance: 500,
        credit_limit: null,
        credit_enabled: true,
      });
      db.customerCreditTransaction.findFirst.mockResolvedValue({ balance_after: 300 });
      db.customerCreditTransaction.findMany.mockResolvedValue([
        {
          id: 'tx-1',
          type: 'PAYMENT',
          amount: 100,
          balance_after: 200,
          created_at: new Date('2026-06-10'),
          creator: { id: 'u1', name: 'Bob' },
        },
      ]);
      db.customerCreditTransaction.count.mockResolvedValue(1);

      const result = await service.getCreditLedger('tenant-1', 'c1', {
        from: '2026-06-01',
        to: '2026-06-30',
      });

      expect(result.opening_balance).toBe(300);
      expect(result.closing_balance).toBe(200);
      expect(result.transactions[0].balance_before).toBe(300);
    });
  });

  describe('listCreditPayments()', () => {
    it('returns paginated PAYMENT transactions with filters', async () => {
      db.customerCreditTransaction.findMany.mockResolvedValue([
        {
          id: 'pay-1',
          payment_number: 'CPY-00001',
          type: 'PAYMENT',
          amount: 500,
          customer: { id: 'c1', name: 'Alice' },
          creator: { id: 'u1', name: 'Cashier' },
        },
      ]);
      db.customerCreditTransaction.count.mockResolvedValue(1);

      const result = await service.listCreditPayments('tenant-1', {
        page: 1,
        limit: 20,
        customerId: 'c1',
        from: '2026-06-01',
        to: '2026-06-30',
        search: 'CPY',
      });

      expect(db.customerCreditTransaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenant_id: 'tenant-1',
            type: { in: ['PAYMENT', 'PAYOUT'] },
            customer_id: 'c1',
          }),
          orderBy: { created_at: 'desc' },
        }),
      );
      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.items[0].payment_number).toBe('CPY-00001');
    });

    it('includes payments created later on the "to" date (end-of-day inclusive)', async () => {
      db.customerCreditTransaction.findMany.mockResolvedValue([]);
      db.customerCreditTransaction.count.mockResolvedValue(0);

      await service.listCreditPayments('tenant-1', {
        page: 1,
        limit: 20,
        to: '2026-06-24',
      });

      const call = db.customerCreditTransaction.findMany.mock.calls[0][0];
      const lte: Date = call.where.created_at.lte;
      expect(lte.getUTCHours()).toBe(23);
      expect(lte.getUTCMinutes()).toBe(59);
      expect(lte.getUTCDate()).toBe(24);
    });
  });

  describe('recordCreditPayment()', () => {
    it('generates payment_number and records payment in a transaction', async () => {
      db.customer.findFirst.mockResolvedValue({ id: 'c1', name: 'Alice', due_balance: 1000 });
      db.customerCreditTransaction.findFirst.mockResolvedValue({ payment_number: 'CPY-00002' });
      db.customerCreditTransaction.create.mockResolvedValue({
        id: 'pay-3',
        payment_number: 'CPY-00003',
        type: 'PAYMENT',
        amount: 250,
      });
      db.customer.update.mockResolvedValue({ id: 'c1', due_balance: 750 });
      db.$transaction.mockImplementation(async (cb: any) => cb(db));

      const result = await service.recordCreditPayment('tenant-1', 'c1', 'user-1', {
        amount: 250,
        notes: 'Partial payment',
      });

      expect(db.customerCreditTransaction.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenant_id: 'tenant-1',
            type: 'PAYMENT',
          }),
        }),
      );
      expect(db.customerCreditTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            payment_number: 'CPY-00003',
            type: 'PAYMENT',
            amount: 250,
            balance_after: 750,
          }),
        }),
      );
      expect(db.customer.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { due_balance: 750 },
      });
      expect(result.payment_number).toBe('CPY-00003');
    });

    it('starts at CPY-00001 when no prior payments exist', async () => {
      db.customer.findFirst.mockResolvedValue({ id: 'c1', name: 'Alice', due_balance: 500 });
      db.customerCreditTransaction.findFirst.mockResolvedValue(null);
      db.customerCreditTransaction.create.mockResolvedValue({
        id: 'pay-1',
        payment_number: 'CPY-00001',
      });
      db.$transaction.mockImplementation(async (cb: any) => cb(db));

      const result = await service.recordCreditPayment('tenant-1', 'c1', 'user-1', { amount: 100 });

      expect(db.customerCreditTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ payment_number: 'CPY-00001' }),
        }),
      );
      expect(result.payment_number).toBe('CPY-00001');
    });

    it('allows receive when due is zero (creates customer advance)', async () => {
      db.customer.findFirst.mockResolvedValue({ id: 'c1', name: 'Alice', due_balance: 0 });
      db.customerCreditTransaction.findFirst.mockResolvedValue(null);
      db.customerCreditTransaction.create.mockResolvedValue({
        id: 'pay-adv',
        payment_number: 'CPY-00001',
        type: 'PAYMENT',
        amount: 500,
      });
      db.$transaction.mockImplementation(async (cb: any) => cb(db));

      await service.recordCreditPayment('tenant-1', 'c1', 'user-1', { amount: 500 });

      expect(db.customer.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { due_balance: -500 },
      });
    });

    it('records payout and increases due balance', async () => {
      db.customer.findFirst.mockResolvedValue({ id: 'c1', name: 'Alice', due_balance: 200 });
      db.customerCreditTransaction.findFirst.mockResolvedValue(null);
      db.customerCreditTransaction.create.mockResolvedValue({
        id: 'payout-1',
        payment_number: 'CPO-00001',
        type: 'PAYOUT',
        amount: 100,
      });
      db.$transaction.mockImplementation(async (cb: any) => cb(db));

      const result = await service.recordCreditPayment('tenant-1', 'c1', 'user-1', {
        amount: 100,
        direction: CustomerPaymentDirectionDto.PAY,
      });

      expect(db.customerCreditTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            payment_number: 'CPO-00001',
            type: 'PAYOUT',
            balance_after: 300,
          }),
        }),
      );
      expect(result.payment_number).toBe('CPO-00001');
    });
  });

  describe('updateCreditPayment()', () => {
    const existingPayment = {
      id: 'pay-1',
      tenant_id: 'tenant-1',
      customer_id: 'c1',
      type: 'PAYMENT',
      amount: 200,
      payment_number: 'CPY-00001',
      notes: 'Old note',
      customer: { id: 'c1', name: 'Alice', phone: '+1', customer_code: 'CUST-00001', due_balance: 800 },
      creator: { id: 'user-1', name: 'Bob' },
    };

    it('reverses old balance, voids voucher, updates and reposts', async () => {
      db.customerCreditTransaction.findFirst.mockResolvedValue(existingPayment);
      db.customer.findFirst.mockResolvedValue({ id: 'c1', name: 'Alice', due_balance: 800 });
      db.customerCreditTransaction.update.mockResolvedValue({
        ...existingPayment,
        amount: 300,
        balance_after: 700,
      });
      db.$transaction.mockImplementation(async (cb: any) => cb(db));

      const { voidAutoPostedVoucher, autoPostFromRules } = require('../accounting/posting.utils');

      await service.updateCreditPayment('tenant-1', 'pay-1', { amount: 300 });

      expect(voidAutoPostedVoucher).toHaveBeenCalledWith(db, 'tenant-1', 'customer_payment', 'pay-1');
      expect(db.customer.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { due_balance: 700 },
      });
      expect(autoPostFromRules).toHaveBeenCalled();
    });

    it('throws when payment not found', async () => {
      db.customerCreditTransaction.findFirst.mockResolvedValue(null);
      await expect(service.updateCreditPayment('tenant-1', 'missing', { amount: 100 }))
        .rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteCreditPayment()', () => {
    const existingPayment = {
      id: 'pay-2',
      tenant_id: 'tenant-1',
      customer_id: 'c1',
      type: 'PAYOUT',
      amount: 150,
      payment_number: 'CPO-00002',
      customer: { id: 'c1', name: 'Alice', due_balance: 350 },
      creator: { id: 'user-1', name: 'Bob' },
    };

    it('reverses balance effect, voids voucher, and deletes transaction', async () => {
      db.customerCreditTransaction.findFirst.mockResolvedValue(existingPayment);
      db.customer.findFirst.mockResolvedValue({ id: 'c1', due_balance: 350 });
      db.$transaction.mockImplementation(async (cb: any) => cb(db));

      const { voidAutoPostedVoucher } = require('../accounting/posting.utils');

      const result = await service.deleteCreditPayment('tenant-1', 'pay-2');

      expect(voidAutoPostedVoucher).toHaveBeenCalledWith(db, 'tenant-1', 'customer_payment', 'pay-2');
      expect(db.customerCreditTransaction.delete).toHaveBeenCalledWith({ where: { id: 'pay-2' } });
      expect(db.customer.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { due_balance: 200 },
      });
      expect(result.deleted).toBe(true);
    });
  });

  // ─── importRows ─────────────────────────────────────────────────────────────

  describe('importRows', () => {
    const tenantId = 'tenant-1';

    it('creates new customer', async () => {
      db.customer.findUnique.mockResolvedValue(null);
      db.customer.findFirst.mockResolvedValue(null); // generateCustomerCode
      db.customerGroup.findFirst.mockResolvedValue(null);
      db.customer.create.mockResolvedValue({});

      const result = await service.importRows(
        tenantId,
        [{ name: 'Alice', phone: '01711000001' }],
        'skip',
      );

      expect(result).toEqual({ created: 1, updated: 0, skipped: 0, errors: [] });
      expect(db.customer.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenant_id: tenantId,
            name: 'Alice',
            phone: '01711000001',
          }),
        }),
      );
    });

    it('skips duplicate (by phone) when mode is skip', async () => {
      db.customer.findUnique.mockResolvedValue({ id: 'cust-1' });
      db.customer.create.mockResolvedValue({});

      const result = await service.importRows(
        tenantId,
        [{ name: 'Alice', phone: '01711000001' }],
        'skip',
      );

      expect(result).toEqual({ created: 0, updated: 0, skipped: 1, errors: [] });
      expect(db.customer.create).not.toHaveBeenCalled();
    });

    it('updates duplicate (by phone) when mode is upsert', async () => {
      db.customer.findUnique.mockResolvedValue({ id: 'cust-1' });
      db.customerGroup.findFirst.mockResolvedValue(null);
      db.customer.update.mockResolvedValue({});

      const result = await service.importRows(
        tenantId,
        [{ name: 'Alice Updated', phone: '01711000001' }],
        'upsert',
      );

      expect(result).toEqual({ created: 0, updated: 1, skipped: 0, errors: [] });
      expect(db.customer.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'cust-1' } }),
      );
    });

    it('errors on missing required name field', async () => {
      const result = await service.importRows(
        tenantId,
        [{ phone: '01711000002' }],
        'skip',
      );

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatch(/Row 2.*name/);
      expect(db.customer.create).not.toHaveBeenCalled();
    });

    it('continues on DB error and processes remaining rows', async () => {
      db.customer.findUnique.mockResolvedValue(null);
      db.customer.findFirst.mockResolvedValue(null);
      db.customerGroup.findFirst.mockResolvedValue(null);
      db.customer.create
        .mockRejectedValueOnce(new Error('DB error'))
        .mockResolvedValueOnce({});

      const result = await service.importRows(
        tenantId,
        [
          { name: 'Alice', phone: '01711000001' },
          { name: 'Bob', phone: '01711000002' },
        ],
        'skip',
      );

      expect(result.created).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatch(/Row 2.*DB error/);
    });

    it('sets customer_group_id to null when group name is not found', async () => {
      db.customer.findUnique.mockResolvedValue(null);
      db.customer.findFirst.mockResolvedValue(null); // generateCustomerCode
      db.customerGroup.findFirst.mockResolvedValue(null); // group not found
      db.customer.create.mockResolvedValue({});

      const result = await service.importRows(
        tenantId,
        [{ name: 'Alice', phone: '01711000001', customer_group_name: 'NonExistentGroup' }],
        'skip',
      );

      expect(result).toEqual({ created: 1, updated: 0, skipped: 0, errors: [] });
      expect(db.customer.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            customer_group_id: null,
          }),
        }),
      );
    });
  });

  describe('ensureCustomerPaymentPostingSetup — Accounts Receivable dependency', () => {
      it('is provisioned by the default template', async () => {
          // Regression: the template had no 'Accounts Receivable' account, so
          // ensureCustomerPaymentPostingSetup returned early, no customer_payment
          // rules were ever created, and every payment silently posted nothing.
          const { DEFAULT_ACCOUNTING_TEMPLATE } = jest.requireActual('@erp71/database');
          const names = DEFAULT_ACCOUNTING_TEMPLATE.flatMap((g: any) =>
              g.subgroups.flatMap((s: any) => s.accounts.map((a: any) => a.name)),
          );
          expect(names).toContain('Accounts Receivable');
      });
  });
});
