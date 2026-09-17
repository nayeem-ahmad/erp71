import { BadRequestException } from '@nestjs/common';

/**
 * The open cashier session belonging to whoever is making this request.
 *
 * Takes the transaction client rather than the service so a sale or a return
 * reads the session inside its own transaction — the shift a document is
 * stamped with is then the one that was open at the moment it posted, not the
 * one that happened to be open when a separate read ran.
 *
 * Returns null rather than throwing: most tenants never open a session, and a
 * sale without one is an ordinary back-office invoice, not an error.
 */
export async function findOpenSessionForUser(
  tx: { cashierSession: { findFirst: Function } },
  tenantId: string,
  userId: string,
): Promise<{ id: string; counter_id: string | null; store_id: string } | null> {
  return tx.cashierSession.findFirst({
    where: { tenant_id: tenantId, user_id: userId, status: 'OPEN' },
    select: { id: true, counter_id: true, store_id: true },
  }) as Promise<{ id: string; counter_id: string | null; store_id: string } | null>;
}

/**
 * Whether this tenant makes POS refuse to sell without an open shift.
 *
 * Reads the row directly instead of going through SalesSettingsService, which
 * creates a settings row when none exists — a write, inside somebody else's
 * sale transaction, to answer a question whose default is already known.
 */
export async function requiresCashierSession(
  tx: { salesSettings: { findUnique: Function } },
  tenantId: string,
): Promise<boolean> {
  const settings = (await tx.salesSettings.findUnique({
    where: { tenant_id: tenantId },
    select: { require_cashier_session: true },
  })) as { require_cashier_session?: boolean } | null;

  return settings?.require_cashier_session ?? false;
}

/**
 * Applied to a sale the client says came from POS, when the tenant has turned
 * the requirement on.
 *
 * This is a workflow control rather than a security boundary — the caller is
 * already permitted to sell, and could omit the source marker — so it is worth
 * being clear about what it buys: it stops a cashier who forgot to open their
 * shift from ringing a day of sales that reconcile against nothing, which is
 * the mistake that actually happens. Making it unbypassable would mean
 * refusing back-office invoices too, which is a different product.
 */
export function assertSessionForPosSale(
  session: { id: string } | null,
  required: boolean,
  isPosSale: boolean,
): void {
  if (required && isPosSale && !session) {
    throw new BadRequestException(
      'Open a cashier session before selling at the counter.',
    );
  }
}
