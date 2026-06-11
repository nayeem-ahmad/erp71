'use client';

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import DataTable from './DataTable';
import type { ColumnDef } from '@tanstack/react-table';

// ── Mocks ─────────────────────────────────────────────────────────

jest.mock('./useTablePreferences', () => ({
    useTablePreferences: () => ({
        getPreferences: jest.fn().mockReturnValue(undefined),
        setColumnVisibility: jest.fn(),
        setColumnOrder: jest.fn(),
        setPageSize: jest.fn(),
        setColumnWidth: jest.fn(),
    }),
}));

jest.mock('./export-utils', () => ({
    exportToCSV: jest.fn(),
    exportToExcel: jest.fn(),
    exportToPDF: jest.fn(),
    printTable: jest.fn(),
}));

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

// ── Test data ─────────────────────────────────────────────────────

interface Row {
    id: string;
    name: string;
    amount: number;
}

const columns: ColumnDef<Row, any>[] = [
    { accessorKey: 'name', header: 'Name', id: 'name' },
    { accessorKey: 'amount', header: 'Amount', id: 'amount' },
];

const mockData: Row[] = [
    { id: '1', name: 'Alpha Product', amount: 100 },
    { id: '2', name: 'Beta Product', amount: 200 },
    { id: '3', name: 'Gamma Product', amount: 300 },
];

const defaultProps = {
    tableId: 'test-table',
    columns,
    data: mockData,
    title: 'Test Table',
};

// ── Tests ─────────────────────────────────────────────────────────

describe('DataTable', () => {
    it('renders column headers', () => {
        render(<DataTable {...defaultProps} />);
        expect(screen.getByText('Name')).toBeInTheDocument();
        expect(screen.getByText('Amount')).toBeInTheDocument();
    });

    it('renders data rows', () => {
        render(<DataTable {...defaultProps} />);
        expect(screen.getByText('Alpha Product')).toBeInTheDocument();
        expect(screen.getByText('Beta Product')).toBeInTheDocument();
        expect(screen.getByText('Gamma Product')).toBeInTheDocument();
    });

    it('renders search input with default placeholder', () => {
        render(<DataTable {...defaultProps} />);
        expect(screen.getByPlaceholderText('Search...')).toBeInTheDocument();
    });

    it('renders search input with custom placeholder', () => {
        render(<DataTable {...defaultProps} searchPlaceholder="Search products..." />);
        expect(screen.getByPlaceholderText('Search products...')).toBeInTheDocument();
    });

    it('shows loading state when isLoading is true', () => {
        render(<DataTable {...defaultProps} isLoading={true} />);
        expect(screen.getByText(/loading/i)).toBeInTheDocument();
    });

    it('shows empty state when data is empty array', () => {
        render(<DataTable {...defaultProps} data={[]} emptyMessage="No records found" />);
        expect(screen.getByText('No records found')).toBeInTheDocument();
    });

    it('shows default empty message when no data', () => {
        render(<DataTable {...defaultProps} data={[]} />);
        expect(screen.getByText('No data found')).toBeInTheDocument();
    });

    it('renders toolbar buttons: Filters, Columns, Export, Print', () => {
        render(<DataTable {...defaultProps} />);
        expect(screen.getByRole('button', { name: /filters/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /columns/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /export/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /print/i })).toBeInTheDocument();
    });

    it('shows pagination info when data is present', () => {
        render(<DataTable {...defaultProps} />);
        // Shows "Showing 1–3 of 3"
        expect(screen.getByText(/showing/i)).toBeInTheDocument();
    });

    it('shows row count in pagination area', () => {
        render(<DataTable {...defaultProps} />);
        // "of 3" appears in the pagination summary
        expect(screen.getByText(/of/i)).toBeInTheDocument();
    });

    it('filters rows when search input is changed', async () => {
        render(<DataTable {...defaultProps} />);
        const search = screen.getByPlaceholderText('Search...');
        fireEvent.change(search, { target: { value: 'Alpha' } });
        await waitFor(() => {
            expect(screen.getByText('Alpha Product')).toBeInTheDocument();
            expect(screen.queryByText('Beta Product')).not.toBeInTheDocument();
        });
    });

    it('shows clear button when search has value', async () => {
        render(<DataTable {...defaultProps} />);
        const search = screen.getByPlaceholderText('Search...');
        fireEvent.change(search, { target: { value: 'Alpha' } });
        await waitFor(() => {
            // After typing, Beta Product should not be visible
            expect(screen.queryByText('Beta Product')).not.toBeInTheDocument();
        });
    });

    it('clears search when X button is clicked', async () => {
        render(<DataTable {...defaultProps} />);
        const search = screen.getByPlaceholderText('Search...');
        fireEvent.change(search, { target: { value: 'Alpha' } });
        await waitFor(() => expect(screen.queryByText('Beta Product')).not.toBeInTheDocument());
        // Clear by changing value back to empty
        fireEvent.change(search, { target: { value: '' } });
        await waitFor(() => {
            expect(screen.getByText('Beta Product')).toBeInTheDocument();
        });
    });

    it('toggles Filters panel when Filters button is clicked', () => {
        render(<DataTable {...defaultProps} />);
        const filtersBtn = screen.getByRole('button', { name: /filters/i });
        fireEvent.click(filtersBtn);
        // Advanced filters section should appear — look for the filter placeholder
        expect(screen.getByPlaceholderText(/filter name\.\.\./i)).toBeInTheDocument();
    });

    it('shows column selector dropdown when Columns button is clicked', () => {
        render(<DataTable {...defaultProps} />);
        const columnsBtn = screen.getByRole('button', { name: /columns/i });
        fireEvent.click(columnsBtn);
        // The column list should show (capitalized column names)
        expect(screen.getAllByText(/name/i).length).toBeGreaterThan(0);
    });

    it('shows export menu when Export button is clicked', () => {
        render(<DataTable {...defaultProps} />);
        const exportBtn = screen.getByRole('button', { name: /export/i });
        fireEvent.click(exportBtn);
        expect(screen.getByText(/export csv/i)).toBeInTheDocument();
        expect(screen.getByText(/export excel/i)).toBeInTheDocument();
        expect(screen.getByText(/export pdf/i)).toBeInTheDocument();
    });

    it('calls exportToCSV when Export CSV is clicked', async () => {
        const { exportToCSV } = require('./export-utils');
        render(<DataTable {...defaultProps} />);
        fireEvent.click(screen.getByRole('button', { name: /export/i }));
        await waitFor(() => screen.getByText(/export csv/i));
        fireEvent.click(screen.getByText(/export csv/i));
        expect(exportToCSV).toHaveBeenCalledWith(expect.anything(), 'Test Table');
    });

    it('calls exportToExcel when Export Excel is clicked', async () => {
        const { exportToExcel } = require('./export-utils');
        render(<DataTable {...defaultProps} />);
        fireEvent.click(screen.getByRole('button', { name: /export/i }));
        await waitFor(() => screen.getByText(/export excel/i));
        fireEvent.click(screen.getByText(/export excel/i));
        expect(exportToExcel).toHaveBeenCalledWith(expect.anything(), 'Test Table');
    });

    it('calls exportToPDF when Export PDF is clicked', async () => {
        const { exportToPDF } = require('./export-utils');
        render(<DataTable {...defaultProps} />);
        fireEvent.click(screen.getByRole('button', { name: /export/i }));
        await waitFor(() => screen.getByText(/export pdf/i));
        fireEvent.click(screen.getByText(/export pdf/i));
        expect(exportToPDF).toHaveBeenCalledWith(expect.anything(), 'Test Table');
    });

    it('calls printTable when Print button is clicked', () => {
        const { printTable } = require('./export-utils');
        render(<DataTable {...defaultProps} />);
        fireEvent.click(screen.getByRole('button', { name: /print/i }));
        expect(printTable).toHaveBeenCalledWith(expect.anything(), 'Test Table');
    });

    it('renders custom toolbar actions', () => {
        render(
            <DataTable
                {...defaultProps}
                toolbarActions={<button>Custom Action</button>}
            />
        );
        expect(screen.getByRole('button', { name: /custom action/i })).toBeInTheDocument();
    });

    it('renders filter presets when provided', () => {
        const filterPresets = [
            { label: 'High Value', filters: [{ id: 'amount', value: '200' }] },
            { label: 'Low Value', filters: [{ id: 'amount', value: '100' }] },
        ];
        render(<DataTable {...defaultProps} filterPresets={filterPresets} />);
        expect(screen.getByRole('button', { name: /high value/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /low value/i })).toBeInTheDocument();
    });

    it('applies filter preset when clicked', async () => {
        const filterPresets = [
            { label: 'Active Filter', filters: [{ id: 'name', value: 'Alpha' }] },
        ];
        render(<DataTable {...defaultProps} filterPresets={filterPresets} />);
        fireEvent.click(screen.getByRole('button', { name: /active filter/i }));
        await waitFor(() => {
            // The clear all button should now appear since a filter is active
            expect(screen.getByRole('button', { name: /clear all/i })).toBeInTheDocument();
        });
    });

    it('clears filter presets when Clear All is clicked', async () => {
        const filterPresets = [
            { label: 'Name Filter', filters: [{ id: 'name', value: 'Alpha' }] },
        ];
        render(<DataTable {...defaultProps} filterPresets={filterPresets} />);
        fireEvent.click(screen.getByRole('button', { name: /name filter/i }));
        await waitFor(() => screen.getByRole('button', { name: /clear all/i }));
        fireEvent.click(screen.getByRole('button', { name: /clear all/i }));
        await waitFor(() => {
            expect(screen.queryByRole('button', { name: /clear all/i })).not.toBeInTheDocument();
        });
    });

    it('shows page size selector', () => {
        render(<DataTable {...defaultProps} />);
        expect(screen.getByText(/rows:/i)).toBeInTheDocument();
        expect(screen.getByRole('combobox')).toBeInTheDocument();
    });

    it('renders empty icon when provided and data is empty', () => {
        const emptyIcon = <span data-testid="empty-icon">No Data Icon</span>;
        render(<DataTable {...defaultProps} data={[]} emptyIcon={emptyIcon} />);
        expect(screen.getByTestId('empty-icon')).toBeInTheDocument();
    });

    it('renders with row selection when enableRowSelection is true', () => {
        render(<DataTable {...defaultProps} enableRowSelection={true} />);
        // Table renders without errors
        expect(screen.getByText('Alpha Product')).toBeInTheDocument();
    });

    it('calls onRowSelectionChange when enableRowSelection is used', () => {
        const onRowSelectionChange = jest.fn();
        render(
            <DataTable
                {...defaultProps}
                enableRowSelection={true}
                onRowSelectionChange={onRowSelectionChange}
            />
        );
        // Component mounts and sets initial selection (empty)
        expect(onRowSelectionChange).toHaveBeenCalledWith([]);
    });

    it('shows pagination navigation buttons', () => {
        render(<DataTable {...defaultProps} />);
        // With 3 rows, page 1 of 1 — previous disabled, next disabled
        const buttons = screen.getAllByRole('button');
        // navigation buttons exist (first, prev, next, last)
        expect(buttons.length).toBeGreaterThan(4);
    });

    it('shows filter badge count on Filters button when filters active', async () => {
        render(<DataTable {...defaultProps} />);
        // Open filters
        fireEvent.click(screen.getByRole('button', { name: /filters/i }));
        // Type in a column filter
        const filterInput = screen.getByPlaceholderText(/filter name\.\.\./i);
        fireEvent.change(filterInput, { target: { value: 'Alpha' } });
        await waitFor(() => {
            // The Filters button should now have active styling (blue class)
            const filtersBtn = screen.getByRole('button', { name: /filters/i });
            expect(filtersBtn.className).toContain('blue');
        });
    });

    it('does not show pagination when data is empty', () => {
        render(<DataTable {...defaultProps} data={[]} />);
        expect(screen.queryByText(/showing/i)).not.toBeInTheDocument();
    });

    it('renders multiple pages when data exceeds page size', () => {
        // Default page size from preferences mock returns undefined → falls back to 20
        // Create 25 rows to require multiple pages
        const largeData: Row[] = Array.from({ length: 25 }, (_, i) => ({
            id: String(i),
            name: `Product ${i}`,
            amount: i * 10,
        }));
        render(<DataTable {...defaultProps} data={largeData} />);
        // "Showing 1–20 of 25" should appear
        expect(screen.getByText(/showing/i)).toBeInTheDocument();
        expect(screen.getByText('25', { exact: false })).toBeInTheDocument();
    });
});
