import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DatabaseService } from '../database/database.service';

const num = (value: Prisma.Decimal | number | null | undefined) => Number(value ?? 0);
const round2 = (value: number) => Math.round(value * 100) / 100;

/** An hour that has not been billed yet: on no invoice, or on one since cancelled. */
export const UNBILLED_ENTRY: Prisma.ProjectTimeEntryWhereInput = {
    OR: [{ billed_sale_id: null }, { billedSale: { status: 'CANCELLED' } }],
};
/** An hour a customer is charged for: none of its tags says otherwise. */
export const BILLABLE_ENTRY: Prisma.ProjectTimeEntryWhereInput = {
    tags: { none: { tag: { billable: false } } },
};
export interface UnbilledPerson {
    key: string;
    name: string;
    memberId: string | null;
    hours: number;
    /** Null when neither the member nor the project has a bill rate. */
    rate: number | null;
    rateSource: 'MEMBER' | 'PROJECT' | null;
    amount: number;
}

/**
 * Which hours a time-and-materials project can still bill, and at what rate.
 *
 * Its own service, apart from invoicing, because Financials needs the figure
 * too — and Financials lives in the projects module, which must not depend on
 * Sales. `ProjectBillingService` (in `ProjectBillingModule`) raises the
 * invoice; this only counts.
 */
@Injectable()
export class ProjectUnbilledService {
    constructor(private readonly db: DatabaseService) {}

    /**
     * Billable hours not yet invoiced, priced at each person's bill rate — the
     * member's own, else the project's. Up to a date, inclusive, when given.
     */
    async unbilledHours(
        tenantId: string,
        project: { id: string; bill_rate: Prisma.Decimal | null },
        upTo?: string,
    ) {
        const entries = await this.db.projectTimeEntry.findMany({
            where: {
                tenant_id: tenantId,
                project_id: project.id,
                ...(upTo ? { work_date: { lte: new Date(upTo) } } : {}),
                AND: [UNBILLED_ENTRY, BILLABLE_ENTRY],
            },
            select: {
                id: true,
                hours: true,
                user_id: true,
                employee_id: true,
                user: { select: { name: true, email: true } },
                employee: { select: { name: true } },
            },
        });
        const members = await this.db.projectMember.findMany({
            where: { project_id: project.id },
            select: { id: true, user_id: true, employee_id: true, bill_rate: true },
        });
        const memberFor = (entry: { user_id: string | null; employee_id: string | null }) =>
            members.find((m) => (entry.employee_id && m.employee_id === entry.employee_id) || (entry.user_id && m.user_id === entry.user_id))
            ?? null;

        const people = new Map<string, UnbilledPerson>();
        for (const entry of entries) {
            const key = entry.employee_id ? `employee:${entry.employee_id}` : `user:${entry.user_id ?? 'none'}`;
            const member = memberFor(entry);
            const line = people.get(key) ?? (() => {
                const own = member?.bill_rate ?? null;
                const rate = own ?? project.bill_rate ?? null;
                return {
                    key,
                    name: entry.employee?.name ?? entry.user?.name ?? entry.user?.email ?? '',
                    memberId: member?.id ?? null,
                    hours: 0,
                    rate: rate === null ? null : num(rate),
                    rateSource: own !== null ? 'MEMBER' as const : rate !== null ? 'PROJECT' as const : null,
                    amount: 0,
                };
            })();
            line.hours += num(entry.hours);
            people.set(key, line);
        }

        const list = [...people.values()].map((line) => ({
            ...line,
            hours: round2(line.hours),
            amount: line.rate === null ? 0 : round2(line.hours * line.rate),
        }));
        return {
            people: list.sort((a, b) => b.amount - a.amount),
            hours: round2(list.reduce((sum, line) => sum + line.hours, 0)),
            amount: round2(list.reduce((sum, line) => sum + line.amount, 0)),
            unratedHours: round2(list.filter((line) => line.rate === null).reduce((sum, line) => sum + line.hours, 0)),
            entryIds: entries.map((entry) => entry.id),
        };
    }

}
