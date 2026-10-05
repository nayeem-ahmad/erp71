import { ForbiddenException } from '@nestjs/common';
import { StorePermission } from '@erp71/shared-types';
import { AccountingController } from './accounting.controller';

/**
 * P&L / balance sheet / trial balance: a `branch` id and every `compare` id are
 * checked against the caller's branches, on top of the consolidated check that
 * `company` and `compare` already needed.
 */
describe('AccountingController — statement branch scope', () => {
    const owner = { tenantId: 't1', storeId: 's1', userId: 'u1', userRole: 'OWNER', timezone: 'Asia/Dhaka' } as any;
    const member = { ...owner, userRole: 'MANAGER' };
    const service = {
        getProfitLoss: jest.fn(),
        getBalanceSheet: jest.fn(),
        getTrialBalance: jest.fn(),
        getAccountingDashboardOverview: jest.fn(),
        getFinancialKpis: jest.fn(),
        getFinancialTrends: jest.fn(),
        findVouchers: jest.fn(),
    };
    const db = { userStorePermission: { findFirst: jest.fn() } };
    const branchScope = { resolveStoreId: jest.fn(), resolveStoreIds: jest.fn() };
    const controller = new AccountingController(service as any, db as any, branchScope as any);

    const statements = [
        ['getProfitLoss', (t: any, q: any) => controller.getProfitLoss(t, q)],
        ['getBalanceSheet', (t: any, q: any) => controller.getBalanceSheet(t, q)],
        ['getTrialBalance', (t: any, q: any) => controller.getTrialBalance(t, q)],
    ] as const;

    beforeEach(() => {
        jest.clearAllMocks();
        db.userStorePermission.findFirst.mockResolvedValue(null);
    });

    it.each(statements)('%s: scope=branch runs the id through the resolver, one branch only', async (method, call) => {
        branchScope.resolveStoreId.mockResolvedValue('s2');
        await call(owner, { scope: 'branch', storeId: 's2' });
        expect(branchScope.resolveStoreId).toHaveBeenCalledWith(owner, 's2', {
            permissions: [StorePermission.VIEW_LEDGER],
            allowAll: false,
        });
        expect(service[method]).toHaveBeenCalledWith('t1', expect.objectContaining({ scope: 'branch', storeId: 's2' }), true);
    });

    // Regression: `scope=branch&storeId=<another branch>` read that branch's books.
    it.each(statements)('%s: scope=branch refuses a branch the caller cannot use', async (method, call) => {
        branchScope.resolveStoreId.mockRejectedValue(new ForbiddenException());
        await expect(call(member, { scope: 'branch', storeId: 'foreign' })).rejects.toBeInstanceOf(ForbiddenException);
        expect(service[method]).not.toHaveBeenCalled();
    });

    it.each(statements)('%s: scope=compare checks every id after the consolidated check', async (method, call) => {
        branchScope.resolveStoreIds.mockResolvedValue(['s1', 's2']);
        await call(owner, { scope: 'compare', storeIds: 's1, s2' });
        expect(branchScope.resolveStoreIds).toHaveBeenCalledWith(owner, ['s1', 's2'], {
            permissions: [StorePermission.VIEW_LEDGER],
        });
        expect(service[method]).toHaveBeenCalledWith('t1', expect.objectContaining({ storeIds: 's1,s2' }), true);
    });

    it.each(statements)('%s: scope=compare without the consolidated grant is refused first', async (method, call) => {
        await expect(call(member, { scope: 'compare', storeIds: 's1' })).rejects.toBeInstanceOf(ForbiddenException);
        expect(branchScope.resolveStoreIds).not.toHaveBeenCalled();
        expect(service[method]).not.toHaveBeenCalled();
    });

    it.each(statements)('%s: scope=compare refuses a foreign id', async (method, call) => {
        branchScope.resolveStoreIds.mockRejectedValue(new ForbiddenException());
        await expect(call(owner, { scope: 'compare', storeIds: 's1,foreign' })).rejects.toBeInstanceOf(ForbiddenException);
        expect(service[method]).not.toHaveBeenCalled();
    });

    it.each(statements)('%s: scope=company keeps the consolidated answer for the service', async (method, call) => {
        await call(member, { scope: 'company' });
        expect(branchScope.resolveStoreId).not.toHaveBeenCalled();
        expect(service[method]).toHaveBeenCalledWith('t1', { scope: 'company' }, false);
    });

    describe.each(['getAccountingDashboardOverview', 'getFinancialKpis', 'getFinancialTrends'] as const)('%s', (method) => {
        const call = (query: any) => (controller as any)[method](member, query);

        it('hands the service the resolved branch', async () => {
            branchScope.resolveStoreId.mockResolvedValue('s1');
            await call({ from: '2026-09-01' });
            expect(branchScope.resolveStoreId).toHaveBeenCalledWith(member, undefined, {
                permissions: [StorePermission.VIEW_LEDGER],
            });
            expect(service[method]).toHaveBeenCalledWith('t1', { from: '2026-09-01', storeId: 's1' });
        });

        it('refuses a branch the caller cannot use', async () => {
            branchScope.resolveStoreId.mockRejectedValue(new ForbiddenException());
            await expect(call({ storeId: 'foreign' })).rejects.toBeInstanceOf(ForbiddenException);
            expect(service[method]).not.toHaveBeenCalled();
        });
    });

    describe('GET /accounting/vouchers', () => {
        it('lists the resolved branch', async () => {
            branchScope.resolveStoreId.mockResolvedValue('s1');
            await controller.findVouchers(member, { storeId: 's1' } as any);
            expect(branchScope.resolveStoreId).toHaveBeenCalledWith(member, 's1', {
                permissions: [StorePermission.VIEW_LEDGER],
            });
            expect(service.findVouchers).toHaveBeenCalledWith('t1', { storeId: 's1', timezone: 'Asia/Dhaka' });
        });

        it('refuses a branch the caller cannot use', async () => {
            branchScope.resolveStoreId.mockRejectedValue(new ForbiddenException());
            await expect(controller.findVouchers(member, { storeId: 'foreign' } as any)).rejects.toBeInstanceOf(ForbiddenException);
            expect(service.findVouchers).not.toHaveBeenCalled();
        });
    });
});
