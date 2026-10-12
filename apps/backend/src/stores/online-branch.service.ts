import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { UserRole } from '@erp71/shared-types';
import { nextOnlineStoreName } from './online-branch-name';
import { AuthCacheService } from '../database/auth-cache.service';
import { DatabaseService } from '../database/database.service';
import { nextStoreCode } from './store-code.util';

/**
 * The branch the online storefront belongs to: every customer it signs up and
 * every order it takes. One per tenant (`Tenant.online_store_id`, unique),
 * created the first time the storefront needs it — by the same rules as
 * `sync-party-branch.ts`, which creates it for tenants that had storefront
 * data before this existed.
 *
 * It is an ordinary `Store` otherwise: it gets a store code, and every owner an
 * access row, because `/auth/me` lists a member's branches from those rows
 * alone. It is not counted against the plan's `maxStores`
 * (`PlanEntitlementsService.assertStoreQuota`) — it is not a shop, and a
 * one-shop plan must still be able to run a storefront.
 */
@Injectable()
export class OnlineBranchService {
    constructor(
        private readonly db: DatabaseService,
        private readonly authCache: AuthCacheService,
    ) {}

    /** The tenant's online branch id, creating it on first need. */
    async ensure(tenantId: string): Promise<string> {
        const existing = await this.current(tenantId);
        if (existing) return existing;

        try {
            const id = await this.db.$transaction((tx) => ensureOnlineBranchInTx(tx, tenantId));
            // Every owner's branch list just grew; their cached access must say so.
            this.authCache.invalidateTenant(tenantId);
            return id;
        } catch (error) {
            // A unique conflict means another request got there first.
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
                const winner = await this.current(tenantId);
                if (winner) return winner;
            }
            throw error;
        }
    }

    /** The online branch id, or null when the storefront has not needed one yet. */
    async current(tenantId: string): Promise<string | null> {
        const tenant = await this.db.tenant.findUnique({ where: { id: tenantId }, select: { online_store_id: true } });
        return tenant?.online_store_id ?? null;
    }
}

/**
 * The transaction half of `OnlineBranchService.ensure`, for a caller already
 * inside one (the demo-data generator). The caller is responsible for
 * invalidating cached access afterwards if it created the branch.
 */
export async function ensureOnlineBranchInTx(tx: Prisma.TransactionClient, tenantId: string): Promise<string> {
    // Two first sign-ups at once must not make two branches: the tenant row is
    // the lock, and whoever waited re-reads it.
    await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${tenantId} FOR UPDATE`;
    const again = await tx.tenant.findUnique({ where: { id: tenantId }, select: { online_store_id: true } });
    if (again?.online_store_id) return again.online_store_id;

    const names = await tx.store.findMany({ where: { tenant_id: tenantId }, select: { name: true } });
    const store = await tx.store.create({
        data: {
            tenant_id: tenantId,
            name: nextOnlineStoreName(names.map((row) => row.name)),
            code: await nextStoreCode(tx, tenantId),
        },
        select: { id: true },
    });
    const owners = await tx.tenantUser.findMany({
        where: { tenant_id: tenantId, role: UserRole.OWNER },
        select: { user_id: true },
    });
    await tx.userStoreAccess.createMany({
        data: owners.map((owner) => ({
            user_id: owner.user_id,
            store_id: store.id,
            tenant_id: tenantId,
            access_level: 'MULTI_STORE_CAPABLE',
        })),
        skipDuplicates: true,
    });
    await tx.tenant.update({ where: { id: tenantId }, data: { online_store_id: store.id } });
    return store.id;
}
