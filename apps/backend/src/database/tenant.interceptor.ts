import {
    Injectable,
    NestInterceptor,
    ExecutionContext,
    CallHandler,
    BadRequestException,
    ForbiddenException,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { TenantRecordScope, resolveRecordScope } from '@erp71/shared-types';
import { DatabaseService } from '../database/database.service';
import { TenantTimezoneService } from './tenant-timezone.service';
import { loadTenantMembership } from './tenant-membership.loader';
import { AuthCacheService } from './auth-cache.service';
import {
    MemberStoreAccess,
    loadMemberStoreAccess,
    soleStoreId,
    storeBelongsToTenant,
} from './member-access.loader';

@Injectable()
export class TenantInterceptor implements NestInterceptor {
    constructor(
        private db: DatabaseService,
        private timezones: TenantTimezoneService,
        private authCache: AuthCacheService,
    ) { }

    async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
        const request = context.switchToHttp().getRequest();
        const userId = request.user?.userId;

        if (!userId) {
            return next.handle();
        }

        const tenantId = request.headers['x-tenant-id'];
        const storeId = request.headers['x-store-id'];

        // --- Resolve & validate tenant ---
        let resolvedTenantId: string;
        // Filled by the parallel read below, for the store section to use
        // instead of issuing the same query a round trip later.
        let prefetchedStoreRows: readonly MemberStoreAccess[] | undefined;

        if (tenantId) {
            // The header already names the tenant, so the auto-resolve store
            // lookup — which needs nothing but the user and that tenant, and
            // runs whatever the member's role — does not have to wait for the
            // membership read. Issued together, the two cost one round trip
            // instead of two.
            //
            // The `storeId`-present case is left out on purpose: there the
            // check depends on the role (an owner's store is checked against
            // the workspace, anyone else's against their access list), so it
            // cannot start before the membership read says which one to run.
            const [loaded, storeRows] = await Promise.all([
                // Shared with `SubscriptionAccessGuard` and `TenantRoleGuard`,
                // which run before this interceptor and read the same row.
                // Whichever gets there first pays for it; the rest read it back
                // off the request.
                loadTenantMembership(this.db, request, tenantId as string, userId, this.authCache),
                storeId ? undefined : loadMemberStoreAccess(this.db, this.authCache, userId, tenantId as string),
            ]);
            prefetchedStoreRows = storeRows ?? undefined;

            // A member of a soft-deleted tenant counts as no member at all, as
            // it did when this read carried `tenant: { deleted_at: null }`.
            const membership = loaded && loaded.tenant?.deleted_at == null ? loaded : null;

            if (!membership) {
                // Forbidden, not Unauthorized: the caller is signed in perfectly
                // well, they just asked for a workspace they are not in — a tab
                // resuming a shop they have since left, or a stale header. The
                // frontend treats 401 as "your session is over" and bounces to
                // the login page, which would turn a wrong header into a
                // spurious sign-out.
                throw new ForbiddenException('Invalid tenant context');
            }

            resolvedTenantId = tenantId as string;
            request.userRole = membership.role;
            request.timezone = membership.tenant?.timezone ?? undefined;
            request.recordScope = resolveMemberRecordScope(membership);
        } else {
            const memberships = await this.db.tenantUser.findMany({
                where: { user_id: userId, tenant: { deleted_at: null } },
                select: {
                    tenant_id: true,
                    role: true,
                    tenant: { select: { timezone: true } },
                    roles: { select: { tenantRole: { select: { record_scope: true } } } },
                },
                take: 2,
            });

            if (memberships.length === 1) {
                resolvedTenantId = memberships[0].tenant_id;
                request.userRole = memberships[0].role;
                request.timezone = memberships[0].tenant?.timezone ?? undefined;
                request.recordScope = resolveMemberRecordScope(memberships[0]);
            } else if (memberships.length > 1) {
                throw new BadRequestException('Tenant context is required for this request.');
            } else {
                return next.handle();
            }
        }

        request.tenantId = resolvedTenantId;
        // Seeds the shared cache so the cron paths and any service that resolves
        // the zone by tenant id get this request's read for free.
        if (request.timezone) this.timezones.prime(resolvedTenantId, request.timezone);

        // --- Resolve & validate store ---
        const isOwner = request.userRole === 'OWNER';

        if (storeId) {
            // The store id is a request header, so it is checked against the workspace
            // the request resolved to, for everyone. Without that, a member of workspace
            // A who owns a workspace B could send B's store id (which holds every
            // permission for them) and have it accepted as a store of A.
            if (isOwner) {
                // OWNER may use any store — of their own workspace.
                if (!(await storeBelongsToTenant(this.db, this.authCache, resolvedTenantId, storeId as string))) {
                    throw new ForbiddenException('You do not have access to this store');
                }
            } else {
                // The member's whole access list in this workspace, cached, rather
                // than a lookup of this one store: the next request usually names
                // the same store, and the guard reads the same list.
                const access = await loadMemberStoreAccess(this.db, this.authCache, userId, resolvedTenantId);

                if (!access.some((row) => row.store_id === storeId)) {
                    throw new ForbiddenException('You do not have access to this store');
                }
            }

            request.storeId = storeId as string;
        } else {
            // Auto-resolve: if user has exactly one store in this tenant, set it automatically.
            // Already in flight when the tenant came from the header (see above);
            // the no-header path resolves the tenant too late for that, so it
            // still issues the read here.
            const userStoreAccess =
                prefetchedStoreRows ??
                (await loadMemberStoreAccess(this.db, this.authCache, userId, resolvedTenantId));

            const sole = soleStoreId(userStoreAccess);
            if (sole) {
                request.storeId = sole;
            }
            // If 0 or >1, storeId stays undefined — endpoints that need it will demand the header
        }

        return next.handle();
    }
}

/**
 * The record scope a membership resolves to: the widest of the roles it holds.
 *
 * OWNER is always `ALL` — they bypass every permission check downstream, so
 * narrowing their reads would be the one restriction in the app they could not
 * lift. A member with no roles is `ALL` too (see `resolveRecordScope`): they
 * hold no permissions either, so there is nothing for a scope to narrow.
 */
function resolveMemberRecordScope(membership: {
    role: string;
    roles?: { tenantRole: { record_scope: TenantRecordScope } }[];
}): TenantRecordScope {
    if (membership.role === 'OWNER') return TenantRecordScope.ALL;
    return resolveRecordScope((membership.roles ?? []).map((row) => row.tenantRole.record_scope));
}
