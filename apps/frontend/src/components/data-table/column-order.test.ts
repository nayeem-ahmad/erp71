import {
    columnDefId,
    isPinnedColumnId,
    reconcileColumnOrder,
    PINNED_FIRST_COLUMN_ID,
    PINNED_LAST_COLUMN_ID,
} from './column-order';

const DECLARED = ['select', 'name', 'mobile', 'email', 'created_at', 'actions'];

describe('columnDefId', () => {
    it('prefers an explicit id, the way TanStack does', () => {
        expect(columnDefId({ id: 'category', accessorKey: 'category_id' } as any)).toBe('category');
    });

    it('falls back to the accessor key, with dots flattened', () => {
        expect(columnDefId({ accessorKey: 'name' } as any)).toBe('name');
        expect(columnDefId({ accessorKey: 'lead.name' } as any)).toBe('lead_name');
    });

    it('falls back to a string header, and gives up on a rendered one', () => {
        expect(columnDefId({ header: 'Amount' } as any)).toBe('Amount');
        expect(columnDefId({ header: () => null } as any)).toBe('');
    });
});

describe('isPinnedColumnId', () => {
    it('names the two structural columns and nothing else', () => {
        expect(isPinnedColumnId(PINNED_FIRST_COLUMN_ID)).toBe(true);
        expect(isPinnedColumnId(PINNED_LAST_COLUMN_ID)).toBe(true);
        expect(isPinnedColumnId('email')).toBe(false);
    });
});

describe('reconcileColumnOrder', () => {
    it('returns the declared order when nothing has been saved', () => {
        expect(reconcileColumnOrder(undefined, DECLARED)).toEqual(DECLARED);
        expect(reconcileColumnOrder([], DECLARED)).toEqual(DECLARED);
    });

    it("keeps the viewer's own arrangement of the middle columns", () => {
        const saved = ['select', 'mobile', 'email', 'name', 'created_at', 'actions'];
        expect(reconcileColumnOrder(saved, DECLARED)).toEqual(saved);
    });

    it('pins the checkbox first however the saved order arranged it', () => {
        const saved = ['name', 'select', 'mobile', 'email', 'created_at', 'actions'];
        expect(reconcileColumnOrder(saved, DECLARED)[0]).toBe('select');
    });

    it('pins the actions last however the saved order arranged it', () => {
        const saved = ['select', 'actions', 'name', 'mobile', 'email', 'created_at'];
        const result = reconcileColumnOrder(saved, DECLARED);
        expect(result[result.length - 1]).toBe('actions');
        expect(result).toEqual(DECLARED);
    });

    it('pins both edges at once, from a fully inverted order', () => {
        const saved = [...DECLARED].reverse();
        const result = reconcileColumnOrder(saved, DECLARED);
        expect(result[0]).toBe('select');
        expect(result[result.length - 1]).toBe('actions');
        expect(result).toEqual(['select', 'created_at', 'email', 'mobile', 'name', 'actions']);
    });

    it('drops ids for columns that no longer exist', () => {
        const saved = ['select', 'name', 'retired_column', 'mobile', 'email', 'created_at', 'actions'];
        expect(reconcileColumnOrder(saved, DECLARED)).toEqual(DECLARED);
    });

    it('ignores a duplicated id rather than rendering the column twice', () => {
        const saved = ['select', 'name', 'name', 'mobile', 'email', 'created_at', 'actions'];
        expect(reconcileColumnOrder(saved, DECLARED)).toEqual(DECLARED);
    });

    /**
     * The regression that motivated this: a saved order predating a new column
     * left TanStack to append it, which put it past the actions gutter.
     */
    it('splices a newly declared column in after its declared predecessor, not at the end', () => {
        const saved = ['select', 'name', 'mobile', 'created_at', 'actions'];
        expect(reconcileColumnOrder(saved, DECLARED)).toEqual(DECLARED);
    });

    it('places several new columns in their declared run', () => {
        const saved = ['select', 'name', 'actions'];
        expect(reconcileColumnOrder(saved, DECLARED)).toEqual(DECLARED);
    });

    it('follows the declared predecessor even where the viewer has rearranged around it', () => {
        const saved = ['select', 'created_at', 'name', 'mobile', 'actions'];
        // `email` follows `mobile`, which the viewer moved to the end of the middle.
        expect(reconcileColumnOrder(saved, DECLARED)).toEqual([
            'select', 'created_at', 'name', 'mobile', 'email', 'actions',
        ]);
    });

    it('leaves a table with neither structural column alone', () => {
        const declared = ['name', 'amount'];
        expect(reconcileColumnOrder(['amount', 'name'], declared)).toEqual(['amount', 'name']);
    });

    it('always returns exactly the declared set, whatever it was given', () => {
        const saved = ['actions', 'ghost', 'email', 'email', 'select'];
        const result = reconcileColumnOrder(saved, DECLARED);
        expect([...result].sort()).toEqual([...DECLARED].sort());
    });
});
