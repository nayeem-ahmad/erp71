import { Injectable } from '@nestjs/common';
import { BranchScopeService } from '../database/branch-scope.service';
import { TenantContext } from '../database/tenant.decorator';
import { CUSTOMER_READ } from '../auth/permission-sets';
import type { CustomerScope } from './customer-visibility';

/**
 * Decides a request's `CustomerScope` — see `customer-visibility.ts`.
 *
 * | requested     | result                                                        |
 * |---------------|---------------------------------------------------------------|
 * | omitted       | whole tenant for owners / consolidated, else the member's branches |
 * | `all`         | whole tenant; 403 unless owner / consolidated                 |
 * | a branch id   | that branch, once the member is checked against it            |
 *
 * Omitted is what every customer picker sends, which is why it differs from
 * `BranchScopeService.resolveStoreId`: there a limited member's omitted id is
 * the header branch alone, which would hide the customers of their other
 * branches from the sale screen.
 */
@Injectable()
export class CustomerScopeService {
    constructor(private readonly branchScope: BranchScopeService) {}

    async resolve(ctx: TenantContext, requested?: string | null): Promise<CustomerScope> {
        const wanted = typeof requested === 'string' ? requested.trim() : '';
        if (wanted) {
            const storeId = await this.branchScope.resolveStoreId(ctx, wanted, { permissions: CUSTOMER_READ });
            return storeId ? [storeId] : null;
        }
        if (await this.canSeeAll(ctx)) return null;
        return this.branchScope.memberStoreIds(ctx);
    }

    /** Owner, or `VIEW_CONSOLIDATED_REPORTS` in the header branch. */
    canSeeAll(ctx: TenantContext): Promise<boolean> {
        return this.branchScope.canSeeAllBranches(ctx);
    }
}
