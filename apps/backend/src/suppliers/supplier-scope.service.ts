import { Injectable } from '@nestjs/common';
import { BranchScopeService } from '../database/branch-scope.service';
import { TenantContext } from '../database/tenant.decorator';
import { SUPPLIER_READ } from '../auth/permission-sets';
import type { SupplierScope } from './supplier-visibility';

/**
 * The suppliers a request may reach — see `supplier-visibility.ts`. Same rule
 * as `CustomerScopeService`: a requested branch narrows to it (checked like
 * every branch-aware read); otherwise owners and consolidated-report holders
 * see every branch and everyone else their own.
 */
@Injectable()
export class SupplierScopeService {
    constructor(private readonly branchScope: BranchScopeService) {}

    async resolve(ctx: TenantContext, requested?: string | null): Promise<SupplierScope> {
        const wanted = typeof requested === 'string' ? requested.trim() : '';
        if (wanted) {
            const storeId = await this.branchScope.resolveStoreId(ctx, wanted, { permissions: SUPPLIER_READ });
            return storeId ? [storeId] : null;
        }
        if (await this.canSeeAll(ctx)) return null;
        return this.branchScope.memberStoreIds(ctx);
    }

    canSeeAll(ctx: TenantContext): Promise<boolean> {
        return this.branchScope.canSeeAllBranches(ctx);
    }
}
