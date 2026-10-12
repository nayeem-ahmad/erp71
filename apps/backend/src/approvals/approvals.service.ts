import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { AuthCacheService } from '../database/auth-cache.service';
import { loadMemberStoreGrants } from '../database/member-access.loader';
import type { TenantContext } from '../database/tenant.decorator';
import { APPROVAL_KINDS, APPROVAL_REQUIRES, type ApprovalItem, type ApprovalKind } from './approval-kinds';
import {
    type ApprovalProvider,
    type BranchScope,
    ExpenseClaimApprovals,
    LeaveRequestApprovals,
    ProductDemandApprovals,
    VoucherApprovals,
    WarehouseTransferApprovals,
} from './approval-providers';

/**
 * The phone's approvals inbox: every entry waiting for this person's decision,
 * across the modules that have one, and deciding it.
 *
 * What a person may decide is what the kind's own endpoint would let them:
 * owners everything; a member each kind for which they hold the required
 * permissions in some branch — and, for entries that belong to a branch, only
 * the entries of branches where they hold them.
 */
@Injectable()
export class ApprovalsService {
    private readonly providers: ReadonlyMap<ApprovalKind, ApprovalProvider>;

    constructor(
        private readonly db: DatabaseService,
        private readonly authCache: AuthCacheService,
        expenseClaims: ExpenseClaimApprovals,
        leaveRequests: LeaveRequestApprovals,
        productDemands: ProductDemandApprovals,
        warehouseTransfers: WarehouseTransferApprovals,
        vouchers: VoucherApprovals,
    ) {
        this.providers = new Map(
            [expenseClaims, leaveRequests, productDemands, warehouseTransfers, vouchers].map((p) => [p.kind, p]),
        );
    }

    async inbox(ctx: TenantContext) {
        const scopes = await this.scopes(ctx);
        const lists = await Promise.all(
            [...scopes.entries()].map(([kind, scope]) => this.providers.get(kind)!.pending(ctx.tenantId, scope)),
        );
        const items: ApprovalItem[] = lists
            .flat()
            .sort((a, b) => new Date(a.requested_at).getTime() - new Date(b.requested_at).getTime());
        const counts = Object.fromEntries([...scopes.keys()].map((kind) => [kind, 0])) as Partial<Record<ApprovalKind, number>>;
        for (const item of items) counts[item.kind] = (counts[item.kind] ?? 0) + 1;
        return { items, counts, total: items.length, kinds: [...scopes.keys()] };
    }

    async approve(ctx: TenantContext, kind: string, id: string, note?: string) {
        const provider = await this.authorise(ctx, kind, id);
        await provider.approve({ tenantId: ctx.tenantId, userId: ctx.userId }, id, note?.trim() || undefined);
        return { kind, id, decision: 'APPROVED' };
    }

    async reject(ctx: TenantContext, kind: string, id: string, reason: string) {
        const provider = await this.authorise(ctx, kind, id);
        await provider.reject({ tenantId: ctx.tenantId, userId: ctx.userId }, id, reason.trim());
        return { kind, id, decision: 'REJECTED' };
    }

    private async authorise(ctx: TenantContext, kind: string, id: string): Promise<ApprovalProvider> {
        const provider = this.providers.get(kind as ApprovalKind);
        if (!provider) throw new NotFoundException('Unknown kind of approval.');
        const scope = (await this.scopes(ctx)).get(provider.kind);
        if (scope === undefined) {
            throw new ForbiddenException('Your role cannot decide this kind of entry.');
        }
        // Also the not-found check, before anything is decided.
        const branch = await provider.branchOf(ctx.tenantId, id);
        if (provider.branchHeld && scope && branch && !scope.includes(branch)) {
            throw new ForbiddenException('That entry belongs to a branch where you cannot approve.');
        }
        return provider;
    }

    /** Kind → the branch scope the caller may decide it in; absent = not at all. */
    private async scopes(ctx: TenantContext): Promise<Map<ApprovalKind, BranchScope>> {
        const result = new Map<ApprovalKind, BranchScope>();
        if (ctx.userRole === 'OWNER') {
            for (const kind of APPROVAL_KINDS) result.set(kind, null);
            return result;
        }
        const grants = await loadMemberStoreGrants(this.db, this.authCache, ctx.userId, ctx.tenantId);
        for (const kind of APPROVAL_KINDS) {
            const required = APPROVAL_REQUIRES[kind];
            const stores = [...grants.entries()]
                .filter(([, held]) => required.every((permission) => held.has(permission)))
                .map(([storeId]) => storeId);
            if (stores.length === 0) continue;
            result.set(kind, this.providers.get(kind)!.branchHeld ? stores : null);
        }
        return result;
    }
}
