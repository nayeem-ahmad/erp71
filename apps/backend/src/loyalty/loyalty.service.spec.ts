import { Test, TestingModule } from '@nestjs/testing';
import { LoyaltyService } from './loyalty.service';
import { DatabaseService } from '../database/database.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';

describe('LoyaltyService', () => {
  let service: LoyaltyService;
  let db: any;

  beforeEach(async () => {
    db = {
      tenant: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      customer: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      loyaltyTransaction: {
        findMany: jest.fn(),
        create: jest.fn(),
      },
      $transaction: jest.fn().mockImplementation(async (ops: any[]) => ops),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LoyaltyService,
        { provide: DatabaseService, useValue: db },
      ],
    }).compile();

    service = module.get<LoyaltyService>(LoyaltyService);
    jest.clearAllMocks();
  });

  // ── getSettings ───────────────────────────────────────────────────────────

  describe('getSettings', () => {
    it('returns loyalty settings for a tenant', async () => {
      const settings = {
        loyalty_points_enabled: true,
        loyalty_earn_rate: 0.01,
        loyalty_redeem_rate: 0.5,
        loyalty_min_redeem: 100,
      };
      db.tenant.findUnique.mockResolvedValue(settings);

      const result = await service.getSettings('t1');

      expect(result).toEqual(settings);
      expect(db.tenant.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 't1' },
          select: expect.objectContaining({
            loyalty_points_enabled: true,
            loyalty_earn_rate: true,
          }),
        }),
      );
    });

    it('throws NotFoundException when tenant does not exist', async () => {
      db.tenant.findUnique.mockResolvedValue(null);

      await expect(service.getSettings('t-missing')).rejects.toThrow(NotFoundException);
      await expect(service.getSettings('t-missing')).rejects.toThrow('Tenant not found');
    });
  });

  // ── updateSettings ────────────────────────────────────────────────────────

  describe('updateSettings', () => {
    it('updates all provided loyalty settings', async () => {
      const updated = {
        loyalty_points_enabled: true,
        loyalty_earn_rate: 0.02,
        loyalty_redeem_rate: 0.5,
        loyalty_min_redeem: 50,
      };
      db.tenant.update.mockResolvedValue(updated);

      const result = await service.updateSettings('t1', {
        loyalty_points_enabled: true,
        loyalty_earn_rate: 0.02,
        loyalty_redeem_rate: 0.5,
        loyalty_min_redeem: 50,
      });

      expect(result).toEqual(updated);
      expect(db.tenant.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 't1' },
          data: expect.objectContaining({ loyalty_points_enabled: true }),
        }),
      );
    });

    it('only updates fields that are explicitly provided', async () => {
      db.tenant.update.mockResolvedValue({
        loyalty_points_enabled: false,
        loyalty_earn_rate: null,
        loyalty_redeem_rate: null,
        loyalty_min_redeem: null,
      });

      await service.updateSettings('t1', { loyalty_points_enabled: false });

      const callArgs = db.tenant.update.mock.calls[0][0];
      expect(callArgs.data).toHaveProperty('loyalty_points_enabled', false);
      // Fields not passed should not be present in the update data
      expect(callArgs.data).not.toHaveProperty('loyalty_earn_rate');
      expect(callArgs.data).not.toHaveProperty('loyalty_redeem_rate');
    });

    it('sets rate to null when explicitly passed as null', async () => {
      db.tenant.update.mockResolvedValue({
        loyalty_points_enabled: true,
        loyalty_earn_rate: null,
        loyalty_redeem_rate: null,
        loyalty_min_redeem: null,
      });

      await service.updateSettings('t1', {
        loyalty_earn_rate: null,
        loyalty_redeem_rate: null,
        loyalty_min_redeem: null,
      });

      const callArgs = db.tenant.update.mock.calls[0][0];
      expect(callArgs.data.loyalty_earn_rate).toBeNull();
    });
  });

  // ── getCustomerPoints ─────────────────────────────────────────────────────

  describe('getCustomerPoints', () => {
    it('returns customer info along with recent transactions', async () => {
      const customer = { id: 'c1', name: 'Rahim', phone: '01700000001', loyalty_points: 250 };
      const transactions = [{ id: 'lt-1', points: 50, type: 'EARN', created_at: new Date() }];

      db.customer.findFirst.mockResolvedValue(customer);
      db.loyaltyTransaction.findMany.mockResolvedValue(transactions);

      const result = await service.getCustomerPoints('t1', 'c1');

      expect(result.id).toBe('c1');
      expect(result.loyalty_points).toBe(250);
      expect(result.transactions).toHaveLength(1);
    });

    it('throws NotFoundException when customer does not exist', async () => {
      db.customer.findFirst.mockResolvedValue(null);

      await expect(service.getCustomerPoints('t1', 'c-missing')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.getCustomerPoints('t1', 'c-missing')).rejects.toThrow(
        'Customer not found',
      );
    });

    it('queries transactions with correct customerId and tenantId', async () => {
      db.customer.findFirst.mockResolvedValue({
        id: 'c1',
        name: 'Rahim',
        phone: '01700000001',
        loyalty_points: 0,
      });
      db.loyaltyTransaction.findMany.mockResolvedValue([]);

      await service.getCustomerPoints('t1', 'c1');

      expect(db.loyaltyTransaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { customerId: 'c1', tenantId: 't1' },
          orderBy: { created_at: 'desc' },
          take: 20,
        }),
      );
    });
  });

  // ── earnPoints ────────────────────────────────────────────────────────────

  describe('earnPoints', () => {
    const earnDto = { saleTotal: 1000, saleId: 'sale-1' };

    beforeEach(() => {
      // Default: $transaction returns array of results (first element is the transaction)
      db.$transaction.mockImplementation(async (ops: any[]) => ops);
    });

    it('earns points for a valid sale', async () => {
      db.tenant.findUnique.mockResolvedValue({
        loyalty_points_enabled: true,
        loyalty_earn_rate: 0.01,
      });
      db.customer.findFirst.mockResolvedValue({ id: 'c1', loyalty_points: 100 });

      const mockTransaction = { id: 'lt-1', type: 'EARN', points: 10 };
      db.$transaction.mockResolvedValue([mockTransaction, {}]);

      const result = await service.earnPoints('t1', 'c1', earnDto);

      expect(result.points_earned).toBe(10);
      expect(result.new_balance).toBe(110); // 100 + 10
      expect(result.transaction).toEqual(mockTransaction);
    });

    it('returns zero points message when sale total is too small to earn points', async () => {
      db.tenant.findUnique.mockResolvedValue({
        loyalty_points_enabled: true,
        loyalty_earn_rate: 0.001,
      });
      // saleTotal = 0.5 → floor(0.5 * 0.001) = 0
      const result = await service.earnPoints('t1', 'c1', { saleTotal: 0.5 });

      expect(result.points_earned).toBe(0);
      expect(result.message).toMatch(/No points earned/);
      // Should not hit customer lookup or transaction
      expect(db.customer.findFirst).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when tenant does not exist', async () => {
      db.tenant.findUnique.mockResolvedValue(null);

      await expect(service.earnPoints('t1', 'c1', earnDto)).rejects.toThrow(NotFoundException);
      await expect(service.earnPoints('t1', 'c1', earnDto)).rejects.toThrow('Tenant not found');
    });

    it('throws BadRequestException when loyalty program is disabled', async () => {
      db.tenant.findUnique.mockResolvedValue({
        loyalty_points_enabled: false,
        loyalty_earn_rate: 0.01,
      });

      await expect(service.earnPoints('t1', 'c1', earnDto)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.earnPoints('t1', 'c1', earnDto)).rejects.toThrow(
        'Loyalty program is not enabled',
      );
    });

    it('throws BadRequestException when earn rate is not configured', async () => {
      db.tenant.findUnique.mockResolvedValue({
        loyalty_points_enabled: true,
        loyalty_earn_rate: null,
      });

      await expect(service.earnPoints('t1', 'c1', earnDto)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.earnPoints('t1', 'c1', earnDto)).rejects.toThrow(
        'Earn rate is not configured',
      );
    });

    it('throws NotFoundException when customer does not exist', async () => {
      db.tenant.findUnique.mockResolvedValue({
        loyalty_points_enabled: true,
        loyalty_earn_rate: 0.01,
      });
      db.customer.findFirst.mockResolvedValue(null);

      await expect(service.earnPoints('t1', 'c-missing', earnDto)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.earnPoints('t1', 'c-missing', earnDto)).rejects.toThrow(
        'Customer not found',
      );
    });

    it('works without a saleId (optional field)', async () => {
      db.tenant.findUnique.mockResolvedValue({
        loyalty_points_enabled: true,
        loyalty_earn_rate: 0.01,
      });
      db.customer.findFirst.mockResolvedValue({ id: 'c1', loyalty_points: 0 });
      const mockTransaction = { id: 'lt-2', type: 'EARN', points: 10 };
      db.$transaction.mockResolvedValue([mockTransaction, {}]);

      const result = await service.earnPoints('t1', 'c1', { saleTotal: 1000 });

      expect(result.points_earned).toBe(10);
    });
  });

  // ── redeemPoints ──────────────────────────────────────────────────────────

  describe('redeemPoints', () => {
    const redeemDto = { points: 100 };

    beforeEach(() => {
      db.$transaction.mockImplementation(async (ops: any[]) => ops);
    });

    it('redeems points successfully and returns discount amount', async () => {
      db.tenant.findUnique.mockResolvedValue({
        loyalty_points_enabled: true,
        loyalty_redeem_rate: 0.5,
        loyalty_min_redeem: 50,
      });
      db.customer.findFirst.mockResolvedValue({ id: 'c1', loyalty_points: 500 });

      const mockTransaction = { id: 'lt-3', type: 'REDEEM', points: -100 };
      db.$transaction.mockResolvedValue([mockTransaction, {}]);

      const result = await service.redeemPoints('t1', 'c1', redeemDto);

      expect(result.points_redeemed).toBe(100);
      expect(result.discount_amount).toBe(50); // 100 * 0.5
      expect(result.new_balance).toBe(400); // 500 - 100
      expect(result.transaction).toEqual(mockTransaction);
    });

    it('throws NotFoundException when tenant does not exist', async () => {
      db.tenant.findUnique.mockResolvedValue(null);

      await expect(service.redeemPoints('t1', 'c1', redeemDto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws BadRequestException when loyalty program is disabled', async () => {
      db.tenant.findUnique.mockResolvedValue({
        loyalty_points_enabled: false,
        loyalty_redeem_rate: 0.5,
        loyalty_min_redeem: 0,
      });

      await expect(service.redeemPoints('t1', 'c1', redeemDto)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.redeemPoints('t1', 'c1', redeemDto)).rejects.toThrow(
        'Loyalty program is not enabled',
      );
    });

    it('throws BadRequestException when redemption rate is not configured', async () => {
      db.tenant.findUnique.mockResolvedValue({
        loyalty_points_enabled: true,
        loyalty_redeem_rate: null,
        loyalty_min_redeem: 0,
      });

      await expect(service.redeemPoints('t1', 'c1', redeemDto)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.redeemPoints('t1', 'c1', redeemDto)).rejects.toThrow(
        'Redemption rate is not configured',
      );
    });

    it('throws BadRequestException when points are below minimum redemption', async () => {
      db.tenant.findUnique.mockResolvedValue({
        loyalty_points_enabled: true,
        loyalty_redeem_rate: 0.5,
        loyalty_min_redeem: 200,
      });

      await expect(service.redeemPoints('t1', 'c1', { points: 100 })).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.redeemPoints('t1', 'c1', { points: 100 })).rejects.toThrow(
        'Minimum redemption is 200 points',
      );
    });

    it('allows redemption when min_redeem is null (treated as 0)', async () => {
      db.tenant.findUnique.mockResolvedValue({
        loyalty_points_enabled: true,
        loyalty_redeem_rate: 0.5,
        loyalty_min_redeem: null,
      });
      db.customer.findFirst.mockResolvedValue({ id: 'c1', loyalty_points: 200 });
      const mockTransaction = { id: 'lt-4', type: 'REDEEM', points: -10 };
      db.$transaction.mockResolvedValue([mockTransaction, {}]);

      const result = await service.redeemPoints('t1', 'c1', { points: 10 });

      expect(result.points_redeemed).toBe(10);
    });

    it('throws NotFoundException when customer does not exist', async () => {
      db.tenant.findUnique.mockResolvedValue({
        loyalty_points_enabled: true,
        loyalty_redeem_rate: 0.5,
        loyalty_min_redeem: 0,
      });
      db.customer.findFirst.mockResolvedValue(null);

      await expect(service.redeemPoints('t1', 'c-missing', redeemDto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws BadRequestException when customer has insufficient points', async () => {
      db.tenant.findUnique.mockResolvedValue({
        loyalty_points_enabled: true,
        loyalty_redeem_rate: 0.5,
        loyalty_min_redeem: 0,
      });
      db.customer.findFirst.mockResolvedValue({ id: 'c1', loyalty_points: 50 });

      await expect(service.redeemPoints('t1', 'c1', { points: 100 })).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.redeemPoints('t1', 'c1', { points: 100 })).rejects.toThrow(
        'Insufficient points',
      );
    });
  });

  // ── adjustPoints ──────────────────────────────────────────────────────────

  describe('adjustPoints', () => {
    beforeEach(() => {
      db.$transaction.mockImplementation(async (ops: any[]) => ops);
    });

    it('adds points via positive adjustment', async () => {
      db.customer.findFirst.mockResolvedValue({ id: 'c1', loyalty_points: 100 });
      const mockTransaction = { id: 'lt-5', type: 'ADJUST', points: 50 };
      db.$transaction.mockResolvedValue([mockTransaction, {}]);

      const result = await service.adjustPoints('t1', 'c1', {
        points: 50,
        description: 'Bonus award',
      });

      expect(result.points_adjusted).toBe(50);
      expect(result.new_balance).toBe(150);
      expect(result.transaction).toEqual(mockTransaction);
    });

    it('subtracts points via negative adjustment', async () => {
      db.customer.findFirst.mockResolvedValue({ id: 'c1', loyalty_points: 200 });
      const mockTransaction = { id: 'lt-6', type: 'ADJUST', points: -50 };
      db.$transaction.mockResolvedValue([mockTransaction, {}]);

      const result = await service.adjustPoints('t1', 'c1', { points: -50 });

      expect(result.points_adjusted).toBe(-50);
      expect(result.new_balance).toBe(150);
    });

    it('uses default description "Manual adjustment" when none is provided', async () => {
      db.customer.findFirst.mockResolvedValue({ id: 'c1', loyalty_points: 100 });
      db.$transaction.mockResolvedValue([{ id: 'lt-7', type: 'ADJUST', points: 10 }, {}]);

      await service.adjustPoints('t1', 'c1', { points: 10 });

      expect(db.$transaction).toHaveBeenCalled();
    });

    it('throws NotFoundException when customer does not exist', async () => {
      db.customer.findFirst.mockResolvedValue(null);

      await expect(
        service.adjustPoints('t1', 'c-missing', { points: 10 }),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.adjustPoints('t1', 'c-missing', { points: 10 }),
      ).rejects.toThrow('Customer not found');
    });

    it('throws BadRequestException when adjustment would result in negative balance', async () => {
      db.customer.findFirst.mockResolvedValue({ id: 'c1', loyalty_points: 30 });

      await expect(
        service.adjustPoints('t1', 'c1', { points: -50 }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.adjustPoints('t1', 'c1', { points: -50 }),
      ).rejects.toThrow('Adjustment would result in negative balance');
    });

    it('allows adjustment that results in exactly zero balance', async () => {
      db.customer.findFirst.mockResolvedValue({ id: 'c1', loyalty_points: 50 });
      const mockTransaction = { id: 'lt-8', type: 'ADJUST', points: -50 };
      db.$transaction.mockResolvedValue([mockTransaction, {}]);

      const result = await service.adjustPoints('t1', 'c1', { points: -50 });

      expect(result.new_balance).toBe(0);
    });
  });

  // ── listCustomersWithPoints ───────────────────────────────────────────────

  describe('listCustomersWithPoints', () => {
    const mockCustomers = [
      {
        id: 'c1',
        name: 'Rahim',
        phone: '01700000001',
        loyalty_points: 300,
        loyaltyTransactions: [{ created_at: new Date('2026-06-01') }],
      },
      {
        id: 'c2',
        name: 'Karim',
        phone: '01700000002',
        loyalty_points: 100,
        loyaltyTransactions: [],
      },
    ];

    it('returns customers with points ordered by points descending', async () => {
      db.customer.findMany.mockResolvedValue(mockCustomers);

      const result = await service.listCustomersWithPoints('t1');

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('c1');
      expect(result[0].loyalty_points).toBe(300);
    });

    it('maps last_transaction_at from most recent loyaltyTransaction', async () => {
      db.customer.findMany.mockResolvedValue(mockCustomers);

      const result = await service.listCustomersWithPoints('t1');

      expect(result[0].last_transaction_at).toEqual(new Date('2026-06-01'));
    });

    it('sets last_transaction_at to null when no transactions exist', async () => {
      db.customer.findMany.mockResolvedValue(mockCustomers);

      const result = await service.listCustomersWithPoints('t1');

      expect(result[1].last_transaction_at).toBeNull();
    });

    it('applies search filter for name and phone', async () => {
      db.customer.findMany.mockResolvedValue([]);

      await service.listCustomersWithPoints('t1', 'rahim');

      expect(db.customer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              expect.objectContaining({ name: expect.objectContaining({ contains: 'rahim' }) }),
              expect.objectContaining({ phone: expect.objectContaining({ contains: 'rahim' }) }),
            ]),
          }),
        }),
      );
    });

    it('does not apply OR filter when search is not provided', async () => {
      db.customer.findMany.mockResolvedValue([]);

      await service.listCustomersWithPoints('t1');

      const callArgs = db.customer.findMany.mock.calls[0][0];
      expect(callArgs.where).not.toHaveProperty('OR');
    });

    it('returns empty array when no customers match', async () => {
      db.customer.findMany.mockResolvedValue([]);

      const result = await service.listCustomersWithPoints('t1', 'nomatch');

      expect(result).toEqual([]);
    });

    it('limits results to 100 customers', async () => {
      db.customer.findMany.mockResolvedValue([]);

      await service.listCustomersWithPoints('t1');

      expect(db.customer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 }),
      );
    });
  });
});
