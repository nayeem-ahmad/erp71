import type { Prisma } from '@prisma/client';

/**
 * A payment method is offered at branch S when it is for every branch or has a
 * `PaymentMethodStore` row for S, active or not. With several ids it is offered
 * at any of them (a member's own branches). The settings list uses this alone:
 * an inactive method must stay visible there so it can be reactivated.
 */
export function offeredAt(storeIds: string[]): Prisma.PaymentMethodWhereInput {
  return {
    OR: [{ all_branches: true }, { stores: { some: { store_id: { in: storeIds } } } }],
  };
}

/**
 * Available at branch S = offered there and `is_active`. What a tender or a
 * layout may use; spread into `where` clauses by tender enforcement.
 */
export function availableAt(storeIds: string[]): Prisma.PaymentMethodWhereInput {
  return { is_active: true, ...offeredAt(storeIds) };
}

/** The same rule as `offeredAt`, for a method row already in memory. */
export function isOfferedAt(
  m: { all_branches: boolean; stores: { store_id: string }[] },
  storeId: string,
): boolean {
  return m.all_branches || m.stores.some((s) => s.store_id === storeId);
}

/** The same rule as `availableAt`, for a method row already in memory. */
export function isAvailableAt(
  m: { is_active: boolean; all_branches: boolean; stores: { store_id: string }[] },
  storeId: string,
): boolean {
  return m.is_active && isOfferedAt(m, storeId);
}
