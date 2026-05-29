import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { Reflector } from '@nestjs/core';
import { AccountingController } from './accounting.controller';
import { AccountingService } from './accounting.service';
import { TenantRoleGuard } from '../auth/tenant-role.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SubscriptionAccessGuard } from '../auth/subscription-access.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { DatabaseService } from '../database/database.service';
import { CallHandler, ExecutionContext } from '@nestjs/common';

describe('AccountingController — Story 30.1', () => {
    let app: INestApplication;

    const accountingService = {
        getModuleOverview: jest.fn(),
        findAccountGroups: jest.fn(),
        getFinancialKpis: jest.fn(),
        getFinancialTrends: jest.fn(),
        findLedger: jest.fn(),
        findVouchers: jest.fn(),
        findVoucherById: jest.fn(),
        createAccount: jest.fn(),
        getVoucherNumberPreview: jest.fn(),
        createVoucher: jest.fn(),
        listPostingRules: jest.fn(),
        updatePostingRule: jest.fn(),
        listPostingExceptions: jest.fn(),
        retryPostingException: jest.fn(),
    };

    const db = {
        tenantUser: {
            findUnique: jest.fn(),
        },
    };

    class MockJwtAuthGuard {
        canActivate(context: any) {
            const request = context.switchToHttp().getRequest();
            request.user = {
                userId: request.headers['x-user-id'] || 'user-1',
                email: 'user@example.com',
            };
            return true;
        }
    }

    class MockSubscriptionAccessGuard {
        canActivate() {
            return true;
        }
    }

    class MockTenantInterceptor {
        intercept(context: ExecutionContext, next: CallHandler) {
            const request = context.switchToHttp().getRequest();
            request.tenantId = request.headers['x-tenant-id'] || 'tenant-1';
            request.storeId = request.headers['x-store-id'];
            request.userRole = 'OWNER';
            request.tenant = {
                tenantId: request.headers['x-tenant-id'] || 'tenant-1',
                userId: request.headers['x-user-id'] || 'user-1',
                role: 'OWNER',
            };
            return next.handle();
        }
    }

    beforeEach(async () => {
        jest.clearAllMocks();
        accountingService.getModuleOverview.mockReturnValue({ module: 'accounting', tenantId: 'tenant-1' });
        accountingService.findAccountGroups.mockReturnValue([{ id: 'group-1', name: 'Current Assets' }]);
        accountingService.findVouchers.mockResolvedValue({
            data: [{ id: 'voucher-1', voucher_number: 'CP-00001', total_amount: 50 }],
            meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
        });
        accountingService.findVoucherById.mockResolvedValue({
            id: 'voucher-1',
            voucher_number: 'CP-00001',
            details: [{ account: { name: 'Cash in Hand' } }],
        });
        accountingService.getFinancialKpis.mockResolvedValue({
            filters: { from: '2026-03-01', to: '2026-03-31' },
            kpis: {
                cash_inflow: 300,
                cash_outflow: 125,
                net_cash_movement: 175,
                gross_revenue: 300,
                operating_expense: 125,
                accounts_receivable: null,
                accounts_payable: 20,
                tax_liability: null,
            },
        });
        accountingService.getFinancialTrends.mockResolvedValue({
            filters: { from: '2026-03-01', to: '2026-03-31' },
            granularity: 'day',
            has_activity: true,
            points: [
                {
                    date: '2026-03-01',
                    cash_inflow: 0,
                    cash_outflow: 125,
                    net_cash_movement: -125,
                    gross_revenue: 0,
                    operating_expense: 125,
                    net_profit: -125,
                },
            ],
            comparison: {
                net_profit: 175,
                gross_margin: null,
                gross_margin_status: 'unavailable',
                gross_margin_reason: 'Sale-time cost basis is not tracked in the current data model.',
            },
        });
        accountingService.findLedger.mockResolvedValue({
            account: { id: 'account-1', name: 'Cash in Hand', type: 'asset' },
            opening_balance: 125,
            opening_balance_side: 'credit',
            closing_balance: 175,
            closing_balance_side: 'debit',
            totals: { debit: 300, credit: 0 },
            data: [{ voucher_number: 'CR-00001', running_balance: 175, running_balance_side: 'debit' }],
        });
        accountingService.getVoucherNumberPreview.mockResolvedValue({
            tenantId: 'tenant-1',
            voucherType: 'cash_payment',
            voucherNumber: 'CP-00001',
        });
        accountingService.createVoucher.mockImplementation((tenantId: string, dto: any) => ({
            id: 'voucher-1',
            tenant_id: tenantId,
            voucher_number: 'CP-00001',
            ...dto,
        }));
        accountingService.listPostingRules.mockResolvedValue({
            data: [],
        });
        accountingService.updatePostingRule.mockResolvedValue({
            id: 'rule-1',
            eventType: 'sale',
        });
        accountingService.listPostingExceptions.mockResolvedValue({
            data: [],
            pagination: { page: 1, limit: 20, total: 0 },
        });
        accountingService.retryPostingException.mockResolvedValue({
            id: 'event-1',
            status: 'pending',
        });
        accountingService.createAccount.mockImplementation((tenantId: string, dto: any) => ({
            id: 'account-1',
            tenantId,
            ...dto,
        }));

        const moduleBuilder = Test.createTestingModule({
            controllers: [AccountingController],
            providers: [
                TenantRoleGuard,
                TenantInterceptor,
                Reflector,
                {
                    provide: AccountingService,
                    useValue: accountingService,
                },
                {
                    provide: DatabaseService,
                    useValue: db,
                },
            ],
        });

        moduleBuilder.overrideGuard(JwtAuthGuard).useClass(MockJwtAuthGuard);
        moduleBuilder.overrideGuard(SubscriptionAccessGuard).useClass(MockSubscriptionAccessGuard);
        moduleBuilder.overrideInterceptor(TenantInterceptor).useClass(MockTenantInterceptor);

        const module: TestingModule = await moduleBuilder.compile();

        app = module.createNestApplication();
        await app.init();
    });

    afterEach(async () => {
        await app.close();
    });

    it('allows OWNER users to access accounting overview', async () => {
        db.tenantUser.findUnique.mockResolvedValue({ role: 'OWNER' });

        await request(app.getHttpServer())
            .get('/accounting')
            .set('x-user-id', 'user-owner')
            .set('x-tenant-id', 'tenant-1')
            .expect(200)
            .expect(({ body }) => {
                expect(body.module).toBe('accounting');
                expect(body.tenantId).toBe('tenant-1');
            });

        expect(db.tenantUser.findUnique).toHaveBeenCalledWith({
            where: {
                tenant_id_user_id: {
                    tenant_id: 'tenant-1',
                    user_id: 'user-owner',
                },
            },
        });
    });

    it('allows MANAGER users to access write routes', async () => {
        db.tenantUser.findUnique.mockResolvedValue({ role: 'MANAGER' });

        await request(app.getHttpServer())
            .post('/accounting/accounts')
            .set('x-user-id', 'user-manager')
            .set('x-tenant-id', 'tenant-1')
            .send({
                groupId: 'group-1',
                name: 'Cash in Hand',
                type: 'asset',
                category: 'cash',
            })
            .expect(201)
            .expect(({ body }) => {
                expect(body.name).toBe('Cash in Hand');
                expect(body.category).toBe('cash');
            });

        await request(app.getHttpServer())
            .post('/accounting/vouchers')
            .set('x-user-id', 'user-manager')
            .set('x-tenant-id', 'tenant-1')
            .send({
                voucherType: 'cash_payment',
                details: [
                    { accountId: 'account-cash', debitAmount: 0, creditAmount: 50 },
                    { accountId: 'account-expense', debitAmount: 50, creditAmount: 0 },
                ],
            })
            .expect(201)
            .expect(({ body }) => {
                expect(body.voucher_number).toBe('CP-00001');
            });
    });

    it('returns the next voucher number preview for authorized users', async () => {
        db.tenantUser.findUnique.mockResolvedValue({ role: 'OWNER' });

        await request(app.getHttpServer())
            .get('/accounting/vouchers/next-number')
            .query({ voucherType: 'cash_payment' })
            .set('x-user-id', 'user-owner')
            .set('x-tenant-id', 'tenant-1')
            .expect(200)
            .expect(({ body }) => {
                expect(body.voucherNumber).toBe('CP-00001');
                expect(body.voucherType).toBe('cash_payment');
            });

        expect(accountingService.getVoucherNumberPreview).toHaveBeenCalledWith('tenant-1', 'cash_payment');
    });

    it('returns paginated journal results and voucher details for authorized users', async () => {
        db.tenantUser.findUnique.mockResolvedValue({ role: 'OWNER' });

        await request(app.getHttpServer())
            .get('/accounting/vouchers')
            .query({ voucherType: 'cash_payment', page: 1, limit: 20 })
            .set('x-user-id', 'user-owner')
            .set('x-tenant-id', 'tenant-1')
            .expect(200)
            .expect(({ body }) => {
                expect(body.data[0].voucher_number).toBe('CP-00001');
                expect(body.meta.total).toBe(1);
            });

        await request(app.getHttpServer())
            .get('/accounting/vouchers/voucher-1')
            .set('x-user-id', 'user-owner')
            .set('x-tenant-id', 'tenant-1')
            .expect(200)
            .expect(({ body }) => {
                expect(body.voucher_number).toBe('CP-00001');
                expect(body.details).toHaveLength(1);
            });

        await request(app.getHttpServer())
            .get('/accounting/dashboard/kpis')
            .query({ from: '2026-03-01', to: '2026-03-31' })
            .set('x-user-id', 'user-owner')
            .set('x-tenant-id', 'tenant-1')
            .expect(200)
            .expect(({ body }) => {
                expect(body.kpis.cash_inflow).toBe(300);
                expect(body.kpis.net_cash_movement).toBe(175);
                expect(body.kpis.accounts_payable).toBe(20);
            });

        expect(accountingService.getFinancialKpis).toHaveBeenCalledWith('tenant-1', {
            from: '2026-03-01',
            to: '2026-03-31',
        });

        await request(app.getHttpServer())
            .get('/accounting/dashboard/trends')
            .query({ from: '2026-03-01', to: '2026-03-31' })
            .set('x-user-id', 'user-owner')
            .set('x-tenant-id', 'tenant-1')
            .expect(200)
            .expect(({ body }) => {
                expect(body.granularity).toBe('day');
                expect(body.points[0].cash_outflow).toBe(125);
                expect(body.comparison.net_profit).toBe(175);
                expect(body.comparison.gross_margin).toBeNull();
            });

        expect(accountingService.getFinancialTrends).toHaveBeenCalledWith('tenant-1', {
            from: '2026-03-01',
            to: '2026-03-31',
        });

        await request(app.getHttpServer())
            .get('/accounting/reports/ledger/account-1')
            .query({ from: '2026-03-05', to: '2026-03-31' })
            .set('x-user-id', 'user-owner')
            .set('x-tenant-id', 'tenant-1')
            .expect(200)
            .expect(({ body }) => {
                expect(body.account.name).toBe('Cash in Hand');
                expect(body.opening_balance).toBe(125);
                expect(body.closing_balance_side).toBe('debit');
                expect(body.data[0].voucher_number).toBe('CR-00001');
            });

        expect(accountingService.findLedger).toHaveBeenCalledWith('tenant-1', 'account-1', {
            from: '2026-03-05',
            to: '2026-03-31',
        });
    });

    it('rejects CASHIER users from accounting endpoints', async () => {
        db.tenantUser.findUnique.mockResolvedValue({ role: 'CASHIER' });

        await request(app.getHttpServer())
            .get('/accounting')
            .set('x-user-id', 'user-cashier')
            .set('x-tenant-id', 'tenant-1')
            .expect(403)
            .expect(({ body }) => {
                expect(body.message).toBe('You do not have access to the accounting module');
            });
    });

    it('rejects missing tenant membership', async () => {
        db.tenantUser.findUnique.mockResolvedValue(null);

        await request(app.getHttpServer())
            .get('/accounting')
            .set('x-user-id', 'user-missing')
            .set('x-tenant-id', 'tenant-1')
            .expect(401)
            .expect(({ body }) => {
                expect(body.message).toBe('Invalid tenant context');
            });
    });

    it('rejects requests without tenant header', async () => {
        await request(app.getHttpServer())
            .get('/accounting')
            .set('x-user-id', 'user-missing-tenant')
            .expect(401)
            .expect(({ body }) => {
                expect(body.message).toBe('Missing tenant context');
            });
    });
});