import { NotFoundException } from '@nestjs/common';

type DbLike = { supplier: { findUnique: (args: any) => Promise<{ store_id: string } | null> } };

/**
 * The branch a supplier's credit rows are written under: the supplier's own,
 * at the moment of writing. Moving the supplier later leaves those rows where
 * they were — see docs/superpowers/specs/2026-10-10-branch-attached-parties-design.md.
 */
export async function supplierBranchId(db: DbLike, supplierId: string): Promise<string> {
    const supplier = await db.supplier.findUnique({ where: { id: supplierId }, select: { store_id: true } });
    if (!supplier) throw new NotFoundException('Supplier not found');
    return supplier.store_id;
}
