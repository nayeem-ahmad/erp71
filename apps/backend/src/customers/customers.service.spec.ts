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
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: null } }),
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

  it('findAll() should filter created_at to the inclusive Dhaka day range', async () => {
    db.customer.findMany.mockResolvedValue([]);
    db.customer.count.mockResolvedValue(0);

    await service.findAll('t1', { timezone: 'Asia/Dhaka', createdFrom: '2026-08-19', createdTo: '2026-08-19' });

    expect(db.customer.findMany).toHaveBeenCalledWith(
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

      const result = await service.listCreditPayments('tenant-1', { timezone: 'Asia/Dhaka',
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

      await service.listCreditPayments('tenant-1', { timezone: 'Asia/Dhaka',
        page: 1,
        limit: 20,
        to: '2026-06-24',
      });

      const call = db.customerCreditTransaction.findMany.mock.calls[0][0];
      expect(call.where.created_at).toEqual({
        lte: new Date('2026-06-24T17:59:59.999Z'),
      });
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

  describe('recordCreditPayment() — how the money moved', () => {
    const { autoPostFromRules } = require('../accounting/posting.utils');

    beforeEach(() => {
      (autoPostFromRules as jest.Mock).mockClear();
      db.account = { findFirst: jest.fn() };
      db.paymentMethod = { findFirst: jest.fn().mockResolvedValue(null) };
      db.postingRule = { findFirst: jest.fn().mockResolvedValue(null) };
      db.customer.findFirst.mockResolvedValue({ id: 'c1', name: 'Alice', due_balance: 1000 });
      db.customerCreditTransaction.findFirst.mockResolvedValue(null);
      db.customerCreditTransaction.create.mockResolvedValue({ id: 'pay-1', payment_number: 'CPY-00001' });
      db.$transaction.mockImplementation(async (cb: any) => cb(db));
    });

    const postedWith = () => (autoPostFromRules as jest.Mock).mock.calls[0][0];

    it('stores the method and posts the receipt to the account linked to it', async () => {
      db.paymentMethod.findFirst.mockResolvedValue({ account_id: 'acc-bkash', type: 'Mobile Wallet' });

      await service.recordCreditPayment('tenant-1', 'c1', 'user-1', { amount: 250, paymentMethod: 'bKash' });

      expect(db.paymentMethod.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenant_id: 'tenant-1', name: 'bKash', is_active: true } }),
      );
      expect(db.customerCreditTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ payment_method: 'bKash', account_id: 'acc-bkash' }),
        }),
      );
      // Money coming in: Dr <bKash> / Cr Accounts Receivable.
      expect(postedWith()).toEqual(expect.objectContaining({ overrideDebitAccountId: 'acc-bkash' }));
      expect(postedWith().overrideCreditAccountId).toBeUndefined();
    });

    it('puts the chosen account on the credit leg when paying the customer out', async () => {
      db.account.findFirst.mockResolvedValue({ id: 'acc-bank' });

      await service.recordCreditPayment('tenant-1', 'c1', 'user-1', {
        amount: 100,
        direction: CustomerPaymentDirectionDto.PAY,
        paymentMethod: 'Bank',
        accountId: 'acc-bank',
      });

      expect(db.account.findFirst).toHaveBeenCalledWith({
        where: { id: 'acc-bank', tenant_id: 'tenant-1' },
        select: { id: true },
      });
      // Money going out: Dr Accounts Receivable / Cr <bank>.
      expect(postedWith()).toEqual(expect.objectContaining({ overrideCreditAccountId: 'acc-bank' }));
      expect(postedWith().overrideDebitAccountId).toBeUndefined();
    });

    it('falls back to the account the sale rules use for that mode when the method has none', async () => {
      db.paymentMethod.findFirst.mockResolvedValue({ account_id: null, type: 'Mobile Wallet' });
      db.postingRule.findFirst.mockResolvedValue({ debit_account_id: 'acc-bkash-ledger' });

      await service.recordCreditPayment('tenant-1', 'c1', 'user-1', { amount: 250, paymentMethod: 'bKash' });

      expect(db.postingRule.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ event_type: 'sale', condition_key: 'payment_mode', condition_value: 'bkash' }),
        }),
      );
      expect(postedWith()).toEqual(expect.objectContaining({ overrideDebitAccountId: 'acc-bkash-ledger' }));
    });

    it('keeps the rule default for cash', async () => {
      await service.recordCreditPayment('tenant-1', 'c1', 'user-1', { amount: 250, paymentMethod: 'Cash' });

      expect(db.customerCreditTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ payment_method: 'Cash', account_id: null }) }),
      );
      expect(db.postingRule.findFirst).not.toHaveBeenCalled();
      expect(postedWith().overrideDebitAccountId).toBeUndefined();
      expect(postedWith().overrideCreditAccountId).toBeUndefined();
    });

    it('posts exactly as before when no method is given', async () => {
      await service.recordCreditPayment('tenant-1', 'c1', 'user-1', { amount: 250 });

      expect(db.paymentMethod.findFirst).not.toHaveBeenCalled();
      expect(db.customerCreditTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ payment_method: null, account_id: null }) }),
      );
      expect(postedWith().overrideDebitAccountId).toBeUndefined();
      expect(postedWith().overrideCreditAccountId).toBeUndefined();
    });

    it('refuses an account that is not the tenant\'s', async () => {
      db.account.findFirst.mockResolvedValue(null);

      await expect(
        service.recordCreditPayment('tenant-1', 'c1', 'user-1', { amount: 250, accountId: 'foreign' }),
      ).rejects.toThrow(BadRequestException);
      expect(db.customerCreditTransaction.create).not.toHaveBeenCalled();
    });
  });

  describe('updateCreditPayment() — how the money moved', () => {
    const { autoPostFromRules } = require('../accounting/posting.utils');
    const recorded = {
      id: 'pay-1',
      tenant_id: 'tenant-1',
      customer_id: 'c1',
      type: 'PAYMENT',
      amount: 200,
      payment_number: 'CPY-00001',
      notes: null,
      payment_method: 'bKash',
      account_id: 'acc-bkash',
      customer: { id: 'c1', name: 'Alice', due_balance: 800 },
    };

    beforeEach(() => {
      (autoPostFromRules as jest.Mock).mockClear();
      db.account = { findFirst: jest.fn() };
      db.paymentMethod = { findFirst: jest.fn().mockResolvedValue(null) };
      db.postingRule = { findFirst: jest.fn().mockResolvedValue(null) };
      db.customerCreditTransaction.findFirst.mockResolvedValue(recorded);
      db.customer.findFirst.mockResolvedValue({ id: 'c1', name: 'Alice', due_balance: 800 });
      db.customerCreditTransaction.update.mockResolvedValue(recorded);
      db.$transaction.mockImplementation(async (cb: any) => cb(db));
    });

    it('keeps the recorded method when the edit does not mention one', async () => {
      await service.updateCreditPayment('tenant-1', 'pay-1', { amount: 300 });

      expect(db.paymentMethod.findFirst).not.toHaveBeenCalled();
      expect(db.customerCreditTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ payment_method: 'bKash', account_id: 'acc-bkash' }) }),
      );
      expect((autoPostFromRules as jest.Mock).mock.calls[0][0]).toEqual(
        expect.objectContaining({ overrideDebitAccountId: 'acc-bkash' }),
      );
    });

    it('re-posts to cash when the method is changed to cash', async () => {
      await service.updateCreditPayment('tenant-1', 'pay-1', { paymentMethod: 'Cash' });

      expect(db.customerCreditTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ payment_method: 'Cash', account_id: null }) }),
      );
      expect((autoPostFromRules as jest.Mock).mock.calls[0][0].overrideDebitAccountId).toBeUndefined();
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

    // Regression: Customer.phone used to be NOT NULL while the import wizard
    // advertised Phone as optional, so every phone-less row died on a raw
    // "Argument `phone` is missing" Prisma dump and nothing imported.
    it('imports a row with no phone', async () => {
      db.customer.findUnique.mockResolvedValue(null);
      db.customer.findFirst.mockResolvedValue(null);
      db.customerGroup.findFirst.mockResolvedValue(null);
      db.customer.create.mockResolvedValue({});

      const result = await service.importRows(
        tenantId,
        [{ name: 'Corner Shop', owner_name: 'Rahim Mia' }],
        'skip',
      );

      expect(result).toEqual({ created: 1, updated: 0, skipped: 0, errors: [] });
      expect(db.customer.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'Corner Shop',
            owner_name: 'Rahim Mia',
            phone: null,
          }),
        }),
      );
    });

    it('imports the remaining rows when one row fails', async () => {
      db.customer.findUnique.mockResolvedValue(null);
      db.customer.findFirst.mockResolvedValue(null);
      db.customerGroup.findFirst.mockResolvedValue(null);
      db.customer.create
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(Object.assign(new Error('boom'), { code: 'P2002', meta: { target: ['tenant_id', 'phone'] } }))
        .mockResolvedValueOnce({});

      const result = await service.importRows(
        tenantId,
        [
          { name: 'Alice', phone: '01711000001' },
          { name: 'Bob', phone: '01711000002' },
          { name: 'Carol', phone: '01711000003' },
        ],
        'skip',
      );

      expect(result.created).toBe(2);
      expect(result.errors).toEqual(['Row 3: duplicate value for tenant_id, phone']);
    });

    it('uses the customer code from the file and matches duplicates on it', async () => {
      db.customer.findUnique.mockResolvedValue(null);
      db.customerGroup.findFirst.mockResolvedValue(null);
      db.customer.create.mockResolvedValue({});

      const result = await service.importRows(
        tenantId,
        [{ customer_code: 'SHOP-42', name: 'Corner Shop' }],
        'skip',
      );

      expect(result.created).toBe(1);
      expect(db.customer.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenant_id_customer_code: { tenant_id: tenantId, customer_code: 'SHOP-42' } },
        }),
      );
      expect(db.customer.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ customer_code: 'SHOP-42' }),
        }),
      );
      // An explicit code must not consume a number from the CUST- series.
      expect(db.customer.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('customer code allocation', () => {
    const tenantId = 'tenant-1';

    it('ignores hand-entered codes when generating the next CUST- number', async () => {
      db.customer.findUnique.mockResolvedValue(null);
      db.customer.findFirst.mockResolvedValue({ customer_code: 'CUST-00007' });
      db.customer.create.mockResolvedValue({ nid: null });

      await service.create(tenantId, { name: 'Alice', phone: '01711000001' } as any);

      expect(db.customer.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenant_id: tenantId, customer_code: { startsWith: 'CUST-' } },
        }),
      );
      expect(db.customer.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ customer_code: 'CUST-00008' }),
        }),
      );
    });

    it('rejects a customer code that is already taken', async () => {
      db.customer.findUnique.mockImplementation(({ where }: any) =>
        Promise.resolve(where.tenant_id_customer_code ? { id: 'cust-9' } : null),
      );

      await expect(
        service.create(tenantId, { name: 'Alice', customer_code: 'SHOP-42' } as any),
      ).rejects.toThrow(BadRequestException);
      expect(db.customer.create).not.toHaveBeenCalled();
    });

    it('retries generation when a concurrent create takes the code', async () => {
      db.customer.findUnique.mockResolvedValue(null);
      db.customer.findFirst
        .mockResolvedValueOnce({ customer_code: 'CUST-00007' })
        .mockResolvedValueOnce({ customer_code: 'CUST-00008' });
      db.customer.create
        .mockRejectedValueOnce(Object.assign(new Error('conflict'), { code: 'P2002', meta: { target: ['tenant_id', 'customer_code'] } }))
        .mockResolvedValueOnce({ nid: null });

      await service.create(tenantId, { name: 'Alice', phone: '01711000001' } as any);

      expect(db.customer.create).toHaveBeenCalledTimes(2);
      expect(db.customer.create).toHaveBeenLastCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ customer_code: 'CUST-00009' }),
        }),
      );
    });

    it('does not check for a duplicate phone when no phone is given', async () => {
      db.customer.findUnique.mockResolvedValue(null);
      db.customer.findFirst.mockResolvedValue(null);
      db.customer.create.mockResolvedValue({ nid: null });

      await service.create(tenantId, { name: 'Corner Shop', owner_name: 'Rahim Mia' } as any);

      expect(db.customer.findUnique).not.toHaveBeenCalled();
      expect(db.customer.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ name: 'Corner Shop', owner_name: 'Rahim Mia' }),
        }),
      );
    });
  });

  describe('writeOffDebt()', () => {
    const { autoPostFromRules } = jest.requireMock('../accounting/posting.utils');

    const owing = (due: number, extra: Record<string, unknown> = {}) => ({
      id: 'c1',
      name: 'Alice Corp',
      due_balance: due,
      credit_enabled: true,
      ...extra,
    });

    beforeEach(() => {
      db.$transaction.mockImplementation(async (cb: any) => cb(db));
      db.customerCreditTransaction.findFirst.mockResolvedValue(null);
      db.customerCreditTransaction.create.mockResolvedValue({
        id: 'wo-1',
        payment_number: 'CWO-00001',
        type: 'WRITE_OFF',
        amount: 3000,
      });
      autoPostFromRules.mockResolvedValue({ postingStatus: 'skipped' });
    });

    const dto = {
      amount: 3000,
      reason: 'UNTRACEABLE' as any,
      notes: 'Shop closed, phone dead since March.',
    };

    it('settles the due on the ledger and posts the expense in one transaction', async () => {
      db.customer.findFirst.mockResolvedValue(owing(10_000));

      const result = await service.writeOffDebt('tenant-1', 'c1', 'user-1', dto);

      expect(db.customerCreditTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'WRITE_OFF',
            amount: 3000,
            balance_after: 7000,
            payment_number: 'CWO-00001',
            reference_type: 'BAD_DEBT',
            reference_id: 'UNTRACEABLE',
            notes: 'Shop closed, phone dead since March.',
          }),
        }),
      );
      expect(autoPostFromRules).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'bad_debt_write_off',
          conditionKey: 'none',
          sourceModule: 'customers',
          sourceId: 'wo-1',
          amount: 3000,
          partyType: 'CUSTOMER',
          partyId: 'c1',
        }),
      );
      expect(result.payment_number).toBe('CWO-00001');
    });

    it('uses its own CWO- series rather than the payment one', async () => {
      db.customer.findFirst.mockResolvedValue(owing(5000));

      await service.writeOffDebt('tenant-1', 'c1', 'user-1', dto);

      expect(db.customerCreditTransaction.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            type: 'WRITE_OFF',
            payment_number: { startsWith: 'CWO-' },
          }),
        }),
      );
    });

    // Writing a debt off drops due_balance, and assertCustomerCreditForSale
    // gates credit sales on that figure — so without this the customer gets
    // their whole limit back the moment they fail to pay.
    it('stops the customer buying on credit by default', async () => {
      db.customer.findFirst.mockResolvedValue(owing(3000));

      await service.writeOffDebt('tenant-1', 'c1', 'user-1', dto);

      expect(db.customer.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { due_balance: 0, credit_enabled: false },
      });
    });

    it('leaves credit alone when the caller opts out', async () => {
      db.customer.findFirst.mockResolvedValue(owing(3000));

      await service.writeOffDebt('tenant-1', 'c1', 'user-1', { ...dto, disableCredit: false });

      expect(db.customer.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { due_balance: 0 },
      });
    });

    it('writes off part of a debt, leaving the rest owing', async () => {
      db.customer.findFirst.mockResolvedValue(owing(10_000));

      await service.writeOffDebt('tenant-1', 'c1', 'user-1', { ...dto, amount: 2500 });

      expect(db.customerCreditTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ amount: 2500, balance_after: 7500 }),
        }),
      );
    });

    // Would conjure a credit balance out of nothing and overstate the expense.
    it('refuses to write off more than is owed', async () => {
      db.customer.findFirst.mockResolvedValue(owing(1000));

      await expect(
        service.writeOffDebt('tenant-1', 'c1', 'user-1', { ...dto, amount: 5000 }),
      ).rejects.toThrow(BadRequestException);
      expect(db.customerCreditTransaction.create).not.toHaveBeenCalled();
    });

    it('refuses when the customer owes nothing at all', async () => {
      db.customer.findFirst.mockResolvedValue(owing(0));

      await expect(service.writeOffDebt('tenant-1', 'c1', 'user-1', dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects a non-positive amount', async () => {
      db.customer.findFirst.mockResolvedValue(owing(5000));

      await expect(
        service.writeOffDebt('tenant-1', 'c1', 'user-1', { ...dto, amount: 0 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('404s on a customer that is not this tenant\'s', async () => {
      db.customer.findFirst.mockResolvedValue(null);

      await expect(service.writeOffDebt('tenant-1', 'nope', 'user-1', dto)).rejects.toThrow(
        NotFoundException,
      );
    });

    // Backdating lets a write-off land in the period it belongs to; the
    // fiscal-period lock inside autoPostFromRules is what refuses a closed one.
    it('posts on the given date and stamps the row with it', async () => {
      db.customer.findFirst.mockResolvedValue(owing(5000));

      await service.writeOffDebt('tenant-1', 'c1', 'user-1', { ...dto, date: '2026-06-30' });

      const posted = autoPostFromRules.mock.calls.at(-1)[0];
      expect(posted.date).toEqual(new Date('2026-06-30'));
      expect(db.customerCreditTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ created_at: new Date('2026-06-30') }),
        }),
      );
    });
  });

  describe('reverseWriteOff()', () => {
    const { voidAutoPostedVoucher } = jest.requireMock('../accounting/posting.utils');

    beforeEach(() => {
      db.$transaction.mockImplementation(async (cb: any) => cb(db));
      voidAutoPostedVoucher.mockResolvedValue(undefined);
    });

    it('deletes the voucher, drops the row and puts the debt back', async () => {
      db.customerCreditTransaction.findFirst.mockResolvedValue({
        id: 'wo-1',
        customer_id: 'c1',
        amount: 3000,
      });
      db.customer.findFirst.mockResolvedValue({ id: 'c1', name: 'Alice Corp', due_balance: 7000 });

      const result = await service.reverseWriteOff('tenant-1', 'wo-1');

      expect(voidAutoPostedVoucher).toHaveBeenCalledWith(
        db,
        'tenant-1',
        'bad_debt_write_off',
        'wo-1',
      );
      expect(db.customerCreditTransaction.delete).toHaveBeenCalledWith({ where: { id: 'wo-1' } });
      expect(db.customer.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { due_balance: 10_000 },
      });
      expect(result).toEqual({ reversed: true, id: 'wo-1', due_balance: 10_000 });
    });

    // Re-enabling credit stays a deliberate act on the customer's record: the
    // write-off may have turned it off, or an owner may have done so
    // independently, and this row cannot tell the two apart.
    it('does not hand the customer their credit back', async () => {
      db.customerCreditTransaction.findFirst.mockResolvedValue({
        id: 'wo-1',
        customer_id: 'c1',
        amount: 500,
      });
      db.customer.findFirst.mockResolvedValue({ id: 'c1', name: 'Alice Corp', due_balance: 0 });

      await service.reverseWriteOff('tenant-1', 'wo-1');

      expect(db.customer.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { due_balance: 500 },
      });
    });

    it('only ever finds WRITE_OFF rows, so a payment id cannot be reversed here', async () => {
      db.customerCreditTransaction.findFirst.mockResolvedValue(null);

      await expect(service.reverseWriteOff('tenant-1', 'pay-1')).rejects.toThrow(NotFoundException);
      expect(db.customerCreditTransaction.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ type: 'WRITE_OFF' }),
        }),
      );
    });
  });

  describe('getDueAgingReport', () => {
    const DAY_MS = 24 * 60 * 60 * 1000;
    const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS);
    const alice = { id: 'cust-1', name: 'Alice Corp', phone: '01700000001' };

    const row = (type: string, amount: number, days: number, customer = alice) => ({
      customer_id: customer.id,
      type,
      amount,
      created_at: daysAgo(days),
      customer,
    });

    // The bug: the report read CREDIT_SALE rows and nothing else, so a customer
    // who had paid every taka still showed the whole year's credit sales as due.
    it('drops a customer who has paid every credit sale off the report', async () => {
      db.customerCreditTransaction.findMany.mockResolvedValue([
        row('CREDIT_SALE', 40000, 300),
        row('CREDIT_SALE', 60000, 120),
        row('PAYMENT', 100000, 30),
      ]);

      await expect(service.getDueAgingReport('tenant-1')).resolves.toEqual([]);
    });

    it('reads every transaction type, not just credit sales', async () => {
      db.customerCreditTransaction.findMany.mockResolvedValue([]);

      await service.getDueAgingReport('tenant-1');

      const where = db.customerCreditTransaction.findMany.mock.calls[0][0].where;
      expect(where).toEqual({ tenant_id: 'tenant-1' });
      expect(where.type).toBeUndefined();
    });

    it('ages what is left after a part-payment, in the old charge\'s bucket', async () => {
      db.customerCreditTransaction.findMany.mockResolvedValue([
        row('CREDIT_SALE', 10000, 120),
        row('PAYMENT', 4000, 10),
      ]);

      const [result] = await service.getDueAgingReport('tenant-1');

      expect(result.total).toBe(6000);
      expect(result.bucket_90_plus).toBe(6000);
      expect(result.bucket_0_30).toBe(0);
    });

    it('applies a payment to the oldest sale first', async () => {
      db.customerCreditTransaction.findMany.mockResolvedValue([
        row('CREDIT_SALE', 5000, 200),
        row('CREDIT_SALE', 3000, 5),
        row('PAYMENT', 5000, 1),
      ]);

      const [result] = await service.getDueAgingReport('tenant-1');

      expect(result.bucket_90_plus).toBe(0);
      expect(result.bucket_0_30).toBe(3000);
      expect(result.total).toBe(3000);
    });

    it('counts a PAYOUT as a new charge, aged from the day it was paid out', async () => {
      db.customerCreditTransaction.findMany.mockResolvedValue([
        row('PAYOUT', 2500, 45),
      ]);

      const [result] = await service.getDueAgingReport('tenant-1');

      expect(result.bucket_31_60).toBe(2500);
      expect(result.total).toBe(2500);
    });

    it('lets a sales-return ADJUSTMENT reduce the due it was raised against', async () => {
      // sales-returns.service writes a NEGATIVE amount on an ADJUSTMENT row.
      db.customerCreditTransaction.findMany.mockResolvedValue([
        row('CREDIT_SALE', 7000, 100),
        row('ADJUSTMENT', -2000, 20),
      ]);

      const [result] = await service.getDueAgingReport('tenant-1');

      expect(result.total).toBe(5000);
      expect(result.bucket_90_plus).toBe(5000);
    });

    it('keeps each customer on its own FIFO queue', async () => {
      const bob = { id: 'cust-2', name: 'Bob Traders', phone: '01700000002' };
      db.customerCreditTransaction.findMany.mockResolvedValue([
        row('CREDIT_SALE', 1000, 200),
        row('PAYMENT', 1000, 5),
        row('CREDIT_SALE', 4000, 200, bob),
      ]);

      const results = await service.getDueAgingReport('tenant-1');

      // Alice is square; Bob's payment is not hers to spend.
      expect(results).toHaveLength(1);
      expect(results[0].customer.id).toBe('cust-2');
      expect(results[0].total).toBe(4000);
    });

    it('omits a customer who is in credit rather than showing a negative due', async () => {
      db.customerCreditTransaction.findMany.mockResolvedValue([
        row('CREDIT_SALE', 1000, 60),
        row('PAYMENT', 2500, 5),
      ]);

      await expect(service.getDueAgingReport('tenant-1')).resolves.toEqual([]);
    });

    it('keeps the four buckets summing to the total it reports', async () => {
      db.customerCreditTransaction.findMany.mockResolvedValue([
        row('CREDIT_SALE', 12000, 365),
        row('PAYMENT', 4000, 300),
        row('CREDIT_SALE', 7000, 200),
        row('CREDIT_SALE', 5500, 80),
        row('PAYMENT', 9000, 70),
        row('CREDIT_SALE', 2500, 20),
      ]);

      const [result] = await service.getDueAgingReport('tenant-1');

      const summed = result.bucket_0_30 + result.bucket_31_60 + result.bucket_61_90 + result.bucket_90_plus;
      expect(Math.round(summed * 100) / 100).toBe(result.total);
      expect(result.total).toBe(14000);
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
