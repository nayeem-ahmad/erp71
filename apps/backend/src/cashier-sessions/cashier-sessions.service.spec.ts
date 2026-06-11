import { Test, TestingModule } from '@nestjs/testing';
import { CashierSessionsService } from './cashier-sessions.service';
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
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        count: jest.fn(),
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
});
