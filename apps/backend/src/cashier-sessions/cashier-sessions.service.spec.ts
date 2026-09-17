jest.mock('../accounting/posting.utils', () => ({
  autoPostFromRules: jest.fn().mockResolvedValue({ postingStatus: 'posted', voucherId: 'v-1' }),
}));

import { Test, TestingModule } from '@nestjs/testing';
import { CashierSessionsService } from './cashier-sessions.service';
import { autoPostFromRules } from '../accounting/posting.utils';
import { DatabaseService } from '../database/database.service';
import { CountersService } from '../counters/counters.service';
import { BadRequestException } from '@nestjs/common';

describe('CashierSessionsService', () => {
  let service: CashierSessionsService;
  let db: any;
  let countersService: { validateCounterBelongsToStore: jest.Mock };

  beforeEach(async () => {
    db = {
      cashierSession: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        count: jest.fn(),
      },
      cashTransaction: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        count: jest.fn(),
      },
      store: {
        // The store is validated before a session is filed against it, so the
        // default is "this store exists in this tenant" and the tests that
        // care about the refusal override it.
        findFirst: jest.fn().mockResolvedValue({ id: 'store-1' }),
      },
      sale: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      salesReturn: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn().mockImplementation(async (cb: any) => cb(db)),
    };

    countersService = {
      validateCounterBelongsToStore: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CashierSessionsService,
        { provide: DatabaseService, useValue: db },
        { provide: CountersService, useValue: countersService },
      ],
    }).compile();

    service = module.get<CashierSessionsService>(CashierSessionsService);
    jest.clearAllMocks();
  });

  // ── openSession ──────────────────────────────────────────────────────────

  describe('openSession', () => {
    const openDto = { storeId: 'store-1', openingCash: 500 };

    it('creates a new session when no open session exists', async () => {
      db.cashierSession.findFirst.mockResolvedValue(null);
      db.cashierSession.create.mockResolvedValue({
        id: 'sess-1',
        tenant_id: 't1',
        user_id: 'u1',
        store_id: 'store-1',
        status: 'OPEN',
        opening_cash: 500,
        counter: null,
      });

      const result = await service.openSession('t1', 'u1', openDto);

      expect(result.id).toBe('sess-1');
      expect(db.cashierSession.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenant_id: 't1',
            user_id: 'u1',
            store_id: 'store-1',
            opening_cash: 500,
            status: 'OPEN',
          }),
        }),
      );
    });

    it('throws BadRequestException when user already has an open session', async () => {
      db.cashierSession.findFirst.mockResolvedValue({
        id: 'sess-existing',
        status: 'OPEN',
        user_id: 'u1',
      });

      await expect(service.openSession('t1', 'u1', openDto)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.openSession('t1', 'u1', openDto)).rejects.toThrow(
        'User already has an open cashier session',
      );
    });

    it('validates counter when counterId is provided', async () => {
      const dtoWithCounter = { ...openDto, counterId: 'counter-1' };
      db.cashierSession.findFirst
        .mockResolvedValueOnce(null) // no existing open session
        .mockResolvedValueOnce(null); // counter not in use
      countersService.validateCounterBelongsToStore.mockResolvedValue(undefined);
      db.cashierSession.create.mockResolvedValue({
        id: 'sess-2',
        tenant_id: 't1',
        user_id: 'u1',
        store_id: 'store-1',
        counter_id: 'counter-1',
        status: 'OPEN',
        counter: { id: 'counter-1' },
      });

      const result = await service.openSession('t1', 'u1', dtoWithCounter);

      expect(countersService.validateCounterBelongsToStore).toHaveBeenCalledWith(
        't1',
        'counter-1',
        'store-1',
      );
      expect(result.id).toBe('sess-2');
    });

    it('throws BadRequestException when counter already has an open session', async () => {
      const dtoWithCounter = { ...openDto, counterId: 'counter-1' };
      db.cashierSession.findFirst
        .mockResolvedValueOnce(null) // no existing open session for user
        .mockResolvedValueOnce({ id: 'other-sess', status: 'OPEN' }); // counter in use
      countersService.validateCounterBelongsToStore.mockResolvedValue(undefined);

      const result = service.openSession('t1', 'u1', dtoWithCounter);
      await expect(result).rejects.toThrow(BadRequestException);
      await expect(result).rejects.toThrow('This counter already has an open session');
    });

    it('skips counter validation when counterId is not provided', async () => {
      db.cashierSession.findFirst.mockResolvedValue(null);
      db.cashierSession.create.mockResolvedValue({
        id: 'sess-3',
        tenant_id: 't1',
        user_id: 'u1',
        status: 'OPEN',
        counter: null,
      });

      await service.openSession('t1', 'u1', openDto);

      expect(countersService.validateCounterBelongsToStore).not.toHaveBeenCalled();
    });

    it('sets counter_id to null when not provided', async () => {
      db.cashierSession.findFirst.mockResolvedValue(null);
      db.cashierSession.create.mockResolvedValue({ id: 'sess-4', counter: null });

      await service.openSession('t1', 'u1', openDto);

      expect(db.cashierSession.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ counter_id: null }),
        }),
      );
    });
  });

  // ── closeSession ─────────────────────────────────────────────────────────

  describe('closeSession', () => {
    const closeDto = { closingCash: 600 };

    it('closes an open session successfully', async () => {
      db.cashierSession.findUnique.mockResolvedValue({
        id: 'sess-1',
        tenant_id: 't1',
        status: 'OPEN',
      });
      db.cashierSession.update.mockResolvedValue({
        id: 'sess-1',
        status: 'CLOSED',
        closing_cash: 600,
        closed_at: new Date(),
      });

      const result = await service.closeSession('t1', 'sess-1', closeDto);

      expect(result.status).toBe('CLOSED');
      expect(db.cashierSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sess-1' },
          data: expect.objectContaining({
            closing_cash: 600,
            status: 'CLOSED',
          }),
        }),
      );
    });

    it('throws BadRequestException when session is not found', async () => {
      db.cashierSession.findUnique.mockResolvedValue(null);

      await expect(service.closeSession('t1', 'sess-999', closeDto)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.closeSession('t1', 'sess-999', closeDto)).rejects.toThrow(
        'Session not found',
      );
    });

    it('throws BadRequestException when session belongs to a different tenant', async () => {
      db.cashierSession.findUnique.mockResolvedValue({
        id: 'sess-1',
        tenant_id: 'other-tenant',
        status: 'OPEN',
      });

      await expect(service.closeSession('t1', 'sess-1', closeDto)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.closeSession('t1', 'sess-1', closeDto)).rejects.toThrow(
        'Session does not belong to this tenant',
      );
    });

    it('throws BadRequestException when session is already closed', async () => {
      db.cashierSession.findUnique.mockResolvedValue({
        id: 'sess-1',
        tenant_id: 't1',
        status: 'CLOSED',
      });

      await expect(service.closeSession('t1', 'sess-1', closeDto)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.closeSession('t1', 'sess-1', closeDto)).rejects.toThrow(
        'Session is already closed',
      );
    });
  });

  // ── getOpenSessionByUser ──────────────────────────────────────────────────

  describe('getOpenSessionByUser', () => {
    it('returns the open session for a user', async () => {
      const session = { id: 'sess-1', user_id: 'u1', status: 'OPEN', counter: null };
      db.cashierSession.findFirst.mockResolvedValue(session);

      const result = await service.getOpenSessionByUser('t1', 'u1');

      expect(result).toEqual(session);
      expect(db.cashierSession.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenant_id: 't1', user_id: 'u1', status: 'OPEN' },
          include: { counter: true },
        }),
      );
    });

    it('returns null when user has no open session', async () => {
      db.cashierSession.findFirst.mockResolvedValue(null);

      const result = await service.getOpenSessionByUser('t1', 'u1');

      expect(result).toBeNull();
    });
  });

  // ── getSessionsByStore ────────────────────────────────────────────────────

  describe('getSessionsByStore', () => {
    it('returns all sessions for a store ordered by opened_at desc', async () => {
      const sessions = [
        { id: 'sess-2', store_id: 'store-1', opened_at: new Date('2026-06-11') },
        { id: 'sess-1', store_id: 'store-1', opened_at: new Date('2026-06-10') },
      ];
      db.cashierSession.findMany.mockResolvedValue(sessions);

      const result = await service.getSessionsByStore('t1', 'store-1');

      expect(result).toHaveLength(2);
      expect(db.cashierSession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenant_id: 't1', store_id: 'store-1' },
          orderBy: { opened_at: 'desc' },
        }),
      );
    });

    it('returns empty array when no sessions exist for a store', async () => {
      db.cashierSession.findMany.mockResolvedValue([]);

      const result = await service.getSessionsByStore('t1', 'store-empty');

      expect(result).toEqual([]);
    });
  });

  // ── getSessionById ────────────────────────────────────────────────────────

  describe('getSessionById', () => {
    it('returns the session when found and belongs to tenant', async () => {
      const session = { id: 'sess-1', tenant_id: 't1', status: 'OPEN', counter: null };
      db.cashierSession.findUnique.mockResolvedValue(session);

      const result = await service.getSessionById('t1', 'sess-1');

      expect(result).toEqual(session);
      expect(db.cashierSession.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sess-1' },
          include: { counter: true },
        }),
      );
    });

    it('throws BadRequestException when session is not found', async () => {
      db.cashierSession.findUnique.mockResolvedValue(null);

      await expect(service.getSessionById('t1', 'sess-999')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.getSessionById('t1', 'sess-999')).rejects.toThrow(
        'Session not found',
      );
    });

    it('throws BadRequestException when session belongs to a different tenant', async () => {
      db.cashierSession.findUnique.mockResolvedValue({
        id: 'sess-1',
        tenant_id: 'other-tenant',
        status: 'OPEN',
        counter: null,
      });

      await expect(service.getSessionById('t1', 'sess-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ── addCashTransaction ────────────────────────────────────────────────────

  describe('addCashTransaction', () => {
    it('creates a cash transaction for an open session', async () => {
      db.cashierSession.findUnique.mockResolvedValue({
        id: 'sess-1',
        tenant_id: 't1',
        status: 'OPEN',
      });
      db.cashTransaction.create.mockResolvedValue({
        id: 'tx-1',
        session_id: 'sess-1',
        amount: 200,
        type: 'CASH_IN',
        description: 'float top-up',
      });

      const result = await service.addCashTransaction('t1', 'sess-1', 200, 'CASH_IN', 'float top-up');

      expect(result.id).toBe('tx-1');
      expect(db.cashTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenant_id: 't1',
            session_id: 'sess-1',
            amount: 200,
            type: 'CASH_IN',
            description: 'float top-up',
          }),
        }),
      );
    });

    it('creates a cash transaction without description', async () => {
      db.cashierSession.findUnique.mockResolvedValue({
        id: 'sess-1',
        tenant_id: 't1',
        status: 'OPEN',
      });
      db.cashTransaction.create.mockResolvedValue({
        id: 'tx-2',
        session_id: 'sess-1',
        amount: 100,
        type: 'CASH_OUT',
        description: undefined,
      });

      const result = await service.addCashTransaction('t1', 'sess-1', 100, 'CASH_OUT');

      expect(result.id).toBe('tx-2');
    });

    it('throws BadRequestException when session is not found', async () => {
      db.cashierSession.findUnique.mockResolvedValue(null);

      await expect(
        service.addCashTransaction('t1', 'sess-999', 100, 'CASH_IN'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.addCashTransaction('t1', 'sess-999', 100, 'CASH_IN'),
      ).rejects.toThrow('Session not found');
    });

    it('throws BadRequestException when session belongs to a different tenant', async () => {
      db.cashierSession.findUnique.mockResolvedValue({
        id: 'sess-1',
        tenant_id: 'other-tenant',
        status: 'OPEN',
      });

      await expect(
        service.addCashTransaction('t1', 'sess-1', 100, 'CASH_IN'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.addCashTransaction('t1', 'sess-1', 100, 'CASH_IN'),
      ).rejects.toThrow('Session does not belong to this tenant');
    });

    it('throws BadRequestException when session is closed', async () => {
      db.cashierSession.findUnique.mockResolvedValue({
        id: 'sess-1',
        tenant_id: 't1',
        status: 'CLOSED',
      });

      await expect(
        service.addCashTransaction('t1', 'sess-1', 100, 'CASH_IN'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.addCashTransaction('t1', 'sess-1', 100, 'CASH_IN'),
      ).rejects.toThrow('Cannot add transaction to closed session');
    });

    describe('posting', () => {
      const openSession = { id: 'sess-1', tenant_id: 't1', status: 'OPEN', store_id: 'store-1' };

      beforeEach(() => {
        (autoPostFromRules as jest.Mock).mockClear();
        (autoPostFromRules as jest.Mock).mockResolvedValue({ postingStatus: 'posted', voucherId: 'v-1' });
        db.cashierSession.findUnique.mockResolvedValue(openSession);
        db.cashTransaction.create.mockResolvedValue({ id: 'tx-1' });
      });

      it('posts a PAYOUT as General Operating Expense / Cash out of the till', async () => {
        // amount signed negative for cash out — the voucher takes its magnitude.
        await service.addCashTransaction('t1', 'sess-1', -300, 'PAYOUT', 'tea & snacks');

        expect(autoPostFromRules).toHaveBeenCalledWith(expect.objectContaining({
          eventType: 'cash_transaction',
          conditionKey: 'reason_type',
          conditionValue: 'PAYOUT',
          sourceModule: 'cashier-sessions',
          sourceType: 'cash_transaction',
          sourceId: 'tx-1',
          amount: 300,
          storeId: 'store-1',
        }));
      });

      it('posts a LOAN with the reason value that resolves to Staff Advances', async () => {
        await service.addCashTransaction('t1', 'sess-1', -500, 'LOAN');

        expect(autoPostFromRules).toHaveBeenCalledWith(expect.objectContaining({
          conditionValue: 'LOAN',
          amount: 500,
        }));
      });

      it('does NOT post a DROP — drawer to safe is Cash in Hand on both sides', async () => {
        await service.addCashTransaction('t1', 'sess-1', -1000, 'DROP');

        expect(autoPostFromRules).not.toHaveBeenCalled();
      });

      it('does NOT post an OTHER transaction', async () => {
        await service.addCashTransaction('t1', 'sess-1', 250, 'OTHER');

        expect(autoPostFromRules).not.toHaveBeenCalled();
      });
    });
  });

  // ── getCashTransactions ───────────────────────────────────────────────────

  describe('getCashTransactions', () => {
    it('returns all cash transactions for a session', async () => {
      db.cashierSession.findUnique.mockResolvedValue({
        id: 'sess-1',
        tenant_id: 't1',
        status: 'OPEN',
      });
      const transactions = [
        { id: 'tx-1', amount: 200, type: 'CASH_IN', created_at: new Date() },
        { id: 'tx-2', amount: 50, type: 'CASH_OUT', created_at: new Date() },
      ];
      db.cashTransaction.findMany.mockResolvedValue(transactions);

      const result = await service.getCashTransactions('t1', 'sess-1');

      expect(result).toHaveLength(2);
      expect(db.cashTransaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenant_id: 't1', session_id: 'sess-1' },
          orderBy: { created_at: 'asc' },
        }),
      );
    });

    it('returns empty array when session has no transactions', async () => {
      db.cashierSession.findUnique.mockResolvedValue({
        id: 'sess-1',
        tenant_id: 't1',
        status: 'OPEN',
      });
      db.cashTransaction.findMany.mockResolvedValue([]);

      const result = await service.getCashTransactions('t1', 'sess-1');

      expect(result).toEqual([]);
    });

    it('throws BadRequestException when session is not found', async () => {
      db.cashierSession.findUnique.mockResolvedValue(null);

      await expect(service.getCashTransactions('t1', 'sess-999')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.getCashTransactions('t1', 'sess-999')).rejects.toThrow(
        'Session not found',
      );
    });

    it('throws BadRequestException when session belongs to a different tenant', async () => {
      db.cashierSession.findUnique.mockResolvedValue({
        id: 'sess-1',
        tenant_id: 'other-tenant',
        status: 'OPEN',
      });

      await expect(service.getCashTransactions('t1', 'sess-1')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.getCashTransactions('t1', 'sess-1')).rejects.toThrow(
        'Session does not belong to this tenant',
      );
    });
  });
  // ── Reconciliation: what the drawer should hold ──────────────────────────

  describe('getSessionSummary', () => {
    const openSession = {
      id: 'sess-1',
      tenant_id: 't1',
      status: 'OPEN',
      opening_cash: 500,
      closing_cash: 0,
      variance: null,
    };

    it('counts cash takings towards expected cash and leaves other tenders out', async () => {
      db.cashierSession.findUnique.mockResolvedValue(openSession);
      db.sale.findMany.mockResolvedValue([
        {
          id: 's1',
          total_amount: 1000,
          payments: [
            { payment_method: 'CASH', amount: 400 },
            { payment_method: 'BKASH', amount: 600 },
          ],
        },
        {
          id: 's2',
          total_amount: 250,
          payments: [{ payment_method: 'CARD', amount: 250 }],
        },
      ]);

      const summary = await service.getSessionSummary('t1', 'sess-1');

      expect(summary.salesCount).toBe(2);
      expect(summary.salesTotal).toBe(1250);
      expect(summary.cashTakings).toBe(400);
      // 500 float + 400 cash. The 850 taken on bKash and card is real revenue
      // and is not in the drawer, so it must not be counted at the close.
      expect(summary.expectedCash).toBe(900);
      expect(summary.paymentBreakdown).toEqual([
        { method: 'BKASH', amount: 600 },
        { method: 'CASH', amount: 400 },
        { method: 'CARD', amount: 250 },
      ]);
    });

    it('reads a renamed tender the same way the ledger does', async () => {
      db.cashierSession.findUnique.mockResolvedValue(openSession);
      db.sale.findMany.mockResolvedValue([
        {
          id: 's1',
          total_amount: 700,
          payments: [
            // Tenant-named methods. Only the last one is money in the drawer,
            // and the split has to match what the posting rules booked.
            { payment_method: 'bKash Personal', amount: 200 },
            { payment_method: 'Debit Card', amount: 300 },
            { payment_method: 'Cash on Counter', amount: 200 },
          ],
        },
      ]);

      const summary = await service.getSessionSummary('t1', 'sess-1');

      expect(summary.cashTakings).toBe(200);
      expect(summary.expectedCash).toBe(700); // 500 float + 200 cash
    });

    it('takes refunds this shift paid out back off expected cash', async () => {
      db.cashierSession.findUnique.mockResolvedValue(openSession);
      db.sale.findMany.mockResolvedValue([
        { id: 's1', total_amount: 300, payments: [{ payment_method: 'CASH', amount: 300 }] },
      ]);
      db.salesReturn.findMany.mockResolvedValue([{ total_refund: 120 }]);

      const summary = await service.getSessionSummary('t1', 'sess-1');

      expect(summary.refunds).toBe(120);
      expect(summary.expectedCash).toBe(680); // 500 + 300 - 120
    });

    it('applies recorded cash movements in both directions', async () => {
      db.cashierSession.findUnique.mockResolvedValue(openSession);
      db.cashTransaction.findMany.mockResolvedValue([
        { amount: 200, type: 'LOAN' },
        { amount: -50, type: 'PAYOUT' },
      ]);

      const summary = await service.getSessionSummary('t1', 'sess-1');

      expect(summary.cashIn).toBe(200);
      expect(summary.cashOut).toBe(50);
      expect(summary.expectedCash).toBe(650); // 500 + 200 - 50
    });

    it('reports no variance while the shift is still open', async () => {
      db.cashierSession.findUnique.mockResolvedValue(openSession);

      const summary = await service.getSessionSummary('t1', 'sess-1');

      expect(summary.closingCash).toBeNull();
      expect(summary.variance).toBeNull();
    });

    it('refuses a session belonging to another tenant', async () => {
      db.cashierSession.findUnique.mockResolvedValue({ ...openSession, tenant_id: 'other' });

      await expect(service.getSessionSummary('t1', 'sess-1')).rejects.toThrow('Session not found');
    });
  });

  describe('closeSession reconciliation', () => {
    beforeEach(() => {
      db.cashierSession.findUnique.mockResolvedValue({
        id: 'sess-1',
        tenant_id: 't1',
        status: 'OPEN',
        opening_cash: 500,
        closing_cash: 0,
        variance: null,
      });
      db.cashierSession.update.mockResolvedValue({ id: 'sess-1', status: 'CLOSED' });
    });

    it('freezes expected cash and the variance onto the row', async () => {
      db.sale.findMany.mockResolvedValue([
        { id: 's1', total_amount: 300, payments: [{ payment_method: 'CASH', amount: 300 }] },
      ]);

      await service.closeSession('t1', 'sess-1', { closingCash: 790 });

      expect(db.cashierSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            expected_cash: 800, // 500 float + 300 cash taken
            variance: -10, // counted 790 — the till is ten short
          }),
        }),
      );
    });

    it('releases the till and the cashier for the next shift', async () => {
      await service.closeSession('t1', 'sess-1', { closingCash: 500 });

      expect(db.cashierSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            open_counter_key: null,
            open_user_key: null,
          }),
        }),
      );
    });
  });

  describe('getOpenSessionsByStore', () => {
    it('returns each open till with what it is holding', async () => {
      db.cashierSession.findMany.mockResolvedValue([
        { id: 'sess-1', tenant_id: 't1', status: 'OPEN', opening_cash: 500, closing_cash: 0, variance: null },
      ]);
      db.cashierSession.findUnique.mockResolvedValue({
        id: 'sess-1',
        tenant_id: 't1',
        status: 'OPEN',
        opening_cash: 500,
        closing_cash: 0,
        variance: null,
      });
      db.sale.findMany.mockResolvedValue([
        { id: 's1', total_amount: 100, payments: [{ payment_method: 'CASH', amount: 100 }] },
      ]);

      const rows = await service.getOpenSessionsByStore('t1', 'store-1');

      expect(rows).toHaveLength(1);
      expect(rows[0].summary.expectedCash).toBe(600);
      expect(db.cashierSession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenant_id: 't1', store_id: 'store-1', status: 'OPEN' }),
        }),
      );
    });
  });
  describe('openSession guards', () => {
    const openDto = { storeId: 'store-1', openingCash: 500 };

    beforeEach(() => {
      db.cashierSession.findFirst.mockResolvedValue(null);
      db.cashierSession.create.mockResolvedValue({ id: 'sess-1', counter: null });
    });

    it('refuses a store that does not belong to this tenant', async () => {
      db.store.findFirst.mockResolvedValue(null);

      await expect(service.openSession('t1', 'u1', openDto)).rejects.toThrow('Store not found');
      expect(db.cashierSession.create).not.toHaveBeenCalled();
    });

    it('claims the till and the cashier through the unique-index columns', async () => {
      await service.openSession('t1', 'u1', { ...openDto, counterId: 'c1' });

      expect(db.cashierSession.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ open_counter_key: 'c1', open_user_key: 'u1' }),
        }),
      );
    });

    it('leaves the counter claim null when no till was chosen, so others still open', async () => {
      await service.openSession('t1', 'u1', openDto);

      expect(db.cashierSession.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ open_counter_key: null, open_user_key: 'u1' }),
        }),
      );
    });

    it('turns the lost half of a same-second race into the same refusal as the check', async () => {
      // What the query engine raises when the other cashier's INSERT landed
      // first — shape, not class: see the comment on the catch.
      db.cashierSession.create.mockRejectedValue(
        Object.assign(new Error('Unique constraint failed'), {
          code: 'P2002',
          meta: { target: ['tenant_id', 'open_counter_key'] },
        }),
      );

      await expect(service.openSession('t1', 'u1', { ...openDto, counterId: 'c1' })).rejects.toThrow(
        'This counter already has an open session',
      );
    });

    it('names the person rather than the till when it is their own second session', async () => {
      db.cashierSession.create.mockRejectedValue(
        Object.assign(new Error('Unique constraint failed'), {
          code: 'P2002',
          meta: { target: ['tenant_id', 'open_user_key'] },
        }),
      );

      await expect(service.openSession('t1', 'u1', openDto)).rejects.toThrow(
        'User already has an open cashier session',
      );
    });
  });
});
