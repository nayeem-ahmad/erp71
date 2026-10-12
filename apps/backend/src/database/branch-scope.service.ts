import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { StorePermission } from '@erp71/shared-types';
import { DatabaseService } from './database.service';
import { AuthCacheService } from './auth-cache.service';
import { TenantContext } from './tenant.decorator';
import { loadMemberStoreAccess, loadMemberStoreGrants, storeBelongsToTenant } from './member-access.loader';

/** The `storeId` value a branch-aware read sends to ask for every branch. */
export const ALL_BRANCHES = 'all';

export type BranchScopeOptions = {
    /**
     * Any-of read permissions the member must hold in the branch they asked for.
     * `StorePermissionGuard` checks the endpoint's permissions in the *header*
     * branch; a query branch is a different one, and per-branch grants can
     * differ, so the same set is checked again there. Pass the set the route's
     * `@RequireAnyStorePermission` names.
     */
    permissions?: readonly StorePermission[];
    /**
     * `false` for reads that are one branch by nature (daily report, branch
     * report, cashier sessions): `all` is refused, and an omitted id is the
     * header branch for everyone, owners included.
     */
    allowAll?: boolean;
};

/**
 * Which branch(es) a branch-aware read may cover, decided once for every
 * endpoint. Spec: `docs/superpowers/specs/2026-10-05-branch-filter-design.md`.
 *
 * The header branch (`x-store-id`) is validated by `TenantInterceptor`; a
 * `storeId` in the query, path or body is not, and before this every report
 * trusted it — a member of branch A could read branch B by naming it. Every
 * branch-aware read now runs its requested id through here:
 *
 * | requested | allowed when                                         | result          |
 * |-----------|------------------------------------------------------|-----------------|
 * | branch S  | owner and S is the tenant's; or member with access to S and one of `permissions` there | `S` |
 * | `all`     | owner, or `VIEW_CONSOLIDATED_REPORTS` in the header branch | `undefined` (whole tenant) |
 * | omitted   | always — consolidated callers get the whole tenant (what every endpoint did before, kept for old clients, the AI tools and scripts), everyone else the header branch | |
 *
 * Built only from the cached loaders in `member-access.loader.ts`, so the
 * common case costs no extra round trip: the guard and the interceptor have
 * usually read the same entries for this request already.
 */
@Injectable()
export class BranchScopeService {
    constructor(
        private readonly db: DatabaseService,
        private readonly authCache: AuthCacheService,
    ) { }

    /** `undefined` = the whole tenant; otherwise one validated branch id. */
    async resolveStoreId(
        ctx: TenantContext,
        requested: string | null | undefined,
        opts: BranchScopeOptions = {},
    ): Promise<string | undefined> {
        const allowAll = opts.allowAll !== false;
        const wanted = typeof requested === 'string' ? requested.trim() : '';

        if (wanted === ALL_BRANCHES) {
            if (!allowAll) {
                throw new BadRequestException('This report covers one branch at a time.');
            }
            if (!(await this.canSeeAllBranches(ctx))) {
                throw new ForbiddenException('VIEW_CONSOLIDATED_REPORTS permission required to view all branches.');
            }
            return undefined;
        }

        if (!wanted) {
            if (allowAll && (await this.canSeeAllBranches(ctx))) {
                return undefined;
            }
            if (!ctx.storeId) {
                throw new BadRequestException('Store context required for this operation');
            }
            return ctx.storeId;
        }

        await this.assertBranchAccess(ctx, wanted, opts.permissions);
        return wanted;
    }

    /** Compare mode: every id must pass the single-branch rule. */
    async resolveStoreIds(
        ctx: TenantContext,
        requested: readonly string[],
        opts: BranchScopeOptions = {},
    ): Promise<string[]> {
        const ids = [...new Set(requested.map((id) => id.trim()).filter(Boolean))];
        for (const id of ids) {
            if (id === ALL_BRANCHES) {
                throw new BadRequestException('Name the branches to compare.');
            }
            await this.assertBranchAccess(ctx, id, opts.permissions);
        }
        return ids;
    }

    /** Every branch the member may use — their `UserStoreAccess` rows. */
    async memberStoreIds(ctx: TenantContext): Promise<string[]> {
        if (!ctx.userId) return [];
        const access = await loadMemberStoreAccess(this.db, this.authCache, ctx.userId, ctx.tenantId);
        return access.map((row) => row.store_id);
    }

    /** Owner, or `VIEW_CONSOLIDATED_REPORTS` held in the header branch. */
    async canSeeAllBranches(ctx: TenantContext): Promise<boolean> {
        if (ctx.userRole === 'OWNER') return true;
        if (!ctx.storeId || !ctx.userId) return false;
        const grants = await loadMemberStoreGrants(this.db, this.authCache, ctx.userId, ctx.tenantId);
        return grants.get(ctx.storeId)?.has(StorePermission.VIEW_CONSOLIDATED_REPORTS) ?? false;
    }

    private async assertBranchAccess(
        ctx: TenantContext,
        storeId: string,
        permissions?: readonly StorePermission[],
    ): Promise<void> {
        if (ctx.userRole === 'OWNER') {
            if (!(await storeBelongsToTenant(this.db, this.authCache, ctx.tenantId, storeId))) {
                throw new ForbiddenException('You do not have access to this branch');
            }
            return;
        }

        if (!ctx.userId) {
            throw new ForbiddenException('You do not have access to this branch');
        }

        const access = await loadMemberStoreAccess(this.db, this.authCache, ctx.userId, ctx.tenantId);
        if (!access.some((row) => row.store_id === storeId)) {
            throw new ForbiddenException('You do not have access to this branch');
        }

        if (permissions && permissions.length > 0) {
            const grants = await loadMemberStoreGrants(this.db, this.authCache, ctx.userId, ctx.tenantId);
            const held = grants.get(storeId);
            if (!held || !permissions.some((permission) => held.has(permission))) {
                throw new ForbiddenException('You do not have access to this branch');
            }
        }
    }
}
