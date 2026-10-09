import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { HomePulseService } from './home-pulse.service';
import { DatabaseService } from '../database/database.service';
import { AuthCacheService } from '../database/auth-cache.service';
import { BranchScopeService } from '../database/branch-scope.service';
import { PlanEntitlementsService } from '../subscription-plans/plan-entitlements.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { ProductsService } from '../products/products.service';
import { AccountingService } from '../accounting/accounting.service';
import { CrmActivitiesService } from '../crm-activities/crm-activities.service';
import { ProjectAccessService } from '../projects/project-access.service';
import { RedisService } from '../cache/redis.service';
import type { TenantContext } from '../database/tenant.decorator';

const OWNER: TenantContext = { tenantId: 'tenant-1', userId: 'owner-1', userRole: 'OWNER', storeId: 'store-1', timezone: 'Asia/Dhaka' };
const PROJECT_USER: TenantContext = { tenantId: 'tenant-1', userId: 'user-2', userRole: 'CASHIER', storeId: 'store-1', timezone: 'Asia/Dhaka' };

const EVERY_ENTITLEMENT = { premiumAccounting: true, premiumCrm: true, premiumManufacturing: true };

describe('HomePulseService', () => {
    let service: HomePulseService;

    const db = {
        userStorePermission: { findMany: jest.fn() },
        salesOrder: { count: jest.fn() },
        purchaseOrder: { count: jest.fn() },
        leaveRequest: { count: jest.fn() },
        storefrontOrder: { count: jest.fn() },
        productionJob: { count: jest.fn() },
        importShipment: { count: jest.fn() },
        projectTask: { count: jest.fn() },
    };
    const branchScope = { resolveStoreId: jest.fn() };
    const entitlements = { getFeaturesForTenant: jest.fn() };
    const platformSettings = { isFeatureEnabledForTenant: jest.fn() };
    const products = { countLowStock: jest.fn() };
    const accounting = { getPendingVoucherCount: jest.fn() };
    const crm = { summary: jest.fn() };
    const projectAccess = { taskFilter: jest.fn() };
    const redis = { get: jest.fn(), set: jest.fn() };

    /** Every metric has something to count, every gate is open. */
    function everythingHasWork() {
        db.salesOrder.count.mockResolvedValue(2);
        db.purchaseOrder.count.mockResolvedValue(3);
        db.leaveRequest.count.mockResolvedValue(4);
        db.storefrontOrder.count.mockResolvedValue(5);
        db.productionJob.count.mockResolvedValue(6);
        db.importShipment.count.mockResolvedValue(7);
        db.projectTask.count.mockResolvedValue(8);
        products.countLowStock.mockResolvedValue({ count: 9 });
        accounting.getPendingVoucherCount.mockResolvedValue({ count: 10, approvalEnabled: true });
        crm.summary.mockResolvedValue({ dueToday: 1, overdue: 10, total: 30 });
        projectAccess.taskFilter.mockResolvedValue({});
        entitlements.getFeaturesForTenant.mockResolvedValue(EVERY_ENTITLEMENT);
        platformSettings.isFeatureEnabledForTenant.mockResolvedValue(true);
        branchScope.resolveStoreId.mockImplementation(async (ctx: TenantContext) => ctx.storeId);
    }

    beforeEach(async () => {
        jest.resetAllMocks();
        redis.get.mockResolvedValue(null);

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                HomePulseService,
                { provide: DatabaseService, useValue: db },
                { provide: AuthCacheService, useValue: new AuthCacheService({ ttlMs: 0 }) },
                { provide: BranchScopeService, useValue: branchScope },
                { provide: PlanEntitlementsService, useValue: entitlements },
                { provide: PlatformSettingsService, useValue: platformSettings },
                { provide: ProductsService, useValue: products },
                { provide: AccountingService, useValue: accounting },
                { provide: CrmActivitiesService, useValue: crm },
                { provide: ProjectAccessService, useValue: projectAccess },
                { provide: RedisService, useValue: redis },
            ],
        }).compile();

        service = module.get(HomePulseService);
    });

    it('gives the owner one count per app, each linked to where the work is', async () => {
        everythingHasWork();

        await expect(service.getPulse(OWNER, undefined)).resolves.toEqual({
            sales: { count: 2, href: '/sales/orders' },
            purchase: { count: 3, href: '/purchases/orders' },
            hr: { count: 4, href: '/hr/leaves' },
            storefront: { count: 5, href: '/storefront' },
            manufacturing: { count: 6, href: '/manufacturing/jobs' },
            imports: { count: 7, href: '/purchases/imports' },
            projects: { count: 8, href: '/projects/tasks' },
            inventory: { count: 9, href: '/inventory' },
            accounting: { count: 10, href: '/accounting/vouchers?approvalStatus=PENDING' },
            crm: { count: 11, href: '/crm/activities' },
        });
    });

    it('counts only the open tasks assigned to the viewer, inside the projects they can see', async () => {
        everythingHasWork();
        projectAccess.taskFilter.mockResolvedValue({ project: { visibility: 'TEAM' } });

        await service.getPulse(OWNER, undefined);

        expect(db.projectTask.count).toHaveBeenCalledWith({
            where: {
                AND: [
                    { tenant_id: 'tenant-1', deleted_at: null, assignee_id: 'owner-1', status: { category: { not: 'DONE' } } },
                    { project: { visibility: 'TEAM' } },
                ],
            },
        });
    });

    it('shows a member only the apps their permissions open, and never refuses the whole call', async () => {
        everythingHasWork();
        db.userStorePermission.findMany.mockResolvedValue([
            { store_id: 'store-1', permission: 'VIEW_PROJECTS' },
            { store_id: 'store-1', permission: 'LOG_PROJECT_TIME' },
        ]);
        // A member without the branch permission is refused by the branch rule.
        branchScope.resolveStoreId.mockRejectedValue(new ForbiddenException());

        await expect(service.getPulse(PROJECT_USER, undefined)).resolves.toEqual({
            projects: { count: 8, href: '/projects/tasks' },
        });
        expect(db.salesOrder.count).not.toHaveBeenCalled();
        expect(accounting.getPendingVoucherCount).not.toHaveBeenCalled();
    });

    it('leaves out a metric whose query fails and still answers with the rest', async () => {
        everythingHasWork();
        db.leaveRequest.count.mockRejectedValue(new Error('relation does not exist'));

        const pulse = await service.getPulse(OWNER, undefined);

        expect(pulse).not.toHaveProperty('hr');
        expect(pulse.sales).toEqual({ count: 2, href: '/sales/orders' });
    });

    it('says nothing about an app with nothing waiting', async () => {
        everythingHasWork();
        db.salesOrder.count.mockResolvedValue(0);
        crm.summary.mockResolvedValue({ dueToday: 0, overdue: 0, total: 4 });

        const pulse = await service.getPulse(OWNER, undefined);

        expect(pulse).not.toHaveProperty('sales');
        expect(pulse).not.toHaveProperty('crm');
    });

    it('skips a module the plan or the platform does not grant, even for the owner', async () => {
        everythingHasWork();
        entitlements.getFeaturesForTenant.mockResolvedValue({ premiumCrm: true });
        platformSettings.isFeatureEnabledForTenant.mockImplementation(async (feature: string) => feature !== 'projects');

        const pulse = await service.getPulse(OWNER, undefined);

        expect(pulse).not.toHaveProperty('accounting');
        expect(pulse).not.toHaveProperty('manufacturing');
        expect(pulse).not.toHaveProperty('projects');
        expect(pulse.crm).toEqual({ count: 11, href: '/crm/activities' });
        expect(accounting.getPendingVoucherCount).not.toHaveBeenCalled();
    });

    it('scopes branch metrics to the branch the branch rule resolves', async () => {
        everythingHasWork();
        branchScope.resolveStoreId.mockResolvedValue('store-9');

        await service.getPulse(OWNER, 'store-9');

        expect(db.salesOrder.count).toHaveBeenCalledWith({
            where: { tenant_id: 'tenant-1', store_id: 'store-9', status: { in: ['CONFIRMED', 'PROCESSING'] } },
        });
        expect(products.countLowStock).toHaveBeenCalledWith('tenant-1', 'store-9');
    });

    it('answers from the cache, keyed by member and branch, for a minute', async () => {
        redis.get.mockResolvedValue({ sales: { count: 1, href: '/sales/orders' } });

        await expect(service.getPulse(OWNER, 'store-1')).resolves.toEqual({ sales: { count: 1, href: '/sales/orders' } });
        expect(redis.get).toHaveBeenCalledWith('home:pulse:tenant-1:owner-1:store-1');
        expect(db.salesOrder.count).not.toHaveBeenCalled();
    });

    it('keeps each header branch\u2019s counts apart when no branch is asked for', async () => {
        everythingHasWork();

        await service.getPulse({ ...PROJECT_USER, userRole: 'OWNER', storeId: 'store-2' }, undefined);

        // The same member on another branch must not be answered from this entry.
        expect(redis.get).toHaveBeenCalledWith('home:pulse:tenant-1:user-2:header-store-2');
    });
});
