import type { LeadTaxonomyOption } from '@/lib/use-lead-taxonomy';
import { isOpenLifecycle, stageOptionLabel, type LeadStage } from '@/lib/lead-status';

/**
 * The fields the leads board can lay its columns out by. Custom fields are not
 * among them: they are free text, so they have no list of values to make
 * columns from.
 */
export const LEAD_BOARD_GROUPS = ['status', 'priority', 'owner', 'category', 'source'] as const;
export type LeadBoardGroup = (typeof LEAD_BOARD_GROUPS)[number];
export const DEFAULT_LEAD_BOARD_GROUP: LeadBoardGroup = 'status';

export function isLeadBoardGroup(value: unknown): value is LeadBoardGroup {
    return LEAD_BOARD_GROUPS.includes(value as LeadBoardGroup);
}

/** Mirrors the list endpoint's sentinels in crm-leads.dto.ts. */
export const UNASSIGNED_OWNER_FILTER = 'unassigned';
export const NO_TAXONOMY_FILTER = 'none';
const OPEN_STATUS_FILTER = 'open';

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;

type Ref = { id: string; name: string } | null;

/** The slice of a lead the board reads. */
export interface BoardLead {
    id: string;
    name: string;
    mobile: string;
    photo_url: string | null;
    priority: string;
    status: string;
    statusOption?: LeadStage | null;
    score: number;
    assignee: Ref;
    categoryOption: Ref;
    sourceOption: Ref;
}

/** The `GET /crm/leads` filter keys a column narrows on. */
export type ColumnQuery = {
    statusId?: string;
    priority?: string;
    assignedTo?: string;
    category?: string;
    source?: string;
};

export interface BoardColumn {
    key: string;
    label: string;
    query: ColumnQuery;
    /**
     * The `PATCH /crm/leads/:id` body that puts a lead in this column, or null
     * when nothing can be moved here — a retired option, or "no source", which
     * the backend refuses to store and replaces with the tenant's fallback.
     */
    patch: Record<string, string | null> | null;
    /** Status columns only: what the stage means to the system. */
    lifecycle?: string;
    /**
     * A column that only earns a place while it still holds leads: a retired
     * stage or option (leads keep it, new ones cannot get it) or "no source".
     */
    hideWhenEmpty?: boolean;
}

export interface BoardColumnSources {
    /** Every stage, retired ones included — leads can still sit on one. */
    statuses: LeadTaxonomyOption[];
    categories: LeadTaxonomyOption[];
    sources: LeadTaxonomyOption[];
    members: { id: string; label: string }[];
    labels: {
        statuses: Record<string, string>;
        priorities: Record<string, string>;
        unassigned: string;
        uncategorised: string;
        noSource: string;
    };
}

function taxonomyColumns(
    field: 'category' | 'source',
    options: LeadTaxonomyOption[],
): BoardColumn[] {
    return options.map((o) => ({
        key: `${field}:${o.id}`,
        label: o.name,
        query: { [field]: o.id },
        patch: o.is_active ? { [field]: o.id } : null,
        hideWhenEmpty: !o.is_active,
    }));
}

/** The columns for one grouping, in the order they are shown. */
export function buildBoardColumns(group: LeadBoardGroup, sources: BoardColumnSources): BoardColumn[] {
    const { labels } = sources;
    switch (group) {
        case 'status':
            return sources.statuses.map((o) => ({
                key: `status:${o.id}`,
                label: stageOptionLabel(o, labels.statuses),
                query: { statusId: o.id },
                patch: o.is_active ? { status_id: o.id } : null,
                lifecycle: o.lifecycle,
                hideWhenEmpty: !o.is_active,
            }));
        case 'priority':
            return PRIORITIES.map((p) => ({
                key: `priority:${p}`,
                label: labels.priorities[p] ?? p,
                query: { priority: p },
                patch: { priority: p },
            }));
        case 'owner':
            return [
                {
                    key: `owner:${UNASSIGNED_OWNER_FILTER}`,
                    label: labels.unassigned,
                    query: { assignedTo: UNASSIGNED_OWNER_FILTER },
                    patch: { assigned_to: null },
                },
                ...sources.members.map((mem) => ({
                    key: `owner:${mem.id}`,
                    label: mem.label,
                    query: { assignedTo: mem.id },
                    patch: { assigned_to: mem.id },
                })),
            ];
        case 'category':
            return [
                {
                    key: `category:${NO_TAXONOMY_FILTER}`,
                    label: labels.uncategorised,
                    query: { category: NO_TAXONOMY_FILTER },
                    patch: { category: '' },
                },
                ...taxonomyColumns('category', sources.categories),
            ];
        case 'source':
            return [
                ...taxonomyColumns('source', sources.sources),
                {
                    key: `source:${NO_TAXONOMY_FILTER}`,
                    label: labels.noSource,
                    query: { source: NO_TAXONOMY_FILTER },
                    // Clearing a source stores the tenant's fallback instead.
                    patch: null,
                    hideWhenEmpty: true,
                },
            ];
    }
}

/** The list's filters that name the same field a grouping does. */
export interface GroupedFieldFilters {
    status: string;
    priority: string;
    owner: string;
    category: string;
    source: string;
}

/**
 * A filter on the field the board is grouped by narrows the columns rather
 * than every column's contents: filtering to one owner while grouping by owner
 * shows that owner's column, not a row of empty ones.
 */
export function columnsMatchingFilter(
    group: LeadBoardGroup,
    columns: BoardColumn[],
    filters: GroupedFieldFilters,
): BoardColumn[] {
    const value = group === 'owner' ? filters.owner : filters[group];
    if (!value) return columns;
    if (group === 'status') {
        if (value === OPEN_STATUS_FILTER) return columns.filter((col) => isOpenLifecycle(col.lifecycle));
        const byStage = columns.filter((col) => col.query.statusId === value);
        // Not a stage id, so a lifecycle code from an older link.
        return byStage.length > 0 ? byStage : columns.filter((col) => col.lifecycle === value);
    }
    const queryKey = (
        { priority: 'priority', owner: 'assignedTo', category: 'category', source: 'source' } as const
    )[group];
    return columns.filter((col) => col.query[queryKey] === value);
}

/** The base-query keys a grouping replaces with each column's own. */
export const GROUPED_QUERY_KEYS: Record<LeadBoardGroup, string[]> = {
    status: ['status', 'statusId'],
    priority: ['priority'],
    owner: ['assignedTo'],
    category: ['category'],
    source: ['source'],
};

/** The list's query with the grouped field swapped for the column's value. */
export function columnQuery<Q extends Record<string, unknown>>(
    group: LeadBoardGroup,
    base: Q,
    column: BoardColumn,
): Q & ColumnQuery {
    const query: Record<string, unknown> = { ...base };
    for (const key of GROUPED_QUERY_KEYS[group]) delete query[key];
    return { ...query, ...column.query } as Q & ColumnQuery;
}

export type DropAction =
    | { kind: 'none' }
    | { kind: 'blocked' }
    | { kind: 'patch'; body: Record<string, string | null> }
    /** Closing as lost needs a reason first, which the backend requires. */
    | { kind: 'lost'; body: Record<string, string | null> }
    /** Winning goes through convert, which also creates the customer. */
    | { kind: 'convert' };

/** A converted lead is closed for good: the backend refuses any edit to it. */
export function canDragLead(lead: Pick<BoardLead, 'status'>): boolean {
    return lead.status !== 'CONVERTED';
}

/** What dropping `lead` from one column on another has to do. */
export function dropAction(lead: BoardLead, from: BoardColumn, to: BoardColumn): DropAction {
    if (from.key === to.key) return { kind: 'none' };
    if (!canDragLead(lead) || !to.patch) return { kind: 'blocked' };
    if (to.lifecycle === 'CONVERTED') return { kind: 'convert' };
    if (to.lifecycle === 'LOST') return { kind: 'lost', body: to.patch };
    return { kind: 'patch', body: to.patch };
}
