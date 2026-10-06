import { BadRequestException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

type Client = Pick<PrismaClient | Prisma.TransactionClient, 'employee' | 'customer'>;

/** What a customer or a sale carries of its sales rep: enough to name them. */
export const SALES_REP_SELECT = { id: true, name: true } as const;

/** Employees who can be someone's sales rep: on the books and not deleted. */
const CURRENT_EMPLOYEE = {
    deleted_at: null,
    status: { in: ['ACTIVE', 'PROBATION'] as any },
};

/**
 * The employees a sales rep can be chosen from — id and name only.
 *
 * Its own list rather than `/employees`, which sits behind HR permission
 * because it carries pay; the people picking a customer's rep are sales staff.
 */
export function listSalesReps(db: Client, tenantId: string) {
    return db.employee.findMany({
        where: { tenant_id: tenantId, ...CURRENT_EMPLOYEE },
        select: SALES_REP_SELECT,
        orderBy: { name: 'asc' },
    });
}

/**
 * A sales rep id from a request, checked: null clears it, and anything else
 * must be an employee of this tenant — an id from another workspace is refused
 * rather than linked.
 */
export async function checkedSalesRepId(
    db: Client,
    tenantId: string,
    id: string | null | undefined,
): Promise<string | null | undefined> {
    if (id === undefined) return undefined;
    if (id === null || id === '') return null;
    const employee = await db.employee.findFirst({
        where: { id, tenant_id: tenantId, deleted_at: null },
        select: { id: true },
    });
    if (!employee) throw new BadRequestException('That sales rep is not an employee of this workspace.');
    return employee.id;
}

/**
 * The sales rep a new sale takes: the one the request names (checked), or —
 * when it names none — the customer's own, so a sale rung up for a customer is
 * credited to the employee who looks after them without anyone choosing.
 */
export async function salesRepForSale(
    db: Client,
    tenantId: string,
    requested: string | null | undefined,
    customerId: string | null | undefined,
): Promise<string | null> {
    const checked = await checkedSalesRepId(db, tenantId, requested);
    if (checked !== undefined) return checked;
    if (!customerId) return null;
    const customer = await db.customer.findFirst({
        where: { id: customerId, tenant_id: tenantId },
        select: { sales_rep_id: true },
    });
    return customer?.sales_rep_id ?? null;
}
