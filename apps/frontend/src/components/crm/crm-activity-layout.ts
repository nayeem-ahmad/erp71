import { routes } from '@/lib/routes';
import { tenantDateOnly } from '@/lib/created-range';

/** How the activities page lays its rows out. Remembered across visits. */
export type ActivityLayout = 'standard' | 'compact' | 'agenda';

/**
 * A display preference, so it lives in `localStorage` rather than with the
 * page's filters. Those are a view of the work in front of you and are
 * forgotten when the tab closes; the layout is how this person wants the
 * page to open tomorrow.
 */
export const ACTIVITY_LAYOUT_KEY = 'erp71:crm-activities:layout';

export function readActivityLayout(): ActivityLayout {
    if (typeof window === 'undefined') return 'standard';
    try {
        const raw = localStorage.getItem(ACTIVITY_LAYOUT_KEY);
        if (raw === 'compact' || raw === 'agenda' || raw === 'standard') return raw;
    } catch {
        // Storage blocked. Standard is the page the rest of the app already knows.
    }
    return 'standard';
}

export function writeActivityLayout(layout: ActivityLayout): void {
    if (typeof window === 'undefined') return;
    try {
        localStorage.setItem(ACTIVITY_LAYOUT_KEY, layout);
    } catch {
        // Forgetting the choice is better than refusing to switch.
    }
}

export interface CrmActivityListRow {
    id: string;
    subject: string | null;
    summary: string | null;
    status: string;
    due_at: string | null;
    completed_at: string | null;
    purpose: { id: string; name: string; icon: string | null } | null;
    channel: { id: string; name: string; icon: string | null } | null;
    customer: { id: string; name: string; phone: string | null } | null;
    lead: { id: string; name: string; mobile: string | null } | null;
    assignee: { id: string; name: string; email: string } | null;
    is_approved: boolean;
    approver: { id: string; name: string; email: string } | null;
    created_at: string;
}

/** The lead or customer a row hangs off, in the shape the link and the drawer share. */
export type ActivityTarget = {
    leadId?: string;
    customerId?: string;
    name: string;
    phone: string | null;
    href: string;
};

export function activityTarget(row: Pick<CrmActivityListRow, 'lead' | 'customer'>): ActivityTarget | null {
    if (row.lead) {
        return {
            leadId: row.lead.id,
            name: row.lead.name,
            phone: row.lead.mobile,
            href: `${routes.crm.leads}/${row.lead.id}`,
        };
    }
    if (row.customer) {
        return {
            customerId: row.customer.id,
            name: row.customer.name,
            phone: row.customer.phone,
            href: `${routes.sales.customers}/${row.customer.id}`,
        };
    }
    return null;
}

export function activityLabel(row: Pick<CrmActivityListRow, 'subject' | 'summary'>): string {
    return row.subject ?? row.summary ?? '';
}

export function activityKindName(row: Pick<CrmActivityListRow, 'purpose' | 'channel'>): string {
    return row.purpose?.name ?? row.channel?.name ?? '';
}

/** The workspace calendar day a due instant falls on, or null when it is not a date. */
export function activityDueDay(dueAt: string): string | null {
    const parsed = new Date(dueAt);
    if (Number.isNaN(parsed.getTime())) return null;
    return tenantDateOnly(parsed);
}

export type ActivityGroupId = 'overdue' | 'today' | 'later' | 'earlier' | 'undated';

const GROUP_ORDER: ActivityGroupId[] = ['overdue', 'today', 'later', 'earlier', 'undated'];

/**
 * Where an agenda row sits.
 *
 * Overdue is only a plan that has slipped: a call already logged yesterday is
 * history, not a debt, so it goes under Earlier beside the other past days.
 */
export function classifyActivity(status: string, dueDay: string | null, today: string): ActivityGroupId {
    if (!dueDay) return 'undated';
    if (dueDay > today) return 'later';
    if (dueDay === today) return 'today';
    if (status === 'PLANNED') return 'overdue';
    return 'earlier';
}

export function groupActivities<T extends { status: string; due_at: string | null }>(
    rows: T[],
    today: string,
    dueDayOf: (dueAt: string) => string | null = activityDueDay,
): { id: ActivityGroupId; rows: T[] }[] {
    const buckets = new Map<ActivityGroupId, T[]>();
    for (const row of rows) {
        const day = row.due_at ? dueDayOf(row.due_at) : null;
        const id = classifyActivity(row.status, day, today);
        const list = buckets.get(id);
        if (list) list.push(row);
        else buckets.set(id, [row]);
    }
    return GROUP_ORDER.filter((id) => buckets.has(id)).map((id) => ({
        id,
        rows: (buckets.get(id) ?? []).slice().sort((a, b) => {
            const da = a.due_at ? dueDayOf(a.due_at) ?? '' : '';
            const db = b.due_at ? dueDayOf(b.due_at) ?? '' : '';
            if (da === db) return 0;
            return da < db ? -1 : 1;
        }),
    }));
}

/** How many of the filters tucked behind "More filters" are narrowed. */
export function countExtraActivityFilters(filters: {
    approval: string;
    target: string;
    purposeId: string;
    channelId: string;
    leadOwner: string;
    assignee: string;
    createdRange: { from?: string; to?: string } | null;
}): number {
    let count = 0;
    if (filters.approval) count += 1;
    if (filters.target) count += 1;
    if (filters.purposeId) count += 1;
    if (filters.channelId) count += 1;
    if (filters.leadOwner) count += 1;
    if (filters.assignee) count += 1;
    if (filters.createdRange?.from || filters.createdRange?.to) count += 1;
    return count;
}
