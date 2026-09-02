import {
    Injectable,
    NestInterceptor,
    ExecutionContext,
    CallHandler,
    BadRequestException,
    ForbiddenException,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { DatabaseService } from '../database/database.service';
import { TenantTimezoneService } from './tenant-timezone.service';

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

        if (tenantId) {
            const membership = await this.db.tenantUser.findFirst({
                where: {
                    tenant_id: tenantId as string,
                    user_id: userId,
                    tenant: { deleted_at: null },
                },
                // `timezone` rides along on a query that already runs. It is
                // needed by nearly every endpoint downstream, so fetching it
                // here costs a column on an existing join rather than a second
                // round trip per request.
                select: { tenant_id: true, role: true, tenant: { select: { timezone: true } } },
            });

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
        } else {
            const memberships = await this.db.tenantUser.findMany({
                where: { user_id: userId, tenant: { deleted_at: null } },
                select: { tenant_id: true, role: true, tenant: { select: { timezone: true } } },
                take: 2,
            });

            if (memberships.length === 1) {
                resolvedTenantId = memberships[0].tenant_id;
                request.userRole = memberships[0].role;
                request.timezone = memberships[0].tenant?.timezone ?? undefined;
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
            // Auto-resolve: if user has exactly one store in this tenant, set it automatically
            const userStoreAccess = await this.db.userStoreAccess.findMany({
                where: { user_id: userId, tenant_id: resolvedTenantId },
                select: { store_id: true },
                take: 2,
            });

            if (userStoreAccess.length === 1) {
                request.storeId = userStoreAccess[0].store_id;
            }
            // If 0 or >1, storeId stays undefined — endpoints that need it will demand the header
        }

        return next.handle();
    }
}
