'use client';

import { act, render, screen, fireEvent, within } from '@testing-library/react';
import DataTable from './DataTable';
import type { ColumnDef } from '@tanstack/react-table';
import { useTableViewStore } from '@/components/table';
import type { ListFilter } from './FilterBar';

// ── Mocks (as DataTable.test.tsx) ─────────────────────────────────

jest.mock('./useTablePreferences', () => ({
    useTablePreferences: () => ({
        getPreferences: jest.fn().mockReturnValue(undefined),
        setColumnVisibility: jest.fn(),
        setColumnOrder: jest.fn(),
        setPageSize: jest.fn(),
        setColumnWidth: jest.fn(),
    }),
}));

jest.mock('./export-utils', () => {
    const actual = jest.requireActual('./export-utils');
    return {
        ...actual,
        exportToCSV: jest.fn(),
        exportToExcel: jest.fn(),
        exportToPDF: jest.fn(),
        printTable: jest.fn(),
    };
});

// The letterhead is resolved on click; the request it makes says which branch.
jest.mock('@/lib/api', () => ({
    ...jest.requireActual('@/lib/api'),
    fetchWithAuth: jest.fn().mockResolvedValue(null),
}));

jest.mock('@/lib/hooks/useSalePrintPrefs', () => require('@/test-utils/print-paper').salePrintPrefsModuleMock());

// DnD kit needs pointer sensor support in jsdom — mock the whole context
jest.mock('@dnd-kit/core', () => ({
    DndContext: ({ children }: any) => <>{children}</>,
    closestCenter: jest.fn(),
    KeyboardSensor: jest.fn(),
    PointerSensor: jest.fn(),
    useSensor: jest.fn(),
    useSensors: jest.fn(() => []),
}));

jest.mock('@dnd-kit/sortable', () => ({
    SortableContext: ({ children }: any) => <>{children}</>,
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


// Desktop unless a test says otherwise: the filters sit inline there.
let mockMdUp = true;
jest.mock('@/hooks/useMediaQuery', () => ({
    ...jest.requireActual('@/hooks/useMediaQuery'),
    useIsMdUp: () => mockMdUp,
}));

// ── Test data ─────────────────────────────────────────────────────

interface Row {
    id: string;
    name: string;
    status: string;
    amount: number;
}

const columns: ColumnDef<Row, any>[] = [
    { accessorKey: 'name', header: 'Name', id: 'name' },
    { accessorKey: 'status', header: 'Status', id: 'status', filterFn: 'equalsString' },
    { accessorKey: 'amount', header: 'Amount', id: 'amount', meta: { align: 'end' } },
    { id: 'actions', header: 'Actions', cell: () => <button type="button">Go</button> },
];

const data: Row[] = [
    { id: '1', name: 'Alpha', status: 'OPEN', amount: 100 },
    { id: '2', name: 'Beta', status: 'CLOSED', amount: 200 },
    { id: '3', name: 'Gamma', status: 'OPEN', amount: 300 },
];

const props = { tableId: 'view-test', columns, data, title: 'View test' };

function resetViewStore() {
    window.localStorage.clear();
    act(() => useTableViewStore.getState().load('anon'));
}

function table(): HTMLTableElement {
    return screen.getByRole('table') as HTMLTableElement;
}

function openViewOptions() {
    fireEvent.click(screen.getByRole('button', { name: 'View options' }));
    return screen.getByRole('dialog', { name: 'View options' });
}

describe('DataTable view options', () => {
    beforeEach(resetViewStore);

    it('offers the View options menu only on a list that opts in', () => {
        const { unmount } = render(<DataTable {...props} />);
        expect(screen.queryByRole('button', { name: 'View options' })).not.toBeInTheDocument();
        unmount();
        render(<DataTable {...props} viewOptions />);
        expect(screen.getByRole('button', { name: 'View options' })).toBeInTheDocument();
    });

    it('opens on the defaults: standard spacing, 13px text, striped rows', () => {
        render(<DataTable {...props} viewOptions />);
        expect(table()).toHaveClass('dt-view');
        expect(table()).not.toHaveClass('dt-single-line');
        expect(table().style.getPropertyValue('--dt-font-size')).toBe('13px');
        expect(screen.getByText('Alpha').closest('tr')).toHaveClass('even:bg-gray-50');
    });

    it('holds compact rows to one line', () => {
        render(<DataTable {...props} viewOptions />);
        const menu = openViewOptions();
        fireEvent.click(within(menu).getByRole('button', { name: 'Compact' }));
        expect(table()).toHaveClass('dt-single-line');
        expect(within(menu).getByRole('button', { name: 'Compact' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('sets the text size for every cell', () => {
        render(<DataTable {...props} viewOptions />);
        fireEvent.click(within(openViewOptions()).getByRole('button', { name: 'XL' }));
        expect(table().style.getPropertyValue('--dt-font-size')).toBe('15px');
    });

    it('turns striping off', () => {
        render(<DataTable {...props} viewOptions />);
        fireEvent.click(within(openViewOptions()).getByRole('switch', { name: 'Striped rows' }));
        expect(screen.getByText('Alpha').closest('tr')).not.toHaveClass('even:bg-gray-50');
    });

    it('applies a change to every list unless this one is set apart', () => {
        const { unmount } = render(<DataTable {...props} viewOptions />);
        const menu = openViewOptions();
        fireEvent.click(within(menu).getByRole('switch', { name: 'This list only' }));
        fireEvent.click(within(menu).getByRole('button', { name: 'L' }));
        unmount();

        render(<DataTable {...props} tableId="another-list" viewOptions />);
        expect(table().style.getPropertyValue('--dt-font-size')).toBe('13px');
    });

    it('aligns an end column — header and cells — and centres the actions', () => {
        render(<DataTable {...props} viewOptions />);
        expect(screen.getByText('Amount').closest('th')).toHaveClass('text-end', 'tabular-nums');
        expect(screen.getByText('200').closest('td')).toHaveClass('text-end');
        expect(screen.getByText('Actions').closest('th')).toHaveClass('text-center');
        expect(screen.getAllByRole('button', { name: 'Go' })[0].closest('td')).toHaveAttribute('data-actions', 'true');
    });

    it('aligns an end column even on a list that has not opted in', () => {
        render(<DataTable {...props} />);
        expect(screen.getByText('200').closest('td')).toHaveClass('text-end');
    });
});

describe('DataTable filters', () => {
    beforeEach(() => {
        resetViewStore();
        mockMdUp = true;
    });

    const statusFilter: ListFilter = {
        id: 'status',
        type: 'select',
        label: 'Status',
        columnId: 'status',
        options: [
            { value: 'OPEN', label: 'Open' },
            { value: 'CLOSED', label: 'Closed' },
        ],
    };

    it('narrows the rows by a select bound to a column, and clears it', () => {
        render(<DataTable {...props} filters={[statusFilter]} />);
        fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'CLOSED' } });
        expect(screen.getByText('Beta')).toBeInTheDocument();
        expect(screen.queryByText('Alpha')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Clear All' }));
        expect(screen.getByText('Alpha')).toBeInTheDocument();
    });

    it('hands a page-owned select its value and changes', () => {
        const onChange = jest.fn();
        render(
            <DataTable
                {...props}
                filters={[{ ...statusFilter, columnId: undefined, value: 'OPEN', onChange }]}
            />,
        );
        expect(screen.getByLabelText('Status')).toHaveValue('OPEN');
        fireEvent.change(screen.getByLabelText('Status'), { target: { value: '' } });
        expect(onChange).toHaveBeenCalledWith(null);
    });

    it('folds the filters into a sheet on a phone and lists the active ones as chips', () => {
        mockMdUp = false;
        render(<DataTable {...props} filters={[statusFilter]} />);
        expect(screen.queryByLabelText('Status')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /Filters/ }));
        fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'OPEN' } });
        fireEvent.click(screen.getByRole('button', { name: 'Done' }));

        expect(screen.getByText('Status: Open')).toBeInTheDocument();
        expect(screen.queryByText('Beta')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Remove filter Status' }));
        expect(screen.getByText('Beta')).toBeInTheDocument();
    });
});
