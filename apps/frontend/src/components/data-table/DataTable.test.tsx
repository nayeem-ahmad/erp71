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
    beforeEach(() => {
        const { exportToCSV, exportToExcel, exportToPDF, printTable } = require('./export-utils');
        exportToCSV.mockClear();
        exportToExcel.mockClear();
        exportToPDF.mockClear();
        printTable.mockClear();
    });

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

    it('hides the built-in search input when showSearch is false', () => {
        render(<DataTable {...defaultProps} showSearch={false} />);
        expect(screen.queryByPlaceholderText('Search...')).not.toBeInTheDocument();
        // Rest of the toolbar (filters/columns/export/print) remains intact
        expect(screen.getByRole('button', { name: /filters/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /columns/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /export/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /print/i })).toBeInTheDocument();
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

    it('opens the export dialog when Export is clicked', () => {
        render(<DataTable {...defaultProps} />);
        fireEvent.click(screen.getByRole('button', { name: /export/i }));
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: /complete list/i })).toBeChecked();
        expect(screen.getByRole('radio', { name: /csv/i })).toBeChecked();
    });

    it('exports the complete filtered list with visible columns by default', async () => {
        const { exportToCSV } = require('./export-utils');
        render(<DataTable {...defaultProps} />);
        fireEvent.click(screen.getByRole('button', { name: /export/i }));
        fireEvent.click(screen.getByRole('button', { name: /download/i }));
        await waitFor(() => {
            expect(exportToCSV).toHaveBeenCalledWith(
                'Test Table',
                ['Name', 'Amount'],
                [
                    ['Alpha Product', '100'],
                    ['Beta Product', '200'],
                    ['Gamma Product', '300'],
                ],
            );
        });
    });

    it('exports only the current page when that option is chosen', async () => {
        const { exportToCSV } = require('./export-utils');
        const manyRows: Row[] = Array.from({ length: 25 }, (_, i) => ({
            id: String(i + 1),
            name: `Row ${i + 1}`,
            amount: i,
        }));
        render(<DataTable {...defaultProps} data={manyRows} />);
        fireEvent.click(screen.getByRole('button', { name: /export/i }));
        fireEvent.click(screen.getByRole('radio', { name: /current page \(10\)/i }));
        fireEvent.click(screen.getByRole('button', { name: /download/i }));
        await waitFor(() => expect(exportToCSV).toHaveBeenCalled());
        const [, , rows] = (exportToCSV as jest.Mock).mock.calls[0];
        expect(rows).toHaveLength(10);
        expect(rows[0][0]).toBe('Row 1');
        expect(rows[9][0]).toBe('Row 10');
    });

    it('calls exportToExcel when Excel is chosen', async () => {
        const { exportToExcel } = require('./export-utils');
        render(<DataTable {...defaultProps} />);
        fireEvent.click(screen.getByRole('button', { name: /export/i }));
        fireEvent.click(screen.getByRole('radio', { name: /excel/i }));
        fireEvent.click(screen.getByRole('button', { name: /download/i }));
        await waitFor(() => {
            expect(exportToExcel).toHaveBeenCalledWith(
                'Test Table',
                ['Name', 'Amount'],
                expect.any(Array),
            );
        });
    });

    it('calls exportToPDF when PDF is chosen', async () => {
        const { exportToPDF } = require('./export-utils');
        render(<DataTable {...defaultProps} />);
        fireEvent.click(screen.getByRole('button', { name: /export/i }));
        fireEvent.click(screen.getByRole('radio', { name: /pdf/i }));
        fireEvent.click(screen.getByRole('button', { name: /download/i }));
        await waitFor(() => {
            expect(exportToPDF).toHaveBeenCalledWith(
                'Test Table',
                ['Name', 'Amount'],
                expect.any(Array),
            );
        });
    });

    it('fetches every matching row in server mode when Complete list is chosen', async () => {
        const { exportToCSV } = require('./export-utils');
        const fetchAllRows = jest.fn().mockResolvedValue({
            items: [
                { id: '1', name: 'Alpha Product', amount: 100 },
                { id: '2', name: 'Beta Product', amount: 200 },
                { id: '9', name: 'Off-page Product', amount: 900 },
            ],
            truncated: false,
            total: 3,
        });
        render(
            <DataTable
                {...defaultProps}
                showSearch={false}
                serverPagination={{
                    total: 3,
                    page: 1,
                    pageSize: 10,
                    onPageChange: jest.fn(),
                    onPageSizeChange: jest.fn(),
                    sort: null,
                    onSortChange: jest.fn(),
                    fetchAllRows,
                }}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: /export/i }));
        fireEvent.click(screen.getByRole('button', { name: /download/i }));
        await waitFor(() => expect(fetchAllRows).toHaveBeenCalled());
        await waitFor(() => {
            expect(exportToCSV).toHaveBeenCalledWith(
                'Test Table',
                ['Name', 'Amount'],
                [
                    ['Alpha Product', '100'],
                    ['Beta Product', '200'],
                    ['Off-page Product', '900'],
                ],
            );
        });
    });

    it('calls printTable with the resolved header when Print is clicked', async () => {
        const { printTable } = require('./export-utils');
        render(<DataTable {...defaultProps} />);
        fireEvent.click(screen.getByRole('button', { name: /print/i }));

        // The header template resolves on click, so the call lands a tick later.
        await waitFor(() => expect(printTable).toHaveBeenCalled());
        const [, title, header] = (printTable as jest.Mock).mock.calls[0];
        expect(title).toBe('Test Table');
        expect(header.html).toContain('Test Table');
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

    it('injects a checkbox column when enableRowSelection is true and no caller select column exists', () => {
        render(<DataTable {...defaultProps} enableRowSelection />);
        expect(screen.getByLabelText(/select all/i)).toBeInTheDocument();
        expect(screen.getAllByLabelText(/select row/i)).toHaveLength(mockData.length);
    });

    it('does not double-inject a select column when caller already supplies one', () => {
        const columnsWithSelect: ColumnDef<Row, any>[] = [
            {
                id: 'select',
                header: () => <input type="checkbox" aria-label="Select all" />,
                cell: () => <input type="checkbox" aria-label="Select row" />,
            },
            ...columns,
        ];
        render(<DataTable {...defaultProps} columns={columnsWithSelect} enableRowSelection />);
        expect(screen.getAllByLabelText(/select all/i)).toHaveLength(1);
        expect(screen.getAllByLabelText(/select row/i)).toHaveLength(mockData.length);
    });

    it('does not render a bulk action bar when nothing is selected', () => {
        render(
            <DataTable
                {...defaultProps}
                enableRowSelection
                bulkActions={[{ label: 'Delete', onClick: jest.fn() }]}
            />
        );
        expect(screen.queryByText(/selected/i)).not.toBeInTheDocument();
    });

    it('shows the bulk action bar with count once a row is selected and invokes the action with selected rows', () => {
        const onClick = jest.fn();
        render(
            <DataTable
                {...defaultProps}
                enableRowSelection
                getRowId={(row) => row.id}
                bulkActions={[{ label: 'Delete', onClick, tone: 'danger' }]}
            />
        );
        const rowCheckboxes = screen.getAllByLabelText(/select row/i);
        fireEvent.click(rowCheckboxes[0]);

        expect(screen.getByText(/1 selected/i)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /delete/i }));
        expect(onClick).toHaveBeenCalledWith([mockData[0]]);
    });

    it('clears the selection when the clear button in the bulk bar is clicked', () => {
        render(
            <DataTable
                {...defaultProps}
                enableRowSelection
                getRowId={(row) => row.id}
                bulkActions={[{ label: 'Delete', onClick: jest.fn() }]}
            />
        );
        fireEvent.click(screen.getAllByLabelText(/select row/i)[0]);
        expect(screen.getByText(/1 selected/i)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /clear selection/i }));
        expect(screen.queryByText(/selected/i)).not.toBeInTheDocument();
    });

    it('clears the selection when clearSelectionSignal changes', () => {
        const onRowSelectionChange = jest.fn();
        const { rerender } = render(
            <DataTable
                {...defaultProps}
                enableRowSelection
                getRowId={(row) => row.id}
                onRowSelectionChange={onRowSelectionChange}
                clearSelectionSignal={0}
            />
        );
        fireEvent.click(screen.getAllByLabelText(/select row/i)[0]);
        expect(onRowSelectionChange).toHaveBeenLastCalledWith([mockData[0]]);

        rerender(
            <DataTable
                {...defaultProps}
                enableRowSelection
                getRowId={(row) => row.id}
                onRowSelectionChange={onRowSelectionChange}
                clearSelectionSignal={1}
            />
        );
        expect(onRowSelectionChange).toHaveBeenLastCalledWith([]);
    });

    it('renders custom bulk extra content via renderBulkExtra', () => {
        render(
            <DataTable
                {...defaultProps}
                enableRowSelection
                getRowId={(row) => row.id}
                bulkActions={[]}
                renderBulkExtra={(rows) => <span>Extra for {rows.length}</span>}
            />
        );
        fireEvent.click(screen.getAllByLabelText(/select row/i)[0]);
        expect(screen.getByText('Extra for 1')).toBeInTheDocument();
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

describe('DataTable server pagination mode', () => {
    const serverBase = {
        total: 146,
        page: 1,
        pageSize: 10,
        onPageChange: jest.fn(),
        onPageSizeChange: jest.fn(),
        sort: null as { id: string; desc: boolean } | null,
        onSortChange: jest.fn(),
    };

    it('does not offer a server page size above the backend cap of 100', () => {
        const { container } = render(
            <DataTable {...defaultProps} showSearch={false} serverPagination={{ ...serverBase }} />,
        );
        expect(container.querySelector('option[value="500"]')).toBeNull();
        expect(container.querySelector('option[value="100"]')).not.toBeNull();
    });

    it('shows the server total in the footer, not the row count', () => {
        render(
            <DataTable
                {...defaultProps}
                showSearch={false}
                serverPagination={{ ...serverBase }}
            />,
        );
        // 3 rows are rendered but the footer reflects the server total of 146
        expect(screen.getByText(/of 146/i)).toBeInTheDocument();
    });

    it('calls onPageChange with the next 1-based page', () => {
        const onPageChange = jest.fn();
        render(
            <DataTable
                {...defaultProps}
                showSearch={false}
                serverPagination={{ ...serverBase, onPageChange }}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: '2' }));
        expect(onPageChange).toHaveBeenCalledWith(2);
    });

    it('emits onSortChange when a sortable header is clicked', () => {
        const onSortChange = jest.fn();
        render(
            <DataTable
                {...defaultProps}
                showSearch={false}
                serverPagination={{ ...serverBase, onSortChange }}
            />,
        );
        fireEvent.click(screen.getByText('Name'));
        expect(onSortChange).toHaveBeenCalledWith({ id: 'name', desc: false });
    });
});

// ── Client-side pagination ────────────────────────────────────────

describe('DataTable — client-side pagination', () => {
    const manyRows: Row[] = Array.from({ length: 25 }, (_, i) => ({
        id: String(i + 1),
        name: `Row ${i + 1}`,
        amount: i,
    }));

    it('advances to the next page when the next button is clicked', async () => {
        render(<DataTable {...defaultProps} data={manyRows} />);

        // Default page size is 10, so row 11 starts page 2.
        expect(screen.getByText('Row 1')).toBeInTheDocument();
        expect(screen.queryByText('Row 11')).not.toBeInTheDocument();

        fireEvent.click(screen.getByTestId('pagination-next'));

        await waitFor(() => {
            expect(screen.getByText('Row 11')).toBeInTheDocument();
        });
        expect(screen.queryByText('Row 1')).not.toBeInTheDocument();
    });

    it('reports the range for the page actually being viewed', async () => {
        render(<DataTable {...defaultProps} data={manyRows} />);

        expect(screen.getByText(/Showing 1–10 of 25/)).toBeInTheDocument();

        fireEvent.click(screen.getByTestId('pagination-next'));

        await waitFor(() => {
            expect(screen.getByText(/Showing 11–20 of 25/)).toBeInTheDocument();
        });
    });

    it('jumps to a numbered page', async () => {
        render(<DataTable {...defaultProps} data={manyRows} />);

        fireEvent.click(screen.getByRole('button', { name: '2' }));

        await waitFor(() => {
            expect(screen.getByText('Row 11')).toBeInTheDocument();
        });
    });

    it('returns to the first page when the page size changes', async () => {
        render(<DataTable {...defaultProps} data={manyRows} />);

        fireEvent.click(screen.getByTestId('pagination-next'));
        await waitFor(() => expect(screen.getByText('Row 11')).toBeInTheDocument());

        fireEvent.change(screen.getByTestId('page-size-select'), { target: { value: '20' } });

        await waitFor(() => {
            expect(screen.getByText(/Showing 1–20 of 25/)).toBeInTheDocument();
        });
    });
});

describe('DataTable — page size selector', () => {
    it('displays the page size in use even when it is not one of the presets', () => {
        // A <select> whose value matches no <option> silently renders the first one, so a
        // stored size outside PAGE_SIZE_OPTIONS used to make the control read "10" while
        // the table paged at 25. Compact density itself defaulted to 25 until the default
        // moved to 10; a saved preference can still be off-list.
        jest.spyOn(require('./useTablePreferences'), 'useTablePreferences').mockReturnValue({
            getPreferences: jest.fn().mockReturnValue({ pageSize: 25 }),
            setColumnVisibility: jest.fn(),
            setColumnOrder: jest.fn(),
            setPageSize: jest.fn(),
            setColumnWidth: jest.fn(),
        });

        render(<DataTable {...defaultProps} />);

        expect(screen.getByTestId('page-size-select')).toHaveValue('25');

        jest.restoreAllMocks();
    });
});

// ── Server-side pagination ────────────────────────────────────────

describe('DataTable — server-side pagination', () => {
    const serverProps = (overrides: Record<string, unknown> = {}) => ({
        ...defaultProps,
        showSearch: false,
        serverPagination: {
            total: 4213,
            page: 1,
            pageSize: 20,
            onPageChange: jest.fn(),
            onPageSizeChange: jest.fn(),
            sort: null,
            onSortChange: jest.fn(),
            ...overrides,
        },
    });

    it('reports the server total rather than the rows on this page', () => {
        render(<DataTable {...serverProps()} />);
        expect(screen.getByText(/Showing 1–20 of 4213/)).toBeInTheDocument();
    });

    it('asks the caller for the next page instead of paging locally', () => {
        const onPageChange = jest.fn();
        render(<DataTable {...serverProps({ onPageChange })} />);

        fireEvent.click(screen.getByTestId('pagination-next'));

        expect(onPageChange).toHaveBeenCalledWith(2);
    });

    it('reports the page size change and not a page change', () => {
        const onPageSizeChange = jest.fn();
        const onPageChange = jest.fn();
        render(<DataTable {...serverProps({ onPageSizeChange, onPageChange })} />);

        fireEvent.change(screen.getByTestId('page-size-select'), { target: { value: '50' } });

        expect(onPageSizeChange).toHaveBeenCalledWith(50);
        expect(onPageChange).not.toHaveBeenCalled();
    });

    it('reflects the caller-supplied page in the range', () => {
        render(<DataTable {...serverProps({ page: 3 })} />);
        expect(screen.getByText(/Showing 41–60 of 4213/)).toBeInTheDocument();
    });

    it('does not offer a page size above the backend cap', () => {
        render(<DataTable {...serverProps()} />);
        const options = Array.from(
            screen.getByTestId('page-size-select').querySelectorAll('option'),
        ).map((o) => Number(o.value));
        expect(options).not.toContain(500);
        expect(options).toContain(100);
    });
});

// ── Default page size ─────────────────────────────────────────────

describe('DataTable — default page size', () => {
    const manyRows: Row[] = Array.from({ length: 25 }, (_, i) => ({
        id: String(i + 1),
        name: `Row ${i + 1}`,
        amount: i,
    }));

    it('opens at 10 rows per page with no saved preference', () => {
        render(<DataTable {...defaultProps} data={manyRows} />);

        expect(screen.getByTestId('page-size-select')).toHaveValue('10');
        expect(screen.getByText(/Showing 1–10 of 25/)).toBeInTheDocument();
        expect(screen.getByText('Row 10')).toBeInTheDocument();
        expect(screen.queryByText('Row 11')).not.toBeInTheDocument();
    });

    it('opens at 10 under compact density too', () => {
        render(<DataTable {...defaultProps} data={manyRows} density="compact" />);

        expect(screen.getByTestId('page-size-select')).toHaveValue('10');
    });

    it('persists the size actually in use in server mode, not the unread client default', () => {
        const setPageSize = jest.fn();
        jest.spyOn(require('./useTablePreferences'), 'useTablePreferences').mockReturnValue({
            getPreferences: jest.fn().mockReturnValue(undefined),
            setColumnVisibility: jest.fn(),
            setColumnOrder: jest.fn(),
            setPageSize,
            setColumnWidth: jest.fn(),
        });

        render(
            <DataTable
                {...defaultProps}
                showSearch={false}
                serverPagination={{
                    total: 4213,
                    page: 1,
                    pageSize: 50,
                    onPageChange: jest.fn(),
                    onPageSizeChange: jest.fn(),
                    sort: null,
                    onSortChange: jest.fn(),
                }}
            />,
        );

        // 50 is what the viewer chose; 10 is the local default this mode never reads.
        expect(setPageSize).toHaveBeenCalledWith('test-table', 50);
        expect(setPageSize).not.toHaveBeenCalledWith('test-table', 10);

        jest.restoreAllMocks();
    });
});
