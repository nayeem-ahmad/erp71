import { Injectable } from '@nestjs/common';
import type { StorePermission } from '@erp71/shared-types';
import { DatabaseService } from '../database/database.service';

/**
 * Who can decide an entry: the workspace's owners, and every member granted
 * [permission] — in [storeId] when the entry belongs to a branch, anywhere in
 * the workspace when it does not. The same rule StorePermissionGuard applies
 * to the approve endpoint, read the other way round.
 */
@Injectable()
export class ApproverDirectory {
    constructor(private readonly db: DatabaseService) {}

    async userIds(tenantId: string, permission: StorePermission, storeId?: string | null): Promise<string[]> {
        const [owners, granted] = await Promise.all([
            this.db.tenantUser.findMany({
                where: { tenant_id: tenantId, role: 'OWNER' },
                select: { user_id: true },
            }),
            this.db.userStorePermission.findMany({
                where: { tenant_id: tenantId, permission, ...(storeId ? { store_id: storeId } : {}) },
                select: { user_id: true },
            }),
        ]);
        return [...new Set([...owners, ...granted].map((row) => row.user_id))];
    }
}
