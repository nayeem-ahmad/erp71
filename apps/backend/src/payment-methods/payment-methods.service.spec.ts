import { Test, TestingModule } from '@nestjs/testing';
import { PaymentMethodsService } from './payment-methods.service';
import { DatabaseService } from '../database/database.service';
import { PaymentMethodType } from './payment-methods.dto';
import { availableAt } from './payment-method-branches';
import { BadRequestException } from '@nestjs/common';

describe('PaymentMethodsService', () => {
  let service: PaymentMethodsService;
  let db: any;
  let createMock: jest.Mock;
  let updateMock: jest.Mock;
  let findFirstMock: jest.Mock;

  const tenantId = 'tenant-1';

  beforeEach(async () => {
    createMock = jest.fn().mockResolvedValue({
      id: 'pm-1',
      tenant_id: tenantId,
      type: PaymentMethodType.CASH,
      name: 'Till',
      account_id: null,
      is_active: true,
      sort_order: 0,
      show_on_entry: true,
      created_at: new Date(),
      updated_at: new Date(),
    });
    updateMock = jest.fn().mockResolvedValue({
      id: 'pm-1',
      tenant_id: tenantId,
      type: PaymentMethodType.CASH,
      name: 'Till',
      account_id: null,
      is_active: true,
      sort_order: 0,
      show_on_entry: true,
      created_at: new Date(),
      updated_at: new Date(),
    });
    findFirstMock = jest.fn().mockResolvedValue(null);

    db = {
      paymentMethod: {
        findFirst: findFirstMock,
        findMany: jest.fn().mockResolvedValue([]),
        create: createMock,
        update: updateMock,
      },
      account: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      store: {
        // The tenant owns s1 and s2; answers with whichever of the asked ids exist.
        findMany: jest.fn(({ where }: any) =>
          Promise.resolve(['s1', 's2'].filter((id) => where.id.in.includes(id)).map((id) => ({ id })))),
      },
      paymentMethodStore: {
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      // Callback form: the transaction client is the same mock, so ordering
      // across tables can be read off one call log.
      $transaction: jest.fn((fn: (tx: any) => unknown) => fn(db)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [PaymentMethodsService, { provide: DatabaseService, useValue: db }],
    }).compile();

    service = module.get<PaymentMethodsService>(PaymentMethodsService);
  });

  describe('create()', () => {
    it('defaults show_on_entry to true on create when omitted', async () => {
      await service.create(tenantId, { type: PaymentMethodType.CASH, name: 'Till' } as any);
      expect(createMock.mock.calls[0][0].data.show_on_entry).toBe(true);
    });

    it('passes through show_on_entry: false on create when provided', async () => {
      await service.create(tenantId, {
        type: PaymentMethodType.CASH,
        name: 'Till',
        show_on_entry: false,
      } as any);
      expect(createMock.mock.calls[0][0].data.show_on_entry).toBe(false);
    });

    it('includes show_on_entry in the mapped response', async () => {
      const result = await service.create(tenantId, { type: PaymentMethodType.CASH, name: 'Till' } as any);
      expect(result.show_on_entry).toBe(true);
    });
  });

  describe('update()', () => {
    const existingPaymentMethod = {
      id: 'pm-1',
      tenant_id: tenantId,
      type: PaymentMethodType.CASH,
      name: 'Till',
      account_id: null,
      is_active: true,
      sort_order: 0,
      show_on_entry: false,
      all_branches: true,
      stores: [] as { store_id: string }[],
      created_at: new Date(),
      updated_at: new Date(),
    };

    beforeEach(() => {
      // findFirst is used both for the by-id lookup (where.id) and the
      // duplicate-name check (where.name); disambiguate on the where clause
      // so a name change doesn't spuriously collide with itself.
      findFirstMock.mockImplementation(({ where }: any) =>
        Promise.resolve(where?.id ? existingPaymentMethod : null),
      );
    });

    it('defaults show_on_entry to the existing value when omitted', async () => {
      await service.update('pm-1', tenantId, { name: 'Till 2' } as any);
      expect(updateMock.mock.calls[0][0].data.show_on_entry).toBe(false);
    });

    it('passes through show_on_entry when provided on update', async () => {
      await service.update('pm-1', tenantId, { show_on_entry: true } as any);
      expect(updateMock.mock.calls[0][0].data.show_on_entry).toBe(true);
    });

    it('keeps the linked account when account_id is omitted', async () => {
      findFirstMock.mockImplementation(({ where }: any) =>
        Promise.resolve(where?.id ? { ...existingPaymentMethod, account_id: 'acc-1' } : null),
      );
      await service.update('pm-1', tenantId, { name: 'Till 2' } as any);
      expect(updateMock.mock.calls[0][0].data.account_id).toBe('acc-1');
    });

    // Regression: `dto.account_id ?? existing` treated the form's explicit null
    // as "not provided", so clearing the picker silently kept the old account.
    it('unlinks the account when account_id is explicitly null', async () => {
      findFirstMock.mockImplementation(({ where }: any) =>
        Promise.resolve(where?.id ? { ...existingPaymentMethod, account_id: 'acc-1' } : null),
      );
      await service.update('pm-1', tenantId, { account_id: null } as any);
      expect(updateMock.mock.calls[0][0].data.account_id).toBeNull();
    });
  });

  describe('branches', () => {
    const existingPaymentMethod = {
      id: 'pm-1', tenant_id: tenantId, type: PaymentMethodType.CASH, name: 'Till', account_id: null,
      is_active: true, sort_order: 0, show_on_entry: true, all_branches: true,
      stores: [] as { store_id: string }[], created_at: new Date(), updated_at: new Date(),
    };

    beforeEach(() => {
      findFirstMock.mockImplementation(({ where }: any) =>
        Promise.resolve(where?.id ? existingPaymentMethod : null),
      );
    });

    it('creates a method limited to two branches', async () => {
      const result = await service.create(tenantId, {
        type: PaymentMethodType.CASH, name: 'Till', all_branches: false, store_ids: ['s1', 's2'],
      } as any);
      expect(createMock.mock.calls[0][0].data.all_branches).toBe(false);
      expect(db.paymentMethodStore.createMany).toHaveBeenCalledWith({
        data: [
          { tenant_id: tenantId, payment_method_id: 'pm-1', store_id: 's1' },
          { tenant_id: tenantId, payment_method_id: 'pm-1', store_id: 's2' },
        ],
      });
      expect(result.all_branches).toBe(false);
      expect(result.store_ids).toEqual(['s1', 's2']);
    });

    it('validates the branch ids with one tenant-scoped lookup', async () => {
      await service.create(tenantId, {
        type: PaymentMethodType.CASH, name: 'Till', all_branches: false, store_ids: ['s1', 's2'],
      } as any);
      expect(db.store.findMany).toHaveBeenCalledTimes(1);
      expect(db.store.findMany.mock.calls[0][0].where).toEqual({ tenant_id: tenantId, id: { in: ['s1', 's2'] } });
    });

    it('defaults to all branches, with no join rows', async () => {
      const result = await service.create(tenantId, { type: PaymentMethodType.CASH, name: 'Till' } as any);
      expect(createMock.mock.calls[0][0].data.all_branches).toBe(true);
      expect(db.paymentMethodStore.createMany).not.toHaveBeenCalled();
      expect(result.all_branches).toBe(true);
      expect(result.store_ids).toEqual([]);
    });

    it('refuses all_branches false with no branches', async () => {
      await expect(
        service.create(tenantId, { type: PaymentMethodType.CASH, name: 'Till', all_branches: false, store_ids: [] } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.create(tenantId, { type: PaymentMethodType.CASH, name: 'Till', all_branches: false } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(createMock).not.toHaveBeenCalled();
    });

    it('refuses a store id that is not the tenant\'s', async () => {
      await expect(
        service.create(tenantId, { type: PaymentMethodType.CASH, name: 'Till', all_branches: false, store_ids: ['s1', 'foreign'] } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(createMock).not.toHaveBeenCalled();
    });

    it('update replaces the branch rows: deleteMany then createMany in one $transaction', async () => {
      findFirstMock.mockImplementation(({ where }: any) =>
        Promise.resolve(where?.id ? { ...existingPaymentMethod, all_branches: false, stores: [{ store_id: 's1' }] } : null),
      );
      const order: string[] = [];
      db.paymentMethodStore.deleteMany.mockImplementation(async () => { order.push('deleteMany'); return { count: 1 }; });
      db.paymentMethodStore.createMany.mockImplementation(async () => { order.push('createMany'); return { count: 1 }; });

      const result = await service.update('pm-1', tenantId, { store_ids: ['s2'] } as any);

      expect(db.$transaction).toHaveBeenCalledTimes(1);
      expect(order).toEqual(['deleteMany', 'createMany']);
      expect(db.paymentMethodStore.deleteMany).toHaveBeenCalledWith({ where: { payment_method_id: 'pm-1' } });
      expect(db.paymentMethodStore.createMany).toHaveBeenCalledWith({
        data: [{ tenant_id: tenantId, payment_method_id: 'pm-1', store_id: 's2' }],
      });
      expect(result.store_ids).toEqual(['s2']);
    });

    it('update to all branches removes the join rows and adds none', async () => {
      findFirstMock.mockImplementation(({ where }: any) =>
        Promise.resolve(where?.id ? { ...existingPaymentMethod, all_branches: false, stores: [{ store_id: 's1' }] } : null),
      );
      const result = await service.update('pm-1', tenantId, { all_branches: true, store_ids: ['s1'] } as any);
      expect(updateMock.mock.calls[0][0].data.all_branches).toBe(true);
      expect(db.paymentMethodStore.deleteMany).toHaveBeenCalledWith({ where: { payment_method_id: 'pm-1' } });
      expect(db.paymentMethodStore.createMany).not.toHaveBeenCalled();
      expect(result.store_ids).toEqual([]);
    });

    it('update leaves both alone when all_branches and store_ids are omitted', async () => {
      findFirstMock.mockImplementation(({ where }: any) =>
        Promise.resolve(where?.id ? { ...existingPaymentMethod, all_branches: false, stores: [{ store_id: 's1' }] } : null),
      );
      const result = await service.update('pm-1', tenantId, { name: 'Till 2' } as any);
      expect(updateMock.mock.calls[0][0].data.all_branches).toBe(false);
      expect(db.paymentMethodStore.deleteMany).not.toHaveBeenCalled();
      expect(db.paymentMethodStore.createMany).not.toHaveBeenCalled();
      expect(result.store_ids).toEqual(['s1']);
    });

    it('update refuses all_branches false when no branches would remain', async () => {
      await expect(service.update('pm-1', tenantId, { all_branches: false } as any)).rejects.toBeInstanceOf(BadRequestException);
      expect(updateMock).not.toHaveBeenCalled();
    });

    it('update refuses a foreign store id', async () => {
      await expect(
        service.update('pm-1', tenantId, { all_branches: false, store_ids: ['foreign'] } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(updateMock).not.toHaveBeenCalled();
    });

    it('findAll with storeIds filters to methods available there', async () => {
      await service.findAll(tenantId, { storeIds: ['s1'] });
      expect(db.paymentMethod.findMany.mock.calls[0][0].where).toEqual({
        tenant_id: tenantId,
        ...availableAt(['s1']),
      });
    });

    it('findAll without storeIds returns every method, with its branches', async () => {
      db.paymentMethod.findMany.mockResolvedValue([
        { ...existingPaymentMethod, id: 'pm-a', name: 'A', all_branches: false, stores: [{ store_id: 's1' }] },
        { ...existingPaymentMethod, id: 'pm-b', name: 'B' },
      ]);
      const result = await service.findAll(tenantId, { type: PaymentMethodType.CASH });
      const args = db.paymentMethod.findMany.mock.calls[0][0];
      expect(args.where).toEqual({ tenant_id: tenantId, type: PaymentMethodType.CASH });
      expect(args.include).toEqual({ stores: { select: { store_id: true } } });
      expect(result.map((m) => [m.all_branches, m.store_ids])).toEqual([[false, ['s1']], [true, []]]);
    });
  });

  // Entry screens say where a tender's money lands before it is saved.
  describe('findAll()', () => {
    const row = (over: Record<string, unknown>) => ({
      tenant_id: tenantId, type: PaymentMethodType.CASH, is_active: true, sort_order: 0,
      show_on_entry: true, created_at: new Date(), updated_at: new Date(), ...over,
    });

    it('carries each method\'s linked account, looked up in one tenant-scoped query', async () => {
      db.paymentMethod.findMany.mockResolvedValue([
        row({ id: 'pm-cash', name: 'Cash', account_id: 'acc-cash' }),
        row({ id: 'pm-bkash', name: 'bKash', account_id: 'acc-bkash' }),
        row({ id: 'pm-card', name: 'Card', account_id: null }),
      ]);
      db.account.findMany.mockResolvedValue([
        { id: 'acc-cash', name: 'Cash in Hand', code: '110101' },
        { id: 'acc-bkash', name: 'bKash Account', code: '110103' },
      ]);

      const result = await service.findAll(tenantId);

      expect(db.account.findMany).toHaveBeenCalledTimes(1);
      expect(db.account.findMany.mock.calls[0][0].where).toEqual({ tenant_id: tenantId, id: { in: ['acc-cash', 'acc-bkash'] } });
      expect(result.map((m) => m.account)).toEqual([
        { id: 'acc-cash', name: 'Cash in Hand', code: '110101' },
        { id: 'acc-bkash', name: 'bKash Account', code: '110103' },
        null,
      ]);
    });

    it('reads a link to an account that no longer exists as no account', async () => {
      db.paymentMethod.findMany.mockResolvedValue([row({ id: 'pm-bank', name: 'Bank', account_id: 'acc-gone' })]);
      db.account.findMany.mockResolvedValue([]);

      const [method] = await service.findAll(tenantId);

      expect(method.account).toBeNull();
    });

    it('skips the account lookup when nothing is linked', async () => {
      db.paymentMethod.findMany.mockResolvedValue([row({ id: 'pm-cash', name: 'Cash', account_id: null })]);

      await service.findAll(tenantId);

      expect(db.account.findMany).not.toHaveBeenCalled();
    });
  });

  describe('findLinkableAccounts()', () => {
    it('scopes the lookup to the tenant and returns picker fields only', async () => {
      db.account.findMany.mockResolvedValue([
        { id: 'acc-1', name: 'Cash in Hand', code: '110101', type: 'asset', category: 'cash' },
      ]);

      const result = await service.findLinkableAccounts(tenantId);

      expect(db.account.findMany.mock.calls[0][0].where).toEqual({ tenant_id: tenantId });
      expect(result).toEqual([
        { id: 'acc-1', name: 'Cash in Hand', code: '110101', type: 'asset', category: 'cash' },
      ]);
    });

    it('normalises a missing account code to null', async () => {
      db.account.findMany.mockResolvedValue([
        { id: 'acc-2', name: 'Uncoded', code: null, type: 'asset', category: 'general' },
      ]);

      const [account] = await service.findLinkableAccounts(tenantId);

      expect(account.code).toBeNull();
    });
  });
});
