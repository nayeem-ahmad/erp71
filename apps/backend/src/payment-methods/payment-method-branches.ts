import type { Prisma } from '@prisma/client';

/**
 * A payment method is available at branch S when it is active and is either
 * offered at every branch or has a `PaymentMethodStore` row for S. With several
 * ids it is available at any of them (a member's own branches). One definition,
 * spread into `where` clauses by the listing and by tender enforcement.
 */
export function availableAt(storeIds: string[]): Prisma.PaymentMethodWhereInput {
  return {
    is_active: true,
    OR: [{ all_branches: true }, { stores: { some: { store_id: { in: storeIds } } } }],
  };
}

/** The same rule as `availableAt`, for a method row already in memory. */
export function isAvailableAt(
  m: { is_active: boolean; all_branches: boolean; stores: { store_id: string }[] },
  storeId: string,
): boolean {
  return m.is_active && (m.all_branches || m.stores.some((s) => s.store_id === storeId));
}
