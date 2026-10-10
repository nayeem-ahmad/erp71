import { BadRequestException } from '@nestjs/common';

type DbLike = { store: { findMany: (args: any) => Promise<{ id: string; name: string; code: string | null }[]> } };

/**
 * Reads the `branch` column of a customer or supplier CSV: a branch's code
 * (`DHK`) or its name (`Dhaka`), either case. Built once per import — the
 * tenant's branches are read once — and called per row; a row whose branch is
 * unknown, or one the importer may not use, fails on its own (`runImport`
 * records the message against that row and carries on).
 *
 * `allowed` is the importer's branches; null means every branch (owners and
 * `VIEW_CONSOLIDATED_REPORTS` holders).
 */
export async function makeImportBranchResolver(
    db: DbLike,
    tenantId: string,
    allowed: readonly string[] | null,
): Promise<(label: string | null | undefined) => string | null> {
    const stores = await db.store.findMany({
        where: { tenant_id: tenantId },
        select: { id: true, name: true, code: true },
    });
    const byKey = new Map<string, string>();
    for (const store of stores) {
        byKey.set(store.name.trim().toLowerCase(), store.id);
        if (store.code) byKey.set(store.code.trim().toLowerCase(), store.id);
    }

    return (label) => {
        const key = label?.trim().toLowerCase();
        if (!key) return null;
        const id = byKey.get(key);
        if (!id) throw new BadRequestException(`unknown branch "${label!.trim()}"`);
        if (allowed && !allowed.includes(id)) {
            throw new BadRequestException(`branch "${label!.trim()}" is not one you can add to`);
        }
        return id;
    };
}
