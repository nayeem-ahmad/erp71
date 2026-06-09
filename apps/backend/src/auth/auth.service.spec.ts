import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { DatabaseService } from '../database/database.service';
import { EmailService } from '../email/email.service';
import { AuditService } from '../audit/audit.service';

jest.mock('bcrypt', () => ({
    hash: jest.fn().mockResolvedValue('hashed-password'),
    compare: jest.fn(),
}));

describe('AuthService', () => {
    let service: AuthService;

    const db = {
        user: {
            findUnique: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
        },
        accountGroup: { upsert: jest.fn() },
        accountSubgroup: { upsert: jest.fn() },
        account: {
            upsert: jest.fn(),
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
        store: { create: jest.fn() },
        tenantSubscription: { create: jest.fn() },
        userStoreAccess: { create: jest.fn() },
        userStorePermission: { createMany: jest.fn() },
        emailVerificationToken: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }), create: jest.fn().mockResolvedValue({}) },
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

    const makeUserWithAccess = (storeId: string, tenantId: string) => ({
        id: 'user-1',
        email: 'owner@example.com',
        name: 'Owner',
        preferred_locale: 'bn',
        token_version: 0,
        email_verified_at: null,
        storeAccess: [{ tenant_id: tenantId, store: { id: storeId } }],
        tenantMembers: [{
            role: 'OWNER',
            tenant_id: tenantId,
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
        db.account.findMany.mockResolvedValue([
            { id: 'cash-id', name: 'Cash in Hand' },
            { id: 'bank-id', name: 'Main Bank Account' },
            { id: 'revenue-id', name: 'Sales Revenue' },
            { id: 'payable-id', name: 'Purchase Payable' },
            { id: 'expense-id', name: 'General Operating Expense' },
        ]);
        db.userStoreAccess.create.mockResolvedValue({});
        db.userStorePermission.createMany.mockResolvedValue({ count: 22 });
        db.emailVerificationToken.deleteMany.mockResolvedValue({ count: 0 });
        db.emailVerificationToken.create.mockResolvedValue({});
        jwtService.sign.mockReturnValue('jwt-token');
        auditService.log.mockResolvedValue(undefined);

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AuthService,
                { provide: DatabaseService, useValue: db },
                { provide: JwtService, useValue: jwtService },
                { provide: EmailService, useValue: emailService },
                { provide: AuditService, useValue: auditService },
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
            tenantName: 'Tenant One',
            storeName: 'Main Store',
            planCode: 'BASIC',
        });

        expect(result.access_token).toBe('jwt-token');
        expect(db.tenantSubscription.create).toHaveBeenCalled();
    });

    it('provisionTenant creates UserStoreAccess and UserStorePermission for OWNER', async () => {
        db.user.findUnique
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(makeUserWithAccess('store-1', 'tenant-1'));
        db.user.create.mockResolvedValue({ id: 'user-1', email: 'owner@example.com', name: 'Owner' });
        db.subscriptionPlan.findUnique.mockResolvedValue({ id: 'plan-free', code: 'FREE', is_active: true });
        db.tenant.create.mockResolvedValue({ id: 'tenant-1' });
        db.store.create.mockResolvedValue({ id: 'store-1' });

        await service.signup({
            email: 'owner@example.com',
            password: 'password123',
            name: 'Owner',
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
                { tenant_id: 'tenant-1', store: { id: 'store-1', name: 'Gulshan' } },
                // store-2 belongs to different tenant, should NOT appear in tenant-1 stores
                { tenant_id: 'tenant-2', store: { id: 'store-2', name: 'Banani' } },
            ],
            tenantMembers: [{
                role: 'MANAGER',
                tenant_id: 'tenant-1',
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
        expect(result.preferred_locale).toBe('bn');
        expect(result.tenants[0].default_locale).toBe('en');
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
                tenantMembers: [],
            });

            const result = await service.getMe('user-1');

            expect(result.is_platform_admin).toBe(true);
        } finally {
            process.env.PLATFORM_ADMIN_EMAILS = oldAdminEmails;
        }
    });
});