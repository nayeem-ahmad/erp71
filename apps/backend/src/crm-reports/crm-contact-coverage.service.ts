import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { percent } from '../common/dashboard-window';
import { OPEN_LEAD_STATUSES } from '../crm-leads/crm-leads.dto';

export type CoverageParty = 'lead' | 'customer';

export type CoverageRow = {
    party: CoverageParty;
    total: number;
    by_phone: number;
    by_email: number;
    by_both: number;
    /** At least one usable way to reach them. */
    reachable: number;
    unreachable: number;
    reachable_pct: number | null;
};

export type SourceCoverageRow = {
    source_id: string | null;
    name: string | null;
    total: number;
    reachable: number;
    reachable_pct: number | null;
};

export type ContactCoverageReport = {
    by_party: CoverageRow[];
    by_source: SourceCoverageRow[];
    totals: {
        total: number;
        reachable: number;
        unreachable: number;
        reachable_pct: number | null;
    };
};

type Party = { phone: string | null; email: string | null };

/** A contact value that is only whitespace is not a way to reach anybody. */
function usable(value: string | null | undefined): boolean {
    return typeof value === 'string' && value.trim().length > 0;
}

function countOf(rows: Party[]): Omit<CoverageRow, 'party' | 'reachable_pct'> {
    let by_phone = 0;
    let by_email = 0;
    let by_both = 0;
    let reachable = 0;

    for (const row of rows) {
        const phone = usable(row.phone);
        const email = usable(row.email);
        if (phone) by_phone++;
        if (email) by_email++;
        if (phone && email) by_both++;
        if (phone || email) reachable++;
    }

    return { total: rows.length, by_phone, by_email, by_both, reachable, unreachable: rows.length - reachable };
}

/**
 * How much of the book you can actually reach.
 *
 * Two separate answers, because they are separate problems: leads still in the
 * pipeline are the ones a rep has to call, and customers are the ones a
 * campaign can address. A single blended percentage would hide whichever of the
 * two is the weak one.
 *
 * Leads are open ones only — a converted or lost lead is not work in progress,
 * and its missing phone number is no longer a problem to fix.
 *
 * The by-source roll-up is the actionable half: a channel that consistently
 * brings in leads with no phone number is a form to fix, not a list to clean.
 */
@Injectable()
export class CrmContactCoverageService {
    constructor(private readonly db: DatabaseService) {}

    async report(tenantId: string): Promise<ContactCoverageReport> {
        const [leads, customers] = await Promise.all([
            this.db.lead.findMany({
                where: {
                    tenant_id: tenantId,
                    status: { in: [...OPEN_LEAD_STATUSES] },
                },
                select: { source_id: true, mobile: true, email: true },
            }),
            this.db.customer.findMany({
                where: { tenant_id: tenantId, deleted_at: null },
                select: { phone: true, email: true },
            }),
        ]);

        const leadParties: Party[] = leads.map((lead) => ({ phone: lead.mobile, email: lead.email }));
        const customerParties: Party[] = customers.map((customer) => ({
            phone: customer.phone,
            email: customer.email,
        }));

        const leadCounts = countOf(leadParties);
        const customerCounts = countOf(customerParties);

        const partyBase: Omit<CoverageRow, 'reachable_pct'>[] = [
            { party: 'lead', ...leadCounts },
            { party: 'customer', ...customerCounts },
        ];

        const by_party: CoverageRow[] = partyBase.map((row) => ({
            ...row,
            reachable_pct: percent(row.reachable, row.total),
        }));

        // The source roll-up covers leads only: a customer's source is a sale,
        // which is a different question from where the record came from.
        const sourceGroups = new Map<string | null, Party[]>();
        for (const lead of leads) {
            const group = sourceGroups.get(lead.source_id) ?? [];
            group.push({ phone: lead.mobile, email: lead.email });
            sourceGroups.set(lead.source_id, group);
        }

        const sourceIds = [...sourceGroups.keys()].filter((id): id is string => Boolean(id));
        const sources = sourceIds.length
            ? await this.db.leadSourceOption.findMany({
                where: { tenant_id: tenantId, id: { in: sourceIds } },
                select: { id: true, name: true },
            })
            : [];
        const sourceNames = new Map<string, string>();
        for (const source of sources) sourceNames.set(source.id, source.name);

        const by_source: SourceCoverageRow[] = [...sourceGroups.entries()]
            .map(([sourceId, rows]) => {
                const counted = countOf(rows);
                return {
                    source_id: sourceId,
                    name: sourceId ? (sourceNames.get(sourceId) ?? null) : null,
                    total: counted.total,
                    reachable: counted.reachable,
                    reachable_pct: percent(counted.reachable, counted.total),
                };
            })
            .sort((a, b) => b.total - a.total);

        const total = leadParties.length + customerParties.length;
        const reachable = leadCounts.reachable + customerCounts.reachable;

        return {
            by_party,
            by_source,
            totals: {
                total,
                reachable,
                unreachable: total - reachable,
                reachable_pct: percent(reachable, total),
            },
        };
    }
}
