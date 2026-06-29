jest.mock('@erp71/database', () => ({
    bootstrapDefaultAccountingForTenant: jest.fn().mockResolvedValue(undefined),
    seedBusinessTypeTemplate: jest.fn().mockResolvedValue(undefined),
    PrismaClient: class MockPrismaClient {},
}));

jest.mock('bcrypt', () => ({
    hash: jest.fn().mockResolvedValue('hashed-throwaway-password'),
}));

import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AdminTenantsService } from './admin-tenants.service';
import { DatabaseService } from '../database/database.service';
import { BillingService } from '../billing/billing.service';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../email/email.service';

describe('AdminTenantsService', () => {
  let service: AdminTenantsService;
  let db: any;
  let billingService: any;
  let jwtService: any;
  let auditService: any;
  let emailService: any;

  const makeTenant = (overrides: any = {}) => ({
    id: 't-1',
    name: 'Test Store',
    created_at: new Date('2025-01-01'),
    owner: { id: 'u-owner', email: 'owner@test.com', name: 'Owner' },
    stores: [{ id: 's-1', name: 'Main Store', address: '123 Dhaka', created_at: new Date() }],
    users: [
      {
        role: 'OWNER',
        created_at: new Date(),
        user: { id: 'u-owner', email: 'owner@test.com', name: 'Owner' },
      },
    ],
    subscription: {
      status: 'ACTIVE',
      current_period_start: new Date('2025-01-01'),
      current_period_end: new Date('2025-02-01'),
      cancel_at_period_end: false,
      provider_name: 'manual',
      plan: {
        code: 'BASIC',
        name: 'Basic Plan',
        description: 'Entry level',
        monthly_price: { toNumber: () => 500, valueOf: () => 500 },
        yearly_price: null,
      },
    },
    ...overrides,
  });

  beforeEach(async () => {
    jest.clearAllMocks();

    db = {
      tenant: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
      },
      tenantUser: { create: jest.fn() },
      store: { create: jest.fn() },
      subscriptionPlan: { findUnique: jest.fn() },
      tenantSubscription: {
        findUnique: jest.fn(),
        update: jest.fn(),
        groupBy: jest.fn(),
        create: jest.fn(),
      },
      userStoreAccess: { create: jest.fn() },
      userStorePermission: { createMany: jest.fn() },
      passwordResetToken: { create: jest.fn().mockResolvedValue({}) },
      user: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
      },
      $transaction: jest.fn().mockImplementation(async (cb: any) => cb(db)),
    };

    emailService = {
      sendWelcome: jest.fn().mockResolvedValue(undefined),
      sendPasswordReset: jest.fn().mockResolvedValue(undefined),
    };

    billingService = {
      applySubscriptionChange: jest.fn(),
    };

    jwtService = {
      sign: jest.fn().mockReturnValue('mock-jwt-token'),
    };

    auditService = {
      log: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminTenantsService,
        { provide: DatabaseService, useValue: db },
        { provide: BillingService, useValue: billingService },
        { provide: JwtService, useValue: jwtService },
        { provide: AuditService, useValue: auditService },
        { provide: EmailService, useValue: emailService },
      ],
    }).compile();

    service = module.get<AdminTenantsService>(AdminTenantsService);
  });

  /* ------------------------------------------------------------------ */
  /*  listTenants                                                         */
  /* ------------------------------------------------------------------ */

  describe('listTenants', () => {
    it('returns all tenants when no filters applied', async () => {
      db.tenant.findMany.mockResolvedValue([makeTenant()]);

      const result = await service.listTenants({});

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('t-1');
      expect(result[0].name).toBe('Test Store');
    });

    it('filters tenants by search term (name)', async () => {
      const tenants = [
        makeTenant({ id: 't-1', name: 'Alpha Store' }),
        makeTenant({ id: 't-2', name: 'Beta Shop' }),
      ];
      db.tenant.findMany.mockResolvedValue(tenants);

      const result = await service.listTenants({ search: 'alpha' });

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('t-1');
    });

    it('filters tenants by owner email', async () => {
      const tenants = [
        makeTenant({ id: 't-1', owner: { id: 'u-1', email: 'alpha@test.com', name: 'Alpha' } }),
        makeTenant({ id: 't-2', owner: { id: 'u-2', email: 'beta@test.com', name: 'Beta' } }),
      ];
      db.tenant.findMany.mockResolvedValue(tenants);

      const result = await service.listTenants({ search: 'alpha@test.com' });

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('t-1');
    });

    it('filters tenants by plan code', async () => {
      const tenants = [
        makeTenant({ id: 't-1' }), // BASIC plan (from makeTenant default)
        makeTenant({
          id: 't-2',
          subscription: {
            status: 'ACTIVE',
            current_period_start: new Date(),
            current_period_end: new Date(),
            cancel_at_period_end: false,
            provider_name: 'manual',
            plan: {
              code: 'PREMIUM',
              name: 'Premium',
              description: 'Top tier',
              monthly_price: { toNumber: () => 2000 },
              yearly_price: null,
            },
          },
        }),
      ];
      db.tenant.findMany.mockResolvedValue(tenants);

      const result = await service.listTenants({ planCode: 'BASIC' });

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('t-1');
    });

    it('filters tenants by subscription status', async () => {
      const tenants = [
        makeTenant({ id: 't-1' }), // ACTIVE status
        makeTenant({
          id: 't-2',
          subscription: {
            ...makeTenant().subscription,
            status: 'CANCELLED',
          },
        }),
      ];
      db.tenant.findMany.mockResolvedValue(tenants);

      const result = await service.listTenants({ status: 'ACTIVE' });

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('t-1');
    });

    it('returns empty array when no tenants match filters', async () => {
      db.tenant.findMany.mockResolvedValue([makeTenant()]);

      const result = await service.listTenants({ search: 'xyznonexistent' });

      expect(result).toHaveLength(0);
    });

    it('maps tenant including subscription, stores, users', async () => {
      db.tenant.findMany.mockResolvedValue([makeTenant()]);

      const result = await service.listTenants({});
      const tenant = result[0];

      expect(tenant.subscription).not.toBeNull();
      expect(tenant.subscription!.status).toBe('ACTIVE');
      expect(tenant.subscription!.plan.code).toBe('BASIC');
      expect(tenant.stores).toHaveLength(1);
      expect(tenant.users).toHaveLength(1);
      expect(tenant.store_count).toBe(1);
      expect(tenant.user_count).toBe(1);
    });

    it('returns null subscription when tenant has none', async () => {
      db.tenant.findMany.mockResolvedValue([makeTenant({ subscription: null })]);

      const result = await service.listTenants({});

      expect(result[0].subscription).toBeNull();
    });

    it('returns null owner when tenant has no owner', async () => {
      db.tenant.findMany.mockResolvedValue([makeTenant({ owner: null })]);

      const result = await service.listTenants({});

      expect(result[0].owner).toBeNull();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  getTenant                                                           */
  /* ------------------------------------------------------------------ */

  describe('getTenant', () => {
    it('returns a mapped tenant by ID', async () => {
      db.tenant.findUnique.mockResolvedValue(makeTenant());

      const result = await service.getTenant('t-1');

      expect(result.id).toBe('t-1');
      expect(result.name).toBe('Test Store');
      expect(db.tenant.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 't-1' } }),
      );
    });

    it('throws NotFoundException when tenant does not exist', async () => {
      db.tenant.findUnique.mockResolvedValue(null);

      const result = service.getTenant('nonexistent');
      await expect(result).rejects.toThrow(NotFoundException);
      await expect(result).rejects.toThrow('Tenant not found');
    });

    it('includes store address in the response', async () => {
      db.tenant.findUnique.mockResolvedValue(makeTenant());

      const result = await service.getTenant('t-1');

      expect(result.stores[0].address).toBe('123 Dhaka');
    });
  });

  /* ------------------------------------------------------------------ */
  /*  updateSubscription                                                  */
  /* ------------------------------------------------------------------ */

  describe('updateSubscription', () => {
    it('updates subscription using billingService.applySubscriptionChange', async () => {
      const existing = {
        tenant_id: 't-1',
        status: 'ACTIVE',
        current_period_start: new Date(),
        current_period_end: new Date(),
        cancel_at_period_end: false,
        provider_name: 'manual',
        provider_customer_ref: 'customer-ref',
        provider_subscription_ref: 'sub-ref',
        plan: { code: 'BASIC' },
      };
      db.tenantSubscription.findUnique.mockResolvedValue(existing);
      billingService.applySubscriptionChange.mockResolvedValue({ success: true });

      const result = await service.updateSubscription('t-1', { planCode: 'STANDARD' });

      expect(result).toEqual({ success: true });
      expect(billingService.applySubscriptionChange).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 't-1',
          planCode: 'STANDARD',
        }),
      );
    });

    it('uses existing plan code when planCode is not provided', async () => {
      const existing = {
        tenant_id: 't-1',
        status: 'ACTIVE',
        current_period_start: new Date(),
        current_period_end: new Date(),
        cancel_at_period_end: false,
        provider_name: 'manual',
        provider_customer_ref: 'ref',
        provider_subscription_ref: 'sub-ref',
        plan: { code: 'BASIC' },
      };
      db.tenantSubscription.findUnique.mockResolvedValue(existing);
      billingService.applySubscriptionChange.mockResolvedValue({ success: true });

      await service.updateSubscription('t-1', { status: 'TRIALING' });

      expect(billingService.applySubscriptionChange).toHaveBeenCalledWith(
        expect.objectContaining({ planCode: 'BASIC' }),
      );
    });

    it('throws NotFoundException when no subscription and no planCode provided', async () => {
      db.tenantSubscription.findUnique.mockResolvedValue(null);

      const result = service.updateSubscription('t-1', {});
      await expect(result).rejects.toThrow(NotFoundException);
      await expect(result).rejects.toThrow('A plan code is required when creating a subscription.');
    });

    it('creates new subscription when none exists but planCode is provided', async () => {
      db.tenantSubscription.findUnique.mockResolvedValue(null);
      billingService.applySubscriptionChange.mockResolvedValue({ success: true });

      const result = await service.updateSubscription('t-1', { planCode: 'BASIC' });

      expect(result).toEqual({ success: true });
      expect(billingService.applySubscriptionChange).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 't-1', planCode: 'BASIC' }),
      );
    });
  });

  /* ------------------------------------------------------------------ */
  /*  suspendTenant                                                       */
  /* ------------------------------------------------------------------ */

  describe('suspendTenant', () => {
    it('suspends tenant by setting subscription to CANCELLED', async () => {
      db.tenantSubscription.findUnique.mockResolvedValue({ tenant_id: 't-1', status: 'ACTIVE' });
      db.tenantSubscription.update.mockResolvedValue({ tenant_id: 't-1', status: 'CANCELLED' });

      const result = await service.suspendTenant('t-1', { reason: 'Violation' }, 'admin-1');

      expect(result.success).toBe(true);
      expect(result.reason).toBe('Violation');
      expect(db.tenantSubscription.update).toHaveBeenCalledWith({
        where: { tenant_id: 't-1' },
        data: { status: 'CANCELLED' },
      });
    });

    it('logs the suspension via auditService', async () => {
      db.tenantSubscription.findUnique.mockResolvedValue({ tenant_id: 't-1', status: 'ACTIVE' });
      db.tenantSubscription.update.mockResolvedValue({ tenant_id: 't-1', status: 'CANCELLED' });

      await service.suspendTenant('t-1', { reason: 'Abuse' }, 'admin-1');

      expect(auditService.log).toHaveBeenCalledWith(
        'tenant.suspend',
        'Tenant',
        { userId: 'admin-1' },
        't-1',
        { reason: 'Abuse' },
      );
    });

    it('throws NotFoundException when tenant has no subscription', async () => {
      db.tenantSubscription.findUnique.mockResolvedValue(null);

      const result = service.suspendTenant('t-1', {}, 'admin-1');
      await expect(result).rejects.toThrow(NotFoundException);
      await expect(result).rejects.toThrow('Tenant or subscription not found');
    });

    it('returns null reason when no reason provided', async () => {
      db.tenantSubscription.findUnique.mockResolvedValue({ tenant_id: 't-1', status: 'ACTIVE' });
      db.tenantSubscription.update.mockResolvedValue({ tenant_id: 't-1', status: 'CANCELLED' });

      const result = await service.suspendTenant('t-1', {}, 'admin-1');

      expect(result.reason).toBeNull();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  impersonateTenant                                                   */
  /* ------------------------------------------------------------------ */

  describe('impersonateTenant', () => {
    it('returns an impersonation token with tenant and user details', async () => {
      const tenant = {
        id: 't-1',
        name: 'Test Store',
        owner: { id: 'u-owner', email: 'owner@test.com', token_version: 1 },
      };
      db.tenant.findUnique.mockResolvedValue(tenant);
      jwtService.sign.mockReturnValue('impersonation-token');

      const result = await service.impersonateTenant('t-1', 'admin-1');

      expect(result.access_token).toBe('impersonation-token');
      expect(result.expires_in).toBe(3600);
      expect(result.impersonated_user.id).toBe('u-owner');
      expect(result.impersonated_user.email).toBe('owner@test.com');
      expect(result.tenant.id).toBe('t-1');
      expect(result.tenant.name).toBe('Test Store');
    });

    it('signs the JWT with impersonation payload and 1h expiry', async () => {
      const tenant = {
        id: 't-1',
        name: 'Test Store',
        owner: { id: 'u-owner', email: 'owner@test.com', token_version: 2 },
      };
      db.tenant.findUnique.mockResolvedValue(tenant);

      await service.impersonateTenant('t-1', 'admin-1');

      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          sub: 'u-owner',
          email: 'owner@test.com',
          tv: 2,
          impersonated_by: 'admin-1',
          impersonated_tenant: 't-1',
        }),
        { expiresIn: '1h' },
      );
    });

    it('logs the impersonation via auditService', async () => {
      const tenant = {
        id: 't-1',
        name: 'Test Store',
        owner: { id: 'u-owner', email: 'owner@test.com', token_version: 1 },
      };
      db.tenant.findUnique.mockResolvedValue(tenant);

      await service.impersonateTenant('t-1', 'admin-1');

      expect(auditService.log).toHaveBeenCalledWith(
        'tenant.impersonate',
        'Tenant',
        { userId: 'admin-1' },
        't-1',
        expect.objectContaining({
          impersonated_user_id: 'u-owner',
          impersonated_user_email: 'owner@test.com',
        }),
      );
    });

    it('throws NotFoundException when tenant does not exist', async () => {
      db.tenant.findUnique.mockResolvedValue(null);

      const result = service.impersonateTenant('nonexistent', 'admin-1');
      await expect(result).rejects.toThrow(NotFoundException);
      await expect(result).rejects.toThrow('Tenant not found');
    });
  });

  /* ------------------------------------------------------------------ */
  /*  getMetrics                                                          */
  /* ------------------------------------------------------------------ */

  describe('getMetrics', () => {
    it('returns aggregated platform metrics', async () => {
      db.tenant.count
        .mockResolvedValueOnce(50)   // total tenants
        .mockResolvedValueOnce(5);   // new this month
      db.user.count.mockResolvedValue(200);
      db.tenantSubscription.groupBy.mockResolvedValue([
        { status: 'ACTIVE', _count: { status: 40 } },
        { status: 'TRIALING', _count: { status: 5 } },
        { status: 'CANCELLED', _count: { status: 3 } },
      ]);

      const result = await service.getMetrics();

      expect(result.total_tenants).toBe(50);
      expect(result.total_users).toBe(200);
      expect(result.new_tenants_this_month).toBe(5);
      expect(result.subscriptions.active).toBe(40);
      expect(result.subscriptions.trialing).toBe(5);
      expect(result.subscriptions.cancelled).toBe(3);
      expect(result.subscriptions.past_due).toBe(0);
    });

    it('defaults to 0 for missing subscription statuses', async () => {
      db.tenant.count.mockResolvedValue(0);
      db.user.count.mockResolvedValue(0);
      db.tenantSubscription.groupBy.mockResolvedValue([]);

      const result = await service.getMetrics();

      expect(result.subscriptions.active).toBe(0);
      expect(result.subscriptions.trialing).toBe(0);
      expect(result.subscriptions.past_due).toBe(0);
      expect(result.subscriptions.cancelled).toBe(0);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  listUsers                                                           */
  /* ------------------------------------------------------------------ */

  describe('listUsers', () => {
    const makeUser = (overrides: any = {}) => ({
      id: 'u-1',
      email: 'user@test.com',
      name: 'Test User',
      is_platform_admin: false,
      email_verified_at: new Date(),
      created_at: new Date(),
      _count: { tenantMembers: 2 },
      ...overrides,
    });

    it('returns paginated users', async () => {
      const users = [makeUser()];
      db.user.findMany.mockResolvedValue(users);
      db.user.count.mockResolvedValue(1);

      const result = await service.listUsers({ page: 1, limit: 20 });

      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
    });

    it('maps user correctly with email_verified and tenant_count', async () => {
      const users = [makeUser({ email_verified_at: new Date(), _count: { tenantMembers: 3 } })];
      db.user.findMany.mockResolvedValue(users);
      db.user.count.mockResolvedValue(1);

      const result = await service.listUsers({});

      expect(result.data[0].email_verified).toBe(true);
      expect(result.data[0].tenant_count).toBe(3);
    });

    it('returns email_verified false when email not verified', async () => {
      const users = [makeUser({ email_verified_at: null })];
      db.user.findMany.mockResolvedValue(users);
      db.user.count.mockResolvedValue(1);

      const result = await service.listUsers({});

      expect(result.data[0].email_verified).toBe(false);
    });

    it('applies search filter when search term provided', async () => {
      db.user.findMany.mockResolvedValue([]);
      db.user.count.mockResolvedValue(0);

      await service.listUsers({ search: 'john' });

      expect(db.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              expect.objectContaining({ email: expect.any(Object) }),
              expect.objectContaining({ name: expect.any(Object) }),
            ]),
          }),
        }),
      );
    });

    it('uses default page=1 and limit=20 when not provided', async () => {
      db.user.findMany.mockResolvedValue([]);
      db.user.count.mockResolvedValue(0);

      const result = await service.listUsers({});

      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
    });

    it('caps limit at 100', async () => {
      db.user.findMany.mockResolvedValue([]);
      db.user.count.mockResolvedValue(0);

      const result = await service.listUsers({ limit: 9999 });

      expect(result.limit).toBe(100);
      expect(db.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 }),
      );
    });

    it('computes skip correctly for page 3, limit 10', async () => {
      db.user.findMany.mockResolvedValue([]);
      db.user.count.mockResolvedValue(0);

      await service.listUsers({ page: 3, limit: 10 });

      expect(db.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
    });
  });

  /* ------------------------------------------------------------------ */
  /*  promoteUser                                                         */
  /* ------------------------------------------------------------------ */

  describe('promoteUser', () => {
    it('sets is_platform_admin to true for the user', async () => {
      db.user.findUnique.mockResolvedValue({ id: 'u-1', email: 'user@test.com' });
      db.user.update.mockResolvedValue({ id: 'u-1', is_platform_admin: true });

      const result = await service.promoteUser('u-1', 'admin-1');

      expect(result.success).toBe(true);
      expect(result.is_platform_admin).toBe(true);
      expect(db.user.update).toHaveBeenCalledWith({
        where: { id: 'u-1' },
        data: { is_platform_admin: true },
      });
    });

    it('logs the promotion via auditService', async () => {
      db.user.findUnique.mockResolvedValue({ id: 'u-1', email: 'user@test.com' });
      db.user.update.mockResolvedValue({ id: 'u-1' });

      await service.promoteUser('u-1', 'admin-1');

      expect(auditService.log).toHaveBeenCalledWith(
        'user.promote',
        'User',
        { userId: 'admin-1' },
        'u-1',
        { target_email: 'user@test.com' },
      );
    });

    it('throws NotFoundException when user does not exist', async () => {
      db.user.findUnique.mockResolvedValue(null);

      const result = service.promoteUser('nonexistent', 'admin-1');
      await expect(result).rejects.toThrow(NotFoundException);
      await expect(result).rejects.toThrow('User not found');
    });
  });

  /* ------------------------------------------------------------------ */
  /*  demoteUser                                                          */
  /* ------------------------------------------------------------------ */

  describe('demoteUser', () => {
    it('sets is_platform_admin to false for the user', async () => {
      db.user.findUnique.mockResolvedValue({ id: 'u-1', email: 'admin@test.com' });
      db.user.update.mockResolvedValue({ id: 'u-1', is_platform_admin: false });

      const result = await service.demoteUser('u-1', 'super-admin');

      expect(result.success).toBe(true);
      expect(result.is_platform_admin).toBe(false);
      expect(db.user.update).toHaveBeenCalledWith({
        where: { id: 'u-1' },
        data: { is_platform_admin: false },
      });
    });

    it('logs the demotion via auditService', async () => {
      db.user.findUnique.mockResolvedValue({ id: 'u-1', email: 'admin@test.com' });
      db.user.update.mockResolvedValue({ id: 'u-1' });

      await service.demoteUser('u-1', 'super-admin');

      expect(auditService.log).toHaveBeenCalledWith(
        'user.demote',
        'User',
        { userId: 'super-admin' },
        'u-1',
        { target_email: 'admin@test.com' },
      );
    });

    it('throws NotFoundException when user does not exist', async () => {
      db.user.findUnique.mockResolvedValue(null);

      const result = service.demoteUser('nonexistent', 'super-admin');
      await expect(result).rejects.toThrow(NotFoundException);
      await expect(result).rejects.toThrow('User not found');
    });
  });

  /* ------------------------------------------------------------------ */
  /*  lookupUserByEmail                                                   */
  /* ------------------------------------------------------------------ */

  describe('lookupUserByEmail', () => {
    it('returns id, email, name when user exists', async () => {
      db.user.findUnique.mockResolvedValue({
        id: 'u-1',
        email: 'test@example.com',
        name: 'Test User',
      });

      const result = await service.lookupUserByEmail('test@example.com');

      expect(result).toEqual({ id: 'u-1', email: 'test@example.com', name: 'Test User' });
      expect(db.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'test@example.com' },
        select: { id: true, email: true, name: true },
      });
    });

    it('throws NotFoundException when user does not exist', async () => {
      db.user.findUnique.mockResolvedValue(null);

      await expect(service.lookupUserByEmail('ghost@example.com')).rejects.toThrow(NotFoundException);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  createTenant                                                        */
  /* ------------------------------------------------------------------ */

  describe('createTenant', () => {
    const plan = { id: 'plan-1', code: 'FREE', is_active: true };

    beforeEach(() => {
      db.subscriptionPlan.findUnique.mockResolvedValue(plan);
      db.tenant.create.mockResolvedValue({ id: 't-new', name: 'Acme Ltd' });
      db.tenantUser.create.mockResolvedValue({});
      db.store.create.mockResolvedValue({ id: 's-new', name: 'Acme Store' });
      db.tenantSubscription.create.mockResolvedValue({});
      db.userStoreAccess.create.mockResolvedValue({});
      db.userStorePermission.createMany.mockResolvedValue({ count: 10 });
      db.tenant.findUnique.mockResolvedValue(makeTenant({ id: 't-new', name: 'Acme Ltd' }));
    });

    describe('ownerMode = new', () => {
      it('creates a new user and provisions the tenant', async () => {
        db.user.findUnique.mockResolvedValueOnce(null); // email check → not taken
        db.user.create.mockResolvedValue({ id: 'u-new', email: 'owner@acme.com', name: 'Alice' });

        const result = await service.createTenant(
          {
            ownerMode: 'new',
            ownerEmail: 'owner@acme.com',
            ownerName: 'Alice',
            tenantName: 'Acme Ltd',
            storeName: 'Acme Store',
            planCode: 'FREE',
          },
          'admin-1',
        );

        expect(db.user.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ email: 'owner@acme.com', name: 'Alice', passwordHash: expect.any(String) }),
          }),
        );
        expect(db.passwordResetToken.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ user_id: 'u-new' }),
          }),
        );
        expect(emailService.sendPasswordReset).toHaveBeenCalledWith('owner@acme.com', expect.any(String));
        expect(db.tenant.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ name: 'Acme Ltd', owner_id: 'u-new' }),
          }),
        );
        expect(auditService.log).toHaveBeenCalledWith(
          'tenant.admin_create',
          'Tenant',
          expect.anything(),
          't-new',
          expect.objectContaining({ owner_mode: 'new' }),
        );
        expect(result.id).toBe('t-new');
      });

      it('throws ConflictException when email is already registered', async () => {
        db.user.findUnique.mockResolvedValueOnce({ id: 'u-taken' }); // email taken

        await expect(
          service.createTenant(
            { ownerMode: 'new', ownerEmail: 'taken@test.com', tenantName: 'X', storeName: 'X', planCode: 'FREE' },
            'admin-1',
          ),
        ).rejects.toThrow(ConflictException);

        expect(db.user.create).not.toHaveBeenCalled();
      });
    });

    describe('ownerMode = existing', () => {
      it('reuses an existing user and skips user creation', async () => {
        db.user.findUnique.mockResolvedValueOnce({
          id: 'u-existing',
          email: 'owner@acme.com',
          name: 'Bob',
        });

        const result = await service.createTenant(
          {
            ownerMode: 'existing',
            ownerUserId: 'u-existing',
            tenantName: 'Acme Ltd',
            storeName: 'Acme Store',
            planCode: 'FREE',
          },
          'admin-1',
        );

        expect(db.user.create).not.toHaveBeenCalled();
        expect(emailService.sendWelcome).not.toHaveBeenCalled();
        expect(db.tenant.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ owner_id: 'u-existing' }),
          }),
        );
        expect(result.id).toBe('t-new');
      });

      it('throws NotFoundException when ownerUserId does not exist', async () => {
        db.user.findUnique.mockResolvedValueOnce(null);

        await expect(
          service.createTenant(
            { ownerMode: 'existing', ownerUserId: 'ghost', tenantName: 'X', storeName: 'X', planCode: 'FREE' },
            'admin-1',
          ),
        ).rejects.toThrow(NotFoundException);
      });
    });
  });
});
