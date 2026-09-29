import {
    Injectable,
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    BadRequestException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { StorePermission } from '@erp71/shared-types';
import { DatabaseService } from '../database/database.service';
import { STORE_PERMISSIONS_KEY } from './store-permission.decorator';

@Injectable()
export class StorePermissionGuard implements CanActivate {
    constructor(
        private reflector: Reflector,
        private db: DatabaseService,
    ) { }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const required = this.reflector.getAllAndOverride<StorePermission[]>(
            STORE_PERMISSIONS_KEY,
            [context.getHandler(), context.getClass()],
        );

        // No permissions required — allow through
        if (!required || required.length === 0) {
            return true;
        }

        const request = context.switchToHttp().getRequest();
        const userId: string = request.user?.userId;
        const tenantIdHeader = request.headers['x-tenant-id'];
        const storeIdHeader = request.headers['x-store-id'];
        let tenantId: string = request.tenantId ?? (Array.isArray(tenantIdHeader) ? tenantIdHeader[0] : tenantIdHeader);
        let storeId: string = request.storeId ?? (Array.isArray(storeIdHeader) ? storeIdHeader[0] : storeIdHeader);
        let userRole: string = request.userRole;

        if (!userId || !tenantId) {
            throw new ForbiddenException('Authentication context missing');
        }

        // Guards run before TenantInterceptor — resolve membership when context is not pre-set.
        if (!userRole) {
            const membership = await this.db.tenantUser.findUnique({
                where: {
                    tenant_id_user_id: {
                        tenant_id: tenantId,
                        user_id: userId,
                    },
                },
            });

            if (!membership) {
                throw new ForbiddenException('Invalid tenant context');
            }

            userRole = membership.role;
            request.userRole = userRole;
        }

        request.tenantId = tenantId;

        // OWNER bypasses all permission checks
        if (userRole === 'OWNER') {
            return true;
        }

        if (!storeId) {
            const userStoreAccess = await this.db.userStoreAccess.findMany({
                where: { user_id: userId, tenant_id: tenantId },
                select: { store_id: true },
                take: 2,
            });

            if (userStoreAccess.length === 1) {
                storeId = userStoreAccess[0].store_id;
            }
        }

        if (!storeId) {
            throw new BadRequestException('Store context required for this operation');
        }

        request.storeId = storeId;

        // Check each required permission — all must be granted
        // Scoped to the workspace being accessed, not only the store. The store id
        // is a request header, and a member can own a workspace — and a store with
        // every permission — of their own; without `tenant_id` here, sending that
        // store's id would satisfy every check in a workspace they merely belong to.
        const grants = await this.db.userStorePermission.findMany({
            where: {
                user_id: userId,
                store_id: storeId,
                tenant_id: tenantId,
                permission: { in: required as any[] },
            },
            select: { permission: true },
        });

        const grantedSet = new Set(grants.map((g) => g.permission));
        const missing = required.filter((p) => !grantedSet.has(p as any));

        if (missing.length > 0) {
            throw new ForbiddenException(
                `Missing store permissions: ${missing.join(', ')}`,
            );
        }

        return true;
    }
}
