import { BadRequestException, ConflictException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { AssetsService } from '../assets/assets.service';
import { AuthService } from './auth.service';
import { DatabaseService } from '../database/database.service';
import { EmailService } from '../email/email.service';
import { AuditService } from '../audit/audit.service';
import { TotpService } from './totp.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { ReferralsService } from '../referrals/referrals.service';
import { PlanEntitlementsService } from '../subscription-plans/plan-entitlements.service';
import { StorePermission } from '@erp71/shared-types';

jest.mock('bcrypt', () => ({
    hash: jest.fn().mockResolvedValue('hashed-password'),
    compare: jest.fn(),
}));

describe('AuthService', () => {
    let service: AuthService;

    const db = {
        user: {
            findUnique: jest.fn(),
            findFirst: jest.fn().mockResolvedValue(null),
            create: jest.fn(),
            update: jest.fn(),
        },
        accountGroup: { upsert: jest.fn() },
        accountSubgroup: { upsert: jest.fn() },
        account: {
            upsert: jest.fn(),
            findFirst: jest.fn().mockResolvedValue({ id: 'cash-id', name: 'Cash in Hand' }),
            findMany: jest.fn().mockResolvedValue([
                { id: 'cash-id', name: 'Cash in Hand' },
                { id: 'bank-id', name: 'Main Bank Account' },
                { id: 'revenue-id', name: 'Sales Revenue' },
                { id: 'payable-id', name: 'Purchase Payable' },
                { id: 'expense-id', name: 'General Operating Expense' },
            ]),
        },
        postingRule: {
            findFirst: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue({}),
            update: jest.fn().mockResolvedValue({}),
        },
        subscriptionPlan: {
            findUnique: jest.fn(),
            findMany: jest.fn(),
        },
        tenant: { create: jest.fn() },
        tenantUser: { create: jest.fn() },
        tenantRole: { create: jest.fn() },
        tenantRolePermission: { createMany: jest.fn() },
        paymentMethod: { createMany: jest.fn() },
        store: { create: jest.fn() },
        tenantSubscription: { create: jest.fn(), findUnique: jest.fn().mockResolvedValue(null) },
        userStoreAccess: { create: jest.fn() },
        userStorePermission: { createMany: jest.fn() },
        emailVerificationToken: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }), create: jest.fn().mockResolvedValue({}) },
        tenantAddonSubscription: { findMany: jest.fn().mockResolvedValue([]) },
        $transaction: jest.fn(),
    };

    const jwtService = {
        sign: jest.fn().mockReturnValue('jwt-token'),
    };

    const emailService = {
        sendWelcome: jest.fn().mockResolvedValue(undefined),
        sendEmailVerification: jest.fn().mockResolvedValue(undefined),
    };

    const auditService = {
        log: jest.fn().mockResolvedValue(undefined),
    };

    const platformSettings = {
        getPlatformFeatures: jest.fn().mockResolvedValue({
            feedback: false,
            support: false,
            help: false,
            voice: false,
        }),
        getRawValue: jest.fn().mockResolvedValue('STANDARD'),
    };

    const referralsService = {
        resolveActiveRefereeForUser: jest.fn().mockResolvedValue(null),
    };

    const makeUserWithAccess = (storeId: string, tenantId: string) => ({
        id: 'user-1',
        email: 'owner@example.com',
        name: 'Owner',
        preferred_locale: 'bn',
        token_version: 0,
        email_verified_at: null,
        storeAccess: [{ tenant_id: tenantId, store_id: storeId, store: { id: storeId } }],
        storePermissions: [],
        tenantMembers: [{
            role: 'OWNER',
            tenant_id: tenantId,
            tenantRole: null,
            tenant: {
                id: tenantId,
                name: 'Tenant One',
                default_locale: 'bn',
                subscription: {
                    status: 'TRIALING',
                    current_period_start: new Date('2026-03-21T00:00:00.000Z'),
                    current_period_end: new Date('2026-04-04T00:00:00.000Z'),
                    cancel_at_period_end: false,
                    plan: { code: 'BASIC', name: 'Basic', description: null, monthly_price: 1499, yearly_price: null, features_json: {} },
                },
            },
        }],
    });

    beforeEach(async () => {
        jest.resetAllMocks();
        emailService.sendWelcome.mockResolvedValue(undefined);
        emailService.sendEmailVerification.mockResolvedValue(undefined);
        db.$transaction.mockImplementation(async (callback: any) => callback(db));
        db.accountGroup.upsert.mockResolvedValue({ id: 'group-1', name: 'Current Assets' });
        db.accountSubgroup.upsert.mockResolvedValue({ id: 'subgroup-1', name: 'Cash and Bank' });
        db.account.upsert.mockResolvedValue({ id: 'account-1', name: 'Cash in Hand' });
        db.account.findFirst.mockResolvedValue({ id: 'cash-id', name: 'Cash in Hand' });
        db.account.findMany.mockResolvedValue([
            { id: 'cash-id', name: 'Cash in Hand' },
            { id: 'bank-id', name: 'Main Bank Account' },
            { id: 'revenue-id', name: 'Sales Revenue' },
            { id: 'payable-id', name: 'Purchase Payable' },
            { id: 'expense-id', name: 'General Operating Expense' },
        ]);
        db.userStoreAccess.create.mockResolvedValue({});
        db.userStorePermission.createMany.mockResolvedValue({ count: 22 });
        db.tenantRole.create.mockImplementation((args: any) =>
            Promise.resolve({ id: `role-${args.data.name}`, ...args.data }),
        );
        db.tenantRolePermission.createMany.mockResolvedValue({ count: 0 });
        db.emailVerificationToken.deleteMany.mockResolvedValue({ count: 0 });
        db.emailVerificationToken.create.mockResolvedValue({});
        jwtService.sign.mockReturnValue('jwt-token');
        auditService.log.mockResolvedValue(undefined);
        db.user.findFirst.mockResolvedValue(null);
        db.tenantAddonSubscription.findMany.mockResolvedValue([]);
        db.tenantSubscription.findUnique.mockResolvedValue(null);
        platformSettings.getPlatformFeatures.mockResolvedValue({
            feedback: false,
            support: false,
            help: false,
            voice: false,
        });
        platformSettings.getRawValue.mockResolvedValue('STANDARD');

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AuthService,
                { provide: DatabaseService, useValue: db },
                { provide: JwtService, useValue: jwtService },
                { provide: EmailService, useValue: emailService },
                { provide: AuditService, useValue: auditService },
                { provide: TotpService, useValue: { isEnabled: jest.fn().mockReturnValue(false) } },
                { provide: AssetsService, useValue: { uploadFile: jest.fn() } },
                { provide: PlatformSettingsService, useValue: platformSettings },
                { provide: ReferralsService, useValue: referralsService },
                PlanEntitlementsService,
            ],
        }).compile();

        service = module.get(AuthService);
        // Stub sendVerificationEmail to avoid it competing for db.user.findUnique mock calls
        jest.spyOn(service, 'sendVerificationEmail').mockResolvedValue(undefined);
    });

    it('signs up a new tenant-backed user', async () => {
        db.user.findUnique
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(makeUserWithAccess('store-1', 'tenant-1'));
        db.user.create.mockResolvedValue({ id: 'user-1', email: 'owner@example.com', name: 'Owner' });
        db.subscriptionPlan.findUnique.mockResolvedValue({ id: 'plan-basic', code: 'BASIC', is_active: true });
        db.tenant.create.mockResolvedValue({ id: 'tenant-1' });
        db.store.create.mockResolvedValue({ id: 'store-1' });

        const result = await service.signup({
            email: 'owner@example.com',
            password: 'password123',
            name: 'Owner',
            mobile: '01712345678',
            mobile_country_code: 'BD',
            tenantName: 'Tenant One',
            storeName: 'Main Store',
            planCode: 'BASIC',
        });

        expect(result.access_token).toBe('jwt-token');
        expect(db.tenantSubscription.create).toHaveBeenCalled();

        // A tenant with no payment methods falls back to generic options on the
        // sales-entry UI, leaving Show-on-Entry/Serial inert — so signup must
        // provision the defaults.
        expect(db.paymentMethod.createMany).toHaveBeenCalledWith(
            expect.objectContaining({
                skipDuplicates: true,
                data: expect.arrayContaining([
                    expect.objectContaining({ tenant_id: 'tenant-1', name: 'Cash', type: 'Cash', sort_order: 1, show_on_entry: true }),
                    expect.objectContaining({ tenant_id: 'tenant-1', name: 'bKash', type: 'Mobile Wallet', sort_order: 2 }),
                    expect.objectContaining({ tenant_id: 'tenant-1', name: 'Nagad', type: 'Mobile Wallet', sort_order: 3 }),
                    expect.objectContaining({ tenant_id: 'tenant-1', name: 'Card', type: 'Card', sort_order: 4 }),
                    expect.objectContaining({ tenant_id: 'tenant-1', name: 'Bank', type: 'Bank', sort_order: 5 }),
                ]),
            }),
        );
    });

    it('provisionTenant creates UserStoreAccess and UserStorePermission for OWNER', async () => {
        db.user.findUnique
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(makeUserWithAccess('store-1', 'tenant-1'));
        db.user.create.mockResolvedValue({ id: 'user-1', email: 'owner@example.com', name: 'Owner' });
        db.subscriptionPlan.findUnique.mockResolvedValue({ id: 'plan-basic', code: 'BASIC', is_active: true, monthly_price: 499 });
        db.tenant.create.mockResolvedValue({ id: 'tenant-1' });
        db.store.create.mockResolvedValue({ id: 'store-1' });

        await service.signup({
            email: 'owner@example.com',
            password: 'password123',
            name: 'Owner',
            mobile: '01712345678',
            mobile_country_code: 'BD',
            tenantName: 'Tenant One',
            storeName: 'Main Store',
        });

        expect(db.userStoreAccess.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    user_id: 'user-1',
                    store_id: 'store-1',
                    tenant_id: 'tenant-1',
                    access_level: 'MULTI_STORE_CAPABLE',
                }),
            }),
        );
        expect(db.userStorePermission.createMany).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.arrayContaining([
                    expect.objectContaining({ user_id: 'user-1', store_id: 'store-1' }),
                ]),
            }),
        );
    });

    it('mapTenantMembership returns only stores from UserStoreAccess', async () => {
        db.user.findUnique.mockResolvedValue({
            id: 'user-1',
            email: 'manager@example.com',
            name: 'Manager',
            preferred_locale: 'bn',
            token_version: 0,
            email_verified_at: null,
            storeAccess: [
                { tenant_id: 'tenant-1', store_id: 'store-1', store: { id: 'store-1', name: 'Gulshan' } },
                // store-2 belongs to different tenant, should NOT appear in tenant-1 stores
                { tenant_id: 'tenant-2', store_id: 'store-2', store: { id: 'store-2', name: 'Banani' } },
            ],
            storePermissions: [
                { tenant_id: 'tenant-1', store_id: 'store-1', permission: StorePermission.CREATE_SALE },
                { tenant_id: 'tenant-1', store_id: 'store-1', permission: StorePermission.VIEW_LEDGER },
            ],
            tenantMembers: [{
                role: 'MANAGER',
                tenant_id: 'tenant-1',
                tenantRole: { id: 'role-manager', name: 'Manager' },
                tenant: {
                    id: 'tenant-1',
                    name: 'Tenant One',
                    default_locale: 'en',
                    subscription: null,
                },
            }],
        });

        const result = await service.getMe('user-1');
        expect(result.tenants[0].stores).toHaveLength(1);
        expect(result.tenants[0].stores[0].id).toBe('store-1');
        expect(result.tenants[0].tenant_role).toEqual({ id: 'role-manager', name: 'Manager' });
        expect(result.tenants[0].permissions).toEqual(
            expect.arrayContaining([StorePermission.CREATE_SALE, StorePermission.VIEW_LEDGER]),
        );
        expect(result.preferred_locale).toBe('bn');
        expect(result.tenants[0].default_locale).toBe('en');
        expect(result.platform_features).toEqual({
            feedback: false,
            support: false,
            help: false,
            voice: false,
        });
    });

    it('mapTenantMembership returns all StorePermission values for OWNER', async () => {
        db.user.findUnique.mockResolvedValue({
            id: 'user-1',
            email: 'owner@example.com',
            name: 'Owner',
            preferred_locale: 'en',
            token_version: 0,
            email_verified_at: null,
            storeAccess: [{ tenant_id: 'tenant-1', store_id: 'store-1', store: { id: 'store-1' } }],
            storePermissions: [],
            tenantMembers: [{
                role: 'OWNER',
                tenant_id: 'tenant-1',
                tenantRole: null,
                tenant: {
                    id: 'tenant-1',
                    name: 'Tenant One',
                    default_locale: 'en',
                    subscription: null,
                },
            }],
        });

        const result = await service.getMe('user-1');

        expect(result.tenants[0].tenant_role).toBeNull();
        expect(result.tenants[0].permissions).toEqual(Object.values(StorePermission));
    });

    it('updates preferred locale through updateProfile', async () => {
        db.user.update.mockResolvedValue({
            id: 'user-1',
            email: 'owner@example.com',
            name: 'Owner',
            preferred_locale: 'bn',
        });

        const result = await service.updateProfile('user-1', { preferred_locale: 'bn' });

        expect(db.user.update).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: 'user-1' },
                data: { preferred_locale: 'bn' },
            }),
        );
        expect(result.preferred_locale).toBe('bn');
    });

    it('rejects self-serve signup with the coming-soon Premium plan', async () => {
        db.user.findUnique.mockResolvedValueOnce(null);
        db.user.create.mockResolvedValue({ id: 'user-1', email: 'owner@example.com', name: 'Owner' });

        await expect(service.signup({
            email: 'owner@example.com',
            password: 'password123',
            mobile: '01712345678',
            mobile_country_code: 'BD',
            tenantName: 'Tenant One',
            storeName: 'Main Store',
            planCode: 'PREMIUM',
        } as any)).rejects.toThrow(BadRequestException);
    });

    it('rejects duplicate emails on signup', async () => {
        db.user.findUnique.mockResolvedValue({ id: 'user-1' });

        await expect(service.signup({
            email: 'owner@example.com',
            password: 'password123',
            tenantName: 'Tenant One',
            storeName: 'Main Store',
        } as any)).rejects.toThrow(ConflictException);
    });

    it('rejects invalid login credentials', async () => {
        db.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'owner@example.com', passwordHash: 'hashed' });
        (bcrypt.compare as jest.Mock).mockResolvedValue(false);

        await expect(service.login({ email: 'owner@example.com', password: 'wrong' })).rejects.toThrow(UnauthorizedException);
    });

    it('marks nayeem.ahmad@gmail.com as platform admin in auth responses', async () => {
        const oldAdminEmails = process.env.PLATFORM_ADMIN_EMAILS;
        process.env.PLATFORM_ADMIN_EMAILS = 'nayeem.ahmad@gmail.com';
        try {
            db.user.findUnique.mockResolvedValue({
                id: 'user-1',
                email: 'nayeem.ahmad@gmail.com',
                name: 'Nayeem Ahmad',
                preferred_locale: 'en',
                token_version: 0,
                email_verified_at: null,
                storeAccess: [],
                storePermissions: [],
                tenantMembers: [],
            });

            const result = await service.getMe('user-1');

            expect(result.is_platform_admin).toBe(true);
        } finally {
            process.env.PLATFORM_ADMIN_EMAILS = oldAdminEmails;
        }
    });

    // --- changePassword: session invalidation ---

    describe('demoLogin', () => {
        it('returns auth payload with is_demo when demo user exists', async () => {
            db.user.findUnique.mockResolvedValueOnce({ id: 'demo-user', email: 'demo@erp71.com' });
            db.user.findUnique.mockResolvedValueOnce(makeUserWithAccess('store-demo', 'tenant-demo'));

            const result = await service.demoLogin();

            expect(result.access_token).toBe('jwt-token');
            expect(result.is_demo).toBe(true);
        });

        it('throws when demo user is not seeded', async () => {
            db.user.findUnique.mockResolvedValueOnce(null);

            await expect(service.demoLogin()).rejects.toBeInstanceOf(ServiceUnavailableException);
        });
    });

    describe('changePassword', () => {
        const userId = 'user-1';
        const currentPassword = 'OldPass1!';
        const newPassword = 'NewPass1!';
        const hashedCurrent = 'hashed-current';

        beforeEach(() => {
            (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-password');
            (bcrypt.compare as jest.Mock).mockResolvedValue(true);
            db.user.findUnique.mockResolvedValue({ passwordHash: hashedCurrent });
            db.user.update.mockResolvedValue({});
            auditService.log.mockResolvedValue(undefined);
        });

        it('increments token_version alongside the password hash on a successful change', async () => {
            await service.changePassword(userId, { currentPassword, newPassword });

            expect(db.user.update).toHaveBeenCalledWith({
                where: { id: userId },
                data: {
                    passwordHash: 'hashed-password',
                    token_version: { increment: 1 },
                },
            });
        });

        it('invalidates all existing sessions by incrementing token_version', async () => {
            await service.changePassword(userId, { currentPassword, newPassword });

            const updateCall = db.user.update.mock.calls[0][0];
            expect(updateCall.data.token_version).toEqual({ increment: 1 });
        });

        it('rejects when current password is wrong', async () => {
            (bcrypt.compare as jest.Mock).mockResolvedValue(false);

            await expect(
                service.changePassword(userId, { currentPassword: 'wrong', newPassword }),
            ).rejects.toThrow('Current password is incorrect');

            expect(db.user.update).not.toHaveBeenCalled();
        });

        it('rejects when new password equals current password', async () => {
            await expect(
                service.changePassword(userId, { currentPassword, newPassword: currentPassword }),
            ).rejects.toThrow('New password must differ');

            expect(db.user.update).not.toHaveBeenCalled();
        });

        it('rejects when new password is shorter than 8 characters', async () => {
            await expect(
                service.changePassword(userId, { currentPassword, newPassword: 'short' }),
            ).rejects.toThrow('at least 8 characters');

            expect(db.user.update).not.toHaveBeenCalled();
        });

        it('rejects when user is not found', async () => {
            db.user.findUnique.mockResolvedValue(null);

            await expect(
                service.changePassword(userId, { currentPassword, newPassword }),
            ).rejects.toThrow('User not found');
        });

        it('logs a PASSWORD_CHANGED audit event on success', async () => {
            await service.changePassword(userId, { currentPassword, newPassword });

            await new Promise(process.nextTick);

            expect(auditService.log).toHaveBeenCalledWith(
                'PASSWORD_CHANGED',
                'User',
                { userId },
                userId,
            );
        });
    });
});

describe('AuthService.getSignupDefaults', () => {
    const platformSettings = { getRawValue: jest.fn() };
    const service = new AuthService(
        {} as any, {} as any, {} as any, {} as any, {} as any,
        {} as any, platformSettings as any, {} as any, {} as any,
    );

    beforeEach(() => jest.clearAllMocks());

    it('returns the configured self-serve plan', async () => {
        platformSettings.getRawValue.mockResolvedValue('STANDARD');
        await expect(service.getSignupDefaults()).resolves.toEqual({ defaultPlanCode: 'STANDARD' });
    });

    it('falls back to STANDARD when the setting is not a self-serve plan', async () => {
        platformSettings.getRawValue.mockResolvedValue('FREE');
        await expect(service.getSignupDefaults()).resolves.toEqual({ defaultPlanCode: 'STANDARD' });
    });
});

describe('AuthService.signup', () => {
    let createdUser: any;

    const tx = {
        user: { create: jest.fn(async ({ data }: any) => { createdUser = { id: 'u1', ...data }; return createdUser; }) },
    };
    const db = {
        user: { findUnique: jest.fn(async () => null), findFirst: jest.fn(async () => null) },
        $transaction: jest.fn(async (cb: any) => cb(tx)),
    };
    const email = { sendWelcome: jest.fn(async () => {}) };
    const audit = { log: jest.fn(async () => {}) };
    const platformSettings = { getRawValue: jest.fn(async () => 'STANDARD') };

    const makeService = () => {
        const svc = new AuthService(
            db as any, {} as any, email as any, audit as any, {} as any,
            {} as any, platformSettings as any, {} as any, {} as any,
        );
        // Isolate signup(): stub provisioning and post-signup side effects.
        jest.spyOn(svc as any, 'provisionTenant').mockResolvedValue({ tenant: { id: 't1' } });
        jest.spyOn(svc as any, 'generateAuthResponse').mockResolvedValue({ access_token: 'x', tenants: [] });
        jest.spyOn(svc as any, 'sendVerificationEmail').mockResolvedValue(undefined);
        return svc;
    };

    beforeEach(() => {
        jest.clearAllMocks();
        createdUser = undefined;
        // The outer `AuthService` describe's beforeEach calls jest.resetAllMocks(), which
        // strips the initial jest.fn(impl) implementations from these file-scoped mocks
        // (resetAllMocks is global, not scoped to the describe block that calls it). Restore
        // them here so this block is self-contained regardless of run order.
        db.user.findUnique.mockResolvedValue(null);
        db.user.findFirst.mockResolvedValue(null);
        db.$transaction.mockImplementation(async (cb: any) => cb(tx));
        tx.user.create.mockImplementation(async ({ data }: any) => {
            createdUser = { id: 'u1', ...data };
            return createdUser;
        });
        email.sendWelcome.mockResolvedValue(undefined);
        audit.log.mockResolvedValue(undefined);
        platformSettings.getRawValue.mockResolvedValue('STANDARD');
    });

    it('creates account with only org name + email + password', async () => {
        const svc = makeService();
        await svc.signup({ email: 'owner@shop.com', password: 'password1', tenantName: 'Dhaka Retail Co.' } as any);
        expect(createdUser.name).toBe('owner');            // email local-part
        expect(createdUser.mobile).toBeNull();             // no mobile provided
        expect(db.user.findFirst).not.toHaveBeenCalled();  // no mobile uniqueness lookup
        // store-name default is passed into provisioning
        expect((svc as any).provisionTenant).toHaveBeenCalledWith(
            expect.anything(), 'u1',
            expect.objectContaining({ storeName: 'Main Store', planCode: 'STANDARD' }),
        );
    });

    it('accepts a duplicate mobile (no uniqueness check)', async () => {
        const svc = makeService();
        await svc.signup({ email: 'a@b.com', password: 'password1', tenantName: 'Org', mobile: '01712345678' } as any);
        expect(createdUser.mobile).toBe('+8801712345678');
        expect(db.user.findFirst).not.toHaveBeenCalled();
    });
});
