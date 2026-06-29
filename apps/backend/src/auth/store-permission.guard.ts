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
        const storeId: string = request.storeId;
        const tenantId: string = request.tenantId;
        const userRole: string = request.userRole;

        if (!userId || !tenantId) {
            throw new ForbiddenException('Authentication context missing');
        }

        // OWNER bypasses all permission checks
        if (userRole === 'OWNER') {
            return true;
        }

        if (!storeId) {
            throw new BadRequestException('Store context required for this operation');
        }

        // Check each required permission — all must be granted
        const grants = await this.db.userStorePermission.findMany({
            where: {
                user_id: userId,
                store_id: storeId,
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
