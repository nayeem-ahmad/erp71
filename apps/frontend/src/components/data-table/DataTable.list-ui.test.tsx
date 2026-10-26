'use client';

import { act, render, screen, fireEvent, within } from '@testing-library/react';
import DataTable from './DataTable';
import type { ColumnDef } from '@tanstack/react-table';
import { useTableViewStore } from '@/components/table';
import { useTablePreferences } from './useTablePreferences';
import { naturalColumnWidth } from './column-autofit';
import type { ListFilter } from './FilterBar';
import type { ListStat } from './ListStats';

// ── Mocks (as DataTable.view-options.test.tsx, with the real preferences store) ──

jest.mock('./column-autofit', () => ({
    ...jest.requireActual('./column-autofit'),
    naturalColumnWidth: jest.fn(),
}));

jest.mock('./export-utils', () => {
    const actual = jest.requireActual('./export-utils');
    return { ...actual, exportToCSV: jest.fn(), exportToExcel: jest.fn(), exportToPDF: jest.fn(), printTable: jest.fn() };
});

jest.mock('@/lib/api', () => ({
    ...jest.requireActual('@/lib/api'),
    fetchWithAuth: jest.fn().mockResolvedValue(null),
}));

jest.mock('@/lib/hooks/useSalePrintPrefs', () => require('@/test-utils/print-paper').salePrintPrefsModuleMock());

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

let mockMdUp = true;
jest.mock('@/hooks/useMediaQuery', () => ({
    ...jest.requireActual('@/hooks/useMediaQuery'),
    useIsMdUp: () => mockMdUp,
}));

// ── Test data ─────────────────────────────────────────────────────

interface Row {
    id: string;
    name: string;
    amount: number;
}

const columns: ColumnDef<Row, any>[] = [
    { accessorKey: 'name', header: 'Name', id: 'name' },
    { accessorKey: 'amount', header: 'Amount', id: 'amount', meta: { align: 'end' } },
    { id: 'actions', header: 'Actions', cell: () => <button type="button">Go</button> },
];

const data: Row[] = [
    { id: '1', name: 'Alpha', amount: 100 },
    { id: '2', name: 'Beta', amount: 200 },
];

const props = { tableId: 'list-ui-test', columns, data, title: 'List UI test' };

const stats: ListStat[] = [
    { id: 'count', label: 'Sales', value: '248', hint: '7 cancelled' },
    { id: 'due', label: 'Due', value: '৳1,46,550', tone: 'warning' },
];

beforeEach(() => {
    window.localStorage.clear();
    act(() => useTableViewStore.getState().load('anon'));
    useTablePreferences.setState({ tables: {}, personColumns: null });
    mockMdUp = true;
    (naturalColumnWidth as jest.Mock).mockReset();
});

describe('DataTable resize grip', () => {
    it('marks every resizable column boundary with a visible grip', () => {
        const { container } = render(<DataTable {...props} viewOptions />);
        const grips = container.querySelectorAll('[data-resize-handle]');
        // Name, Amount and the actions column each take one.
        expect(grips).toHaveLength(3);
        const bar = grips[0].querySelector('span');
        expect(bar).toHaveClass('bg-gray-300', 'group-hover/resize:bg-blue-500');
        expect(grips[0]).toHaveAttribute('title', 'Drag to resize · double-click to fit');
    });

    it('keeps the grip out of the column header\'s name', () => {
        render(<DataTable {...props} viewOptions />);
        expect(screen.getByRole('columnheader', { name: 'Name' })).toBeInTheDocument();
    });

    it('fits a column to its content on a double-click', () => {
        (naturalColumnWidth as jest.Mock).mockReturnValue(212);
        const { container } = render(<DataTable {...props} viewOptions />);
        const nameHeader = screen.getByRole('columnheader', { name: 'Name' });

        fireEvent.doubleClick(nameHeader.querySelector('[data-resize-handle]')!);

        expect(naturalColumnWidth).toHaveBeenCalledWith(container.querySelector('table'), 'name');
        expect(nameHeader.style.width).toBe('212px');
    });

    it('leaves the width alone when nothing could be measured', () => {
        (naturalColumnWidth as jest.Mock).mockReturnValue(0);
        render(<DataTable {...props} viewOptions />);
        const nameHeader = screen.getByRole('columnheader', { name: 'Name' });
        const before = nameHeader.style.width;

        fireEvent.doubleClick(nameHeader.querySelector('[data-resize-handle]')!);

        expect(nameHeader.style.width).toBe(before);
    });
});

describe('DataTable stats strip', () => {
    it('draws the figures above the list, with their hints and tones', () => {
        render(<DataTable {...props} stats={{ items: stats, label: 'Sales summary' }} />);
        const strip = screen.getByRole('region', { name: 'Sales summary' });
        expect(within(strip).getByText('248')).toBeInTheDocument();
        expect(within(strip).getByText('· 7 cancelled')).toBeInTheDocument();
        expect(within(strip).getByText('৳1,46,550')).toHaveClass('text-amber-700');
    });

    it('shows placeholders while the figures load', () => {
        render(<DataTable {...props} stats={{ items: stats, loading: true, label: 'Sales summary' }} />);
        const strip = screen.getByRole('region', { name: 'Sales summary' });
        expect(strip).toHaveAttribute('aria-busy', 'true');
        expect(within(strip).queryByText('248')).not.toBeInTheDocument();
    });

    it('folds away from the toolbar and stays folded for this list', () => {
        const { unmount } = render(<DataTable {...props} stats={{ items: stats, label: 'Sales summary' }} />);
        fireEvent.click(screen.getByRole('button', { name: 'Hide summary' }));
        expect(screen.queryByRole('region', { name: 'Sales summary' })).not.toBeInTheDocument();
        unmount();

        render(<DataTable {...props} stats={{ items: stats, label: 'Sales summary' }} />);
        expect(screen.queryByRole('region', { name: 'Sales summary' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Show summary' })).toHaveAttribute('aria-pressed', 'false');
    });

    it('offers no stats button on a list without stats', () => {
        render(<DataTable {...props} />);
        expect(screen.queryByRole('button', { name: /summary/i })).not.toBeInTheDocument();
    });
});

describe('DataTable one-row toolbar', () => {
    const filters: ListFilter[] = [
        { id: 'status', type: 'multi-select', label: 'Status', value: [], onChange: jest.fn(), options: [{ value: 'OPEN', label: 'Open' }] },
        { id: 'paid', type: 'number', label: 'Paid', value: null, onChange: jest.fn(), more: true },
    ];

    it('draws the filters as chips with the rarer ones behind More, and the buttons as icons', () => {
        render(<DataTable {...props} filters={filters} filterLayout="row" />);
        expect(screen.getByRole('button', { name: 'Status' })).toHaveAttribute('aria-haspopup', 'dialog');
        expect(screen.queryByRole('button', { name: 'Paid' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'More' })).toBeInTheDocument();
        // Labels stay for screen readers; the row has no room to print them.
        expect(screen.getByText('Export')).toHaveClass('sr-only');
    });

    it('keeps the phone sheet on a phone', () => {
        mockMdUp = false;
        render(<DataTable {...props} filters={filters} filterLayout="row" />);
        expect(screen.getByRole('button', { name: /Filters/ })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'More' })).not.toBeInTheDocument();
    });
});
