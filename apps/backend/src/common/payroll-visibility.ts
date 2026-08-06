import { StorePermission } from '@erp71/shared-types';
import { DatabaseService } from '../database/database.service';
import { TenantContext } from '../database/tenant.decorator';

/**
 * Whether this user may see money on an employee.
 *
 * Extracted from `HrDashboardService` when `EmployeesController` was brought
 * under the same rule (Phase 0 of the HRIS plan). The two must agree: the
 * dashboard summarises exactly the figures the employee endpoints return
 * row-by-row, so a difference between them is a leak of the stricter one.
 *
 * Owners bypass permissions everywhere else in the app, so they do here too;
 * everyone else needs the explicit grant on their current store.
 */
export async function canViewPayroll(
    db: DatabaseService,
    tenant: TenantContext,
): Promise<boolean> {
    if (tenant.userRole === 'OWNER') return true;
    if (!tenant.storeId) return false;

    const grant = await db.userStorePermission.findFirst({
        where: {
            user_id: tenant.userId,
            store_id: tenant.storeId,
            permission: StorePermission.VIEW_PAYROLL,
        },
        select: { id: true },
    });
    return Boolean(grant);
}

/** Fields on an Employee that only `VIEW_PAYROLL` may read. */
const PAYROLL_FIELDS = ['basic_salary'] as const;

/**
 * Drop the salary fields from an employee row (or rows) unless permitted.
 *
 * Deletes the keys rather than nulling them: a `null` basic_salary is a real
 * state ("no salary recorded"), so nulling would make an unpermitted read
 * indistinguishable from an employee who genuinely has none, and the edit form
 * would then happily save that null back over a real figure.
 */
export function stripPayrollFields<T extends Record<string, any>>(
    row: T,
    permitted: boolean,
): T {
    if (permitted) return row;
    const copy: Record<string, any> = { ...row };
    for (const field of PAYROLL_FIELDS) delete copy[field];
    return copy as T;
}
