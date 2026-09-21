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

@Injectable()
export class TenantInterceptor implements NestInterceptor {
    constructor(
        private db: DatabaseService,
        private timezones: TenantTimezoneService,
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
        let prefetchedStoreRows: { store_id: string }[] | undefined;

        if (tenantId) {
            // The header already names the tenant, so the auto-resolve store
            // lookup — which needs nothing but the user and that tenant, and
            // runs whatever the member's role — does not have to wait for the
            // membership read. Issued together, the two cost one round trip
            // instead of two.
            //
            // The `storeId`-present case is left out on purpose: there the
            // lookup is skipped entirely for owners, so starting it here would
            // trade a saved round trip for a query thrown away.
            const [loaded, storeRows] = await Promise.all([
                // Shared with `SubscriptionAccessGuard` and `TenantRoleGuard`,
                // which run before this interceptor and read the same row.
                // Whichever gets there first pays for it; the rest read it back
                // off the request.
                loadTenantMembership(this.db, request, tenantId as string, userId),
                storeId
                    ? undefined
                    : this.db.userStoreAccess.findMany({
                          where: { user_id: userId, tenant_id: tenantId as string },
                          select: { store_id: true },
                          take: 2,
                      }),
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
            // OWNER bypasses store access check (they own all stores in their tenant)
            if (!isOwner) {
                const access = await this.db.userStoreAccess.findUnique({
                    where: {
                        user_id_store_id: {
                            user_id: userId,
                            store_id: storeId as string,
                        },
                    },
                    select: { store_id: true, access_level: true },
                });

                if (!access) {
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
                (await this.db.userStoreAccess.findMany({
                    where: { user_id: userId, tenant_id: resolvedTenantId },
                    select: { store_id: true },
                    take: 2,
                }));

            if (userStoreAccess.length === 1) {
                request.storeId = userStoreAccess[0].store_id;
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
