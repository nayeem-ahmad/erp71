import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/** A brand-new workspace's first branch. */
export const FIRST_STORE_CODE = 'S1';

const AUTO_CODE = /^S(\d{1,5})$/;

/**
 * The next free automatic branch code for a tenant: `S<n>` one past the
 * highest it holds. Codes an owner typed (`DHK`) are ignored, so they never
 * push the sequence around; the unique index on (tenant_id, code) has the
 * final word if two branches are created at the same instant.
 */
export async function nextStoreCode(tx: Prisma.TransactionClient, tenantId: string): Promise<string> {
    const stores = await tx.store.findMany({
        where: { tenant_id: tenantId, code: { not: null } },
        select: { code: true },
    });
    let highest = 0;
    for (const { code } of stores) {
        const match = code ? AUTO_CODE.exec(code) : null;
        if (match) highest = Math.max(highest, Number(match[1]));
    }
    return `S${highest + 1}`;
}

/**
 * The branch's code, assigning one first if it has none. Branches get a code
 * at creation and existing ones are back-filled (`sync:store-code`), so this
 * only does work for a row created by a path that predates both.
 *
 * The write is conditional on the code still being empty, so two sales racing
 * through here for the same branch both end up reading the one code that won.
 */
export async function ensureStoreCode(
    tx: Prisma.TransactionClient,
    tenantId: string,
    storeId: string,
): Promise<string> {
    const store = await tx.store.findFirst({
        where: { id: storeId, tenant_id: tenantId },
        select: { code: true },
    });
    if (!store) {
        throw new BadRequestException('Store not found.');
    }
    if (store.code) return store.code;

    const code = await nextStoreCode(tx, tenantId);
    await tx.store.updateMany({
        where: { id: storeId, tenant_id: tenantId, code: null },
        data: { code },
    });
    const assigned = await tx.store.findFirst({
        where: { id: storeId, tenant_id: tenantId },
        select: { code: true },
    });
    return assigned?.code ?? code;
}
