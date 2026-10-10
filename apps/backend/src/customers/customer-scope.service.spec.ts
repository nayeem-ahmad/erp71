import { ForbiddenException } from '@nestjs/common';
import { CustomerScopeService } from './customer-scope.service';
import { customerInBranchesWhere, customerScopeWhere, saleScopeWhere } from './customer-visibility';
import { CUSTOMER_READ } from '../auth/permission-sets';
import type { TenantContext } from '../database/tenant.decorator';

const ctx: TenantContext = { tenantId: 'tenant-1', storeId: 'branch-a', userId: 'user-1', timezone: 'Asia/Dhaka' };

describe('customer-visibility', () => {
    // Strict: buying at another branch does not make a customer theirs.
    it('a customer belongs to their own branch only', () => {
        expect(customerInBranchesWhere(['branch-a', 'branch-b'])).toEqual({ store_id: { in: ['branch-a', 'branch-b'] } });
    });

    it('a null scope filters nothing', () => {
        expect(customerScopeWhere(null)).toEqual({});
        expect(saleScopeWhere(null)).toEqual({});
    });

    // The list's search is an OR of its own; a bare OR here would replace it.
    it('wraps the branch rule in AND so it cannot collide with a query OR', () => {
        expect(customerScopeWhere(['branch-a'])).toEqual({ AND: [customerInBranchesWhere(['branch-a'])] });
        expect(saleScopeWhere(['branch-a'])).toEqual({ store_id: { in: ['branch-a'] } });
    });

    it('an empty scope matches no customer rather than every customer', () => {
        expect(customerScopeWhere([])).toEqual({ AND: [customerInBranchesWhere([])] });
    });
});

describe('CustomerScopeService', () => {
    let branchScope: { resolveStoreId: jest.Mock; canSeeAllBranches: jest.Mock; memberStoreIds: jest.Mock };
    let service: CustomerScopeService;

    beforeEach(() => {
        branchScope = {
            resolveStoreId: jest.fn(),
            canSeeAllBranches: jest.fn().mockResolvedValue(false),
            memberStoreIds: jest.fn().mockResolvedValue(['branch-a', 'branch-b']),
        };
        service = new CustomerScopeService(branchScope as any);
    });

    it('omitted: the whole tenant for an owner or consolidated member', async () => {
        branchScope.canSeeAllBranches.mockResolvedValue(true);

        await expect(service.resolve(ctx)).resolves.toBeNull();
        expect(branchScope.memberStoreIds).not.toHaveBeenCalled();
    });

    // Not the header branch alone: the sale screen's picker sends no branch, and
    // a member of two branches must still find the customers of both.
    it('omitted: every branch a limited member may use', async () => {
        await expect(service.resolve(ctx)).resolves.toEqual(['branch-a', 'branch-b']);
        await expect(service.resolve(ctx, '  ')).resolves.toEqual(['branch-a', 'branch-b']);
    });

    it('`all`: the whole tenant once the branch scope allows it', async () => {
        branchScope.resolveStoreId.mockResolvedValue(undefined);

        await expect(service.resolve(ctx, 'all')).resolves.toBeNull();
        expect(branchScope.resolveStoreId).toHaveBeenCalledWith(ctx, 'all', { permissions: CUSTOMER_READ });
    });

    it('`all` for a limited member is refused, not narrowed', async () => {
        branchScope.resolveStoreId.mockRejectedValue(new ForbiddenException());

        await expect(service.resolve(ctx, 'all')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('a branch id: that branch alone, checked against the member', async () => {
        branchScope.resolveStoreId.mockResolvedValue('branch-b');

        await expect(service.resolve(ctx, 'branch-b')).resolves.toEqual(['branch-b']);
        expect(branchScope.resolveStoreId).toHaveBeenCalledWith(ctx, 'branch-b', { permissions: CUSTOMER_READ });
    });

    it('a branch the member may not use is refused', async () => {
        branchScope.resolveStoreId.mockRejectedValue(new ForbiddenException());

        await expect(service.resolve(ctx, 'branch-c')).rejects.toBeInstanceOf(ForbiddenException);
    });
});
