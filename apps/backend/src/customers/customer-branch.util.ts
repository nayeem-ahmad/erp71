import { NotFoundException } from '@nestjs/common';

type DbLike = { customer: { findUnique: (args: any) => Promise<{ store_id: string } | null> } };

/**
 * The branch a customer's credit rows are written under: the customer's own,
 * at the moment of writing. Moving the customer later leaves those rows where
 * they were — see docs/superpowers/specs/2026-10-10-branch-attached-parties-design.md.
 */
export async function customerBranchId(db: DbLike, customerId: string): Promise<string> {
    const customer = await db.customer.findUnique({ where: { id: customerId }, select: { store_id: true } });
    if (!customer) throw new NotFoundException('Customer not found');
    return customer.store_id;
}
