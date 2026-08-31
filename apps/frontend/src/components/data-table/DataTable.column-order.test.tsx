'use client';

import { render, screen, act } from '@testing-library/react';
import DataTable from './DataTable';
import type { ColumnDef } from '@tanstack/react-table';
import type { TablePreferences } from './useTablePreferences';

// ── Mocks ─────────────────────────────────────────────────────────

const mockPrefsRef: { saved: TablePreferences | undefined } = { saved: undefined };
const mockSetColumnOrder = jest.fn();

jest.mock('./useTablePreferences', () => ({
    useTablePreferences: () => ({
        getPreferences: () => mockPrefsRef.saved,
        setColumnVisibility: jest.fn(),
        setColumnOrder: mockSetColumnOrder,
        setPageSize: jest.fn(),
        setColumnWidth: jest.fn(),
    }),
}));

/**
 * The dnd-kit mocks capture what the table hands the drag layer, so a test can
 * fire a drag the real sensors cannot produce in jsdom.
 */
const mockDnd: { onDragEnd?: (event: any) => void; sortableItems?: string[] } = {};

jest.mock('@dnd-kit/core', () => ({
    DndContext: ({ children, onDragEnd }: any) => {
        mockDnd.onDragEnd = onDragEnd;
        return <>{children}</>;
    },
    closestCenter: jest.fn(),
    KeyboardSensor: jest.fn(),
    PointerSensor: jest.fn(),
    useSensor: jest.fn(),
    useSensors: jest.fn(() => []),
}));

jest.mock('@dnd-kit/sortable', () => ({
    SortableContext: ({ children, items }: any) => {
        mockDnd.sortableItems = items;
        return <>{children}</>;
    },
    horizontalListSortingStrategy: jest.fn(),
    useSortable: () => ({
        attributes: {},
        listeners: {},
        setNodeRef: jest.fn(),
        transform: null,
        transition: undefined,
        isDragging: false,
    }),
}));

jest.mock('@dnd-kit/utilities', () => ({
    CSS: { Translate: { toString: () => '' } },
}));

jest.mock('@/hooks/useMediaQuery', () => ({
    useMediaQuery: () => true,
    useIsMdUp: () => true,
}));

// ── Test data ─────────────────────────────────────────────────────

interface Row {
    id: string;
    name: string;
    amount: number;
    note: string;
}

const columns: ColumnDef<Row, any>[] = [
    { accessorKey: 'name', header: 'Name', id: 'name' },
    { accessorKey: 'amount', header: 'Amount', id: 'amount' },
    { accessorKey: 'note', header: 'Note', id: 'note' },
    { id: 'actions', header: 'Actions', cell: () => <button type="button">Edit</button> },
];

const data: Row[] = [{ id: '1', name: 'Alpha', amount: 100, note: 'first' }];

const props = {
    tableId: 'order-test',
    columns,
    data,
    title: 'Order Test',
    enableRowSelection: true,
    getRowId: (row: Row) => row.id,
};

/** Header labels in the order the table actually rendered them. */
function renderedOrder(): string[] {
    return screen.getAllByRole('columnheader').map((th) => th.textContent?.trim() || 'select');
}

function savePreference(columnOrder: string[]) {
    mockPrefsRef.saved = { columnOrder, columnVisibility: {}, columnWidths: {}, pageSize: 10 };
}

// ── Tests ─────────────────────────────────────────────────────────

describe('DataTable — pinned edge columns', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockPrefsRef.saved = undefined;
        delete mockDnd.onDragEnd;
        delete mockDnd.sortableItems;
    });

    it('renders the checkbox first and the actions last with no saved preference', () => {
        render(<DataTable {...props} />);

        expect(renderedOrder()).toEqual(['select', 'Name', 'Amount', 'Note', 'Actions']);
        expect(screen.getAllByRole('columnheader')[0]).toContainElement(
            screen.getByLabelText('Select all'),
        );
    });

    it('overrides a saved order that put the actions in the middle and the checkbox last', () => {
        savePreference(['actions', 'note', 'name', 'amount', 'select']);

        render(<DataTable {...props} />);

        const order = renderedOrder();
        expect(order[0]).toBe('select');
        expect(order[order.length - 1]).toBe('Actions');
        // The viewer's arrangement of the middle columns is still honoured.
        expect(order).toEqual(['select', 'Note', 'Name', 'Amount', 'Actions']);
    });

    it('places a column the saved order predates in its declared slot, not past the actions', () => {
        // Saved before `note` existed — TanStack would otherwise append it last.
        savePreference(['select', 'name', 'amount', 'actions']);

        render(<DataTable {...props} />);

        expect(renderedOrder()).toEqual(['select', 'Name', 'Amount', 'Note', 'Actions']);
    });

    it('leaves neither pinned column as a drop target', () => {
        render(<DataTable {...props} />);

        expect(mockDnd.sortableItems).toEqual(['name', 'amount', 'note']);
    });

    it('ignores a drag that would move a column past the actions gutter', () => {
        render(<DataTable {...props} />);

        act(() => mockDnd.onDragEnd?.({ active: { id: 'name' }, over: { id: 'actions' } }));

        expect(renderedOrder()).toEqual(['select', 'Name', 'Amount', 'Note', 'Actions']);
    });

    it('ignores a drag that would move a column ahead of the checkbox', () => {
        render(<DataTable {...props} />);

        act(() => mockDnd.onDragEnd?.({ active: { id: 'note' }, over: { id: 'select' } }));

        expect(renderedOrder()).toEqual(['select', 'Name', 'Amount', 'Note', 'Actions']);
    });

    it('ignores a drag of the actions column itself', () => {
        render(<DataTable {...props} />);

        act(() => mockDnd.onDragEnd?.({ active: { id: 'actions' }, over: { id: 'name' } }));

        expect(renderedOrder()).toEqual(['select', 'Name', 'Amount', 'Note', 'Actions']);
    });

    /** The control for the three refusals above: an ordinary drag still works. */
    it('still reorders two middle columns', () => {
        render(<DataTable {...props} />);

        act(() => mockDnd.onDragEnd?.({ active: { id: 'note' }, over: { id: 'name' } }));

        expect(renderedOrder()).toEqual(['select', 'Note', 'Name', 'Amount', 'Actions']);
    });

    it('persists the reconciled order, so the stored preference stops drifting', () => {
        savePreference(['actions', 'name', 'select']);

        render(<DataTable {...props} />);

        expect(mockSetColumnOrder).toHaveBeenCalledWith('order-test', [
            'select', 'name', 'amount', 'note', 'actions',
        ]);
    });
});
