import { StorePermission } from '@erp71/shared-types';
import { TenantContext } from '../database/tenant.decorator';

export async function hasStorePermission(db: any, ctx: TenantContext, permission: StorePermission): Promise<boolean> {
    if (ctx.userRole === 'OWNER') return true;
    if (!ctx.storeId) return false;
    const grant = await db.userStorePermission.findFirst({
        where: { user_id: ctx.userId, store_id: ctx.storeId, tenant_id: ctx.tenantId, permission: permission as any },
        select: { id: true },
    });
    return Boolean(grant);
}

export async function hasAnyStorePermission(db: any, ctx: TenantContext, permissions: StorePermission[]): Promise<boolean> {
    if (ctx.userRole === 'OWNER') return true;
    for (const p of permissions) {
        if (await hasStorePermission(db, ctx, p)) return true;
    }
    return false;
}