import {
    buildBoardColumns,
    columnQuery,
    columnsMatchingFilter,
    dropAction,
    type BoardColumnSources,
    type BoardLead,
    type GroupedFieldFilters,
} from './board-columns';

function option(id: string, extra: Record<string, unknown> = {}) {
    return { id, code: id.toUpperCase(), name: id, sort_order: 0, is_system: false, is_active: true, ...extra } as any;
}

const sources: BoardColumnSources = {
    statuses: [
        option('new', { code: 'NEW', name: 'New', is_system: true, lifecycle: 'NEW' }),
        option('demo', { name: 'Demo booked', lifecycle: 'QUALIFIED' }),
        option('old', { name: 'Old stage', lifecycle: 'CONTACTED', is_active: false }),
        option('won', { code: 'CONVERTED', name: 'Converted', is_system: true, lifecycle: 'CONVERTED' }),
        option('lost', { code: 'LOST', name: 'Lost', is_system: true, lifecycle: 'LOST' }),
    ],
    categories: [option('retail', { name: 'Retail' }), option('gone', { name: 'Gone', is_active: false })],
    sources: [option('walkin', { name: 'Walk-in' })],
    members: [{ id: 'user-1', label: 'Nayeem' }, { id: 'user-2', label: 'Rifat' }],
    labels: {
        statuses: { NEW: 'নতুন', CONVERTED: 'Converted', LOST: 'Lost' },
        priorities: { LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High', URGENT: 'Urgent' },
        unassigned: 'Unassigned',
        uncategorised: 'Uncategorised',
        noSource: 'No source',
    },
};

const noFilters: GroupedFieldFilters = { status: '', priority: '', owner: '', category: '', source: '' };

const lead: BoardLead = {
    id: 'lead-1',
    name: 'Karim Traders',
    mobile: '01700000000',
    photo_url: null,
    priority: 'MEDIUM',
    status: 'NEW',
    score: 20,
    assignee: null,
    categoryOption: null,
    sourceOption: null,
};

describe('buildBoardColumns', () => {
    it('makes a column per stage, translating a seeded name and keeping a retired one only while it holds leads', () => {
        const columns = buildBoardColumns('status', sources);

        expect(columns.map((c) => c.label)).toEqual(['নতুন', 'Demo booked', 'Old stage', 'Converted', 'Lost']);
        expect(columns[1]).toEqual(
            expect.objectContaining({ query: { statusId: 'demo' }, patch: { status_id: 'demo' }, lifecycle: 'QUALIFIED' }),
        );
        const retired = columns[2];
        expect(retired.hideWhenEmpty).toBe(true);
        expect(retired.patch).toBeNull();
    });

    it('makes the four priorities in rising order', () => {
        const columns = buildBoardColumns('priority', sources);

        expect(columns.map((c) => c.query.priority)).toEqual(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);
        expect(columns[3].patch).toEqual({ priority: 'URGENT' });
    });

    it('puts Unassigned before the team, and moving there clears the owner', () => {
        const columns = buildBoardColumns('owner', sources);

        expect(columns.map((c) => c.label)).toEqual(['Unassigned', 'Nayeem', 'Rifat']);
        expect(columns[0]).toEqual(expect.objectContaining({ query: { assignedTo: 'unassigned' }, patch: { assigned_to: null } }));
        expect(columns[2]).toEqual(expect.objectContaining({ query: { assignedTo: 'user-2' }, patch: { assigned_to: 'user-2' } }));
    });

    it('starts the category board with the uncategorised leads, which a lead can be moved back into', () => {
        const columns = buildBoardColumns('category', sources);

        expect(columns.map((c) => c.label)).toEqual(['Uncategorised', 'Retail', 'Gone']);
        expect(columns[0]).toEqual(expect.objectContaining({ query: { category: 'none' }, patch: { category: '' } }));
        expect(columns[2].hideWhenEmpty).toBe(true);
    });

    it('ends the source board with a No source column that only shows when it holds leads and takes no drops', () => {
        const columns = buildBoardColumns('source', sources);
        const none = columns[columns.length - 1];

        expect(none).toEqual(expect.objectContaining({ query: { source: 'none' }, patch: null, hideWhenEmpty: true }));
    });
});

describe('columnsMatchingFilter', () => {
    const statusColumns = buildBoardColumns('status', sources);

    it('shows every column when the grouped field is not filtered', () => {
        expect(columnsMatchingFilter('status', statusColumns, noFilters)).toHaveLength(5);
    });

    it('narrows to the open stages for the open-pipeline filter', () => {
        const shown = columnsMatchingFilter('status', statusColumns, { ...noFilters, status: 'open' });

        expect(shown.map((c) => c.label)).toEqual(['নতুন', 'Demo booked', 'Old stage']);
    });

    it('narrows to one stage by id, or to every stage of a lifecycle named by an older link', () => {
        expect(columnsMatchingFilter('status', statusColumns, { ...noFilters, status: 'demo' }).map((c) => c.key)).toEqual([
            'status:demo',
        ]);
        expect(columnsMatchingFilter('status', statusColumns, { ...noFilters, status: 'LOST' }).map((c) => c.key)).toEqual([
            'status:lost',
        ]);
    });

    it('narrows the owner board to the filtered owner, unassigned included', () => {
        const columns = buildBoardColumns('owner', sources);

        expect(columnsMatchingFilter('owner', columns, { ...noFilters, owner: 'unassigned' }).map((c) => c.label)).toEqual([
            'Unassigned',
        ]);
        expect(columnsMatchingFilter('owner', columns, { ...noFilters, owner: 'user-1' }).map((c) => c.label)).toEqual([
            'Nayeem',
        ]);
    });

    it('ignores filters on other fields', () => {
        const columns = buildBoardColumns('priority', sources);

        expect(columnsMatchingFilter('priority', columns, { ...noFilters, owner: 'user-1', status: 'open' })).toHaveLength(4);
    });
});

describe('columnQuery', () => {
    it("swaps the list's status and stage filters for the column's stage, keeping every other filter", () => {
        const column = buildBoardColumns('status', sources)[1];

        expect(columnQuery('status', { status: 'open', search: 'karim', mine: true }, column)).toEqual({
            search: 'karim',
            mine: true,
            statusId: 'demo',
        });
    });

    it("swaps the owner filter for the column's owner", () => {
        const column = buildBoardColumns('owner', sources)[0];

        expect(columnQuery('owner', { assignedTo: 'user-1', priority: 'HIGH' }, column)).toEqual({
            assignedTo: 'unassigned',
            priority: 'HIGH',
        });
    });
});

describe('dropAction', () => {
    const [newCol, demoCol, oldCol, wonCol, lostCol] = buildBoardColumns('status', sources);

    it('does nothing when the card lands back in its own column', () => {
        expect(dropAction(lead, newCol, newCol)).toEqual({ kind: 'none' });
    });

    it('patches the stage for an open stage', () => {
        expect(dropAction(lead, newCol, demoCol)).toEqual({ kind: 'patch', body: { status_id: 'demo' } });
    });

    it('asks for a reason before closing as lost', () => {
        expect(dropAction(lead, newCol, lostCol)).toEqual({ kind: 'lost', body: { status_id: 'lost' } });
    });

    it('converts rather than patching when dropped on the won stage', () => {
        expect(dropAction(lead, newCol, wonCol)).toEqual({ kind: 'convert' });
    });

    it('refuses a retired stage and any move of a converted lead', () => {
        expect(dropAction(lead, newCol, oldCol)).toEqual({ kind: 'blocked' });
        expect(dropAction({ ...lead, status: 'CONVERTED' }, wonCol, newCol)).toEqual({ kind: 'blocked' });
    });

    it('patches the field for every other grouping', () => {
        const [low, , high] = buildBoardColumns('priority', sources);

        expect(dropAction(lead, low, high)).toEqual({ kind: 'patch', body: { priority: 'HIGH' } });
    });
});
