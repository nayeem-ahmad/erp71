'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
    useReactTable,
    getCoreRowModel,
    getFilteredRowModel,
    getSortedRowModel,
    getPaginationRowModel,
    flexRender,
    type ColumnDef,
    type SortingState,
    type ColumnFiltersState,
    type VisibilityState,
    type ColumnOrderState,
    type ColumnSizingState,
    type Row,
} from '@tanstack/react-table';
import {
    Search,
    SlidersHorizontal,
    Download,
    Printer,
    ChevronUp,
    ChevronDown,
    ChevronsUpDown,
    ChevronLeft,
    ChevronRight,
    ChevronsLeft,
    ChevronsRight,
    Columns3,
    X,
    FileSpreadsheet,
    FileText,
    FileDown,
    GripVertical,
    Check,
} from 'lucide-react';
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    type DragEndEvent,
} from '@dnd-kit/core';
import {
    SortableContext,
    horizontalListSortingStrategy,
    useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { formatMessage, useI18n } from '@/lib/i18n';
import { useCompactUi } from '@/contexts/CompactUiContext';
import { useIsMdUp } from '@/hooks/useMediaQuery';
import { dataTableDensity, type UiDensity } from '@/lib/ui/compact-density';
import { useTablePreferences } from './useTablePreferences';
import { exportToCSV, exportToExcel, exportToPDF, printTable } from './export-utils';
import BulkActionBar, { type BulkAction } from './BulkActionBar';

declare module '@tanstack/react-table' {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    interface ColumnMeta<TData, TValue> {
        hideOnMobile?: boolean;
    }
}

/* --------------------------------------------------------------- */
/*  Types                                                           */
/* --------------------------------------------------------------- */

export interface DataTableProps<T> {
    /** Unique ID used to persist preferences per table */
    tableId: string;
    /** Column definitions (TanStack Table format) */
    columns: ColumnDef<T, any>[];
    /** Data rows */
    data: T[];
    /** Title shown in exports and print */
    title: string;
    /** Whether data is loading */
    isLoading?: boolean;
    /** Message when no data */
    emptyMessage?: string;
    /** Icon component for empty state */
    emptyIcon?: React.ReactNode;
    /** Enable row selection checkboxes */
    enableRowSelection?: boolean;
    /** Callback when row selection changes */
    onRowSelectionChange?: (rows: T[]) => void;
    /** Stable row id accessor — keeps selection correct across data reloads (defaults to row index) */
    getRowId?: (row: T, index: number) => string;
    /** Bump this value to programmatically clear the current row selection (e.g. after a bulk action completes) */
    clearSelectionSignal?: number;
    /** Bulk actions rendered in the bulk action bar shown above the table once rows are selected */
    bulkActions?: BulkAction<T>[];
    /** Extra custom content rendered in the bulk action bar (e.g. bulk status/assign selects) */
    renderBulkExtra?: (selectedRows: T[]) => React.ReactNode;
    /** Disables bulk action buttons and the clear button (e.g. while a bulk action is in flight) */
    bulkActionsDisabled?: boolean;
    /** Custom toolbar actions (rendered after built-in buttons) */
    toolbarActions?: React.ReactNode;
    /** Search placeholder text */
    searchPlaceholder?: string;
    /** Show the built-in global search input in the toolbar (default: true). Set false when the caller renders its own (e.g. server-side) search box. */
    showSearch?: boolean;
    /** Predefined filter presets */
    filterPresets?: { label: string; filters: ColumnFiltersState }[];
    /** Table density — defaults to CompactUiContext when inside accounting module */
    density?: UiDensity;
}

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100, 500];

/* --------------------------------------------------------------- */
/*  Sortable Header Cell                                            */
/* --------------------------------------------------------------- */

function SortableHeader({
    header,
    children,
    headerClassName,
}: {
    header: any;
    children: React.ReactNode;
    headerClassName: string;
}) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
        useSortable({ id: header.id });

    const style: React.CSSProperties = {
        transform: CSS.Translate.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        cursor: 'grab',
        position: 'relative',
    };

    return (
        <th
            ref={setNodeRef}
            style={{
                ...style,
                width: header.getSize(),
                minWidth: header.getSize(),
            }}
            className={headerClassName}
        >
            <div className="flex items-center space-x-1">
                <span {...attributes} {...listeners} className="cursor-grab opacity-0 group-hover:opacity-40 transition-opacity">
                    <GripVertical className="w-3 h-3" />
                </span>
                {children}
            </div>
            {/* Column resize handle */}
            {header.column.getCanResize() && (
                <div
                    onMouseDown={header.getResizeHandler()}
                    onTouchStart={header.getResizeHandler()}
                    className={`absolute right-0 top-0 h-full w-1 cursor-col-resize select-none touch-none hover:bg-blue-400 transition-colors ${
                        header.column.getIsResizing() ? 'bg-blue-500' : 'bg-transparent'
                    }`}
                />
            )}
        </th>
    );
}

/* --------------------------------------------------------------- */
/*  Main DataTable                                                  */
/* --------------------------------------------------------------- */

export default function DataTable<T>({
    tableId,
    columns,
    data,
    title,
    isLoading = false,
    emptyMessage,
    emptyIcon,
    enableRowSelection = false,
    onRowSelectionChange,
    getRowId,
    clearSelectionSignal,
    bulkActions,
    renderBulkExtra,
    bulkActionsDisabled = false,
    toolbarActions,
    searchPlaceholder,
    showSearch = true,
    filterPresets,
    density,
}: DataTableProps<T>) {
    const { t } = useI18n();
    const compactUi = useCompactUi();
    const resolvedDensity = density ?? compactUi.density;
    const d = dataTableDensity[resolvedDensity];
    const isCompact = resolvedDensity === 'compact';
    const resolvedEmptyMessage = emptyMessage ?? t.common.noData;
    const resolvedSearchPlaceholder = searchPlaceholder ?? t.common.dataTable.searchPlaceholder;
    const prefs = useTablePreferences();
    const savedPrefs = prefs.getPreferences(tableId);
    const isMdUp = useIsMdUp();

    // Inject a checkbox selection column when the caller hasn't supplied their own `id: 'select'` column
    const hasCallerSelectColumn = useMemo(
        () => columns.some((c) => (c as { id?: string }).id === 'select'),
        [columns],
    );

    const effectiveColumns = useMemo<ColumnDef<T, any>[]>(() => {
        if (!enableRowSelection || hasCallerSelectColumn) return columns;
        const selectColumn: ColumnDef<T, any> = {
            id: 'select',
            header: ({ table }) => (
                <input
                    type="checkbox"
                    aria-label="Select all"
                    className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary/40 cursor-pointer"
                    checked={table.getIsAllPageRowsSelected()}
                    ref={(el) => {
                        if (el) el.indeterminate = table.getIsSomePageRowsSelected() && !table.getIsAllPageRowsSelected();
                    }}
                    onChange={table.getToggleAllPageRowsSelectedHandler()}
                />
            ),
            cell: ({ row }) => (
                <input
                    type="checkbox"
                    aria-label="Select row"
                    className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary/40 cursor-pointer"
                    checked={row.getIsSelected()}
                    onChange={row.getToggleSelectedHandler()}
                    onClick={(e) => e.stopPropagation()}
                />
            ),
            enableSorting: false,
            enableColumnFilter: false,
            enableResizing: false,
            enableHiding: false,
            size: 36,
        };
        return [selectColumn, ...columns];
    }, [columns, enableRowSelection, hasCallerSelectColumn]);

    // State
    const [sorting, setSorting] = useState<SortingState>([]);
    const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
    const [globalFilter, setGlobalFilter] = useState('');
    const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(
        savedPrefs?.columnVisibility ?? {},
    );
    const [columnOrder, setColumnOrder] = useState<ColumnOrderState>(
        savedPrefs?.columnOrder ?? effectiveColumns.map((c) => (c as any).accessorKey ?? (c as any).id ?? ''),
    );
    const [columnSizing, setColumnSizing] = useState<ColumnSizingState>(
        savedPrefs?.columnWidths ?? {},
    );
    const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({});
    const [pageSize, setPageSize] = useState(savedPrefs?.pageSize ?? d.defaultPageSize);

    // UI toggles
    const [showColumnSelector, setShowColumnSelector] = useState(false);
    const [showExportMenu, setShowExportMenu] = useState(false);
    const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
    const [activePreset, setActivePreset] = useState<string | null>(null);

    // Refs for click-outside
    const columnSelectorRef = useRef<HTMLDivElement>(null);
    const exportMenuRef = useRef<HTMLDivElement>(null);
    const tableScrollRef = useRef<HTMLDivElement>(null);
    const [tableCanScroll, setTableCanScroll] = useState(false);

    // DnD sensors
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
        useSensor(KeyboardSensor),
    );

    const effectiveColumnVisibility = useMemo(() => {
        if (isMdUp) return columnVisibility;

        const mobileOverrides: VisibilityState = {};
        effectiveColumns.forEach((column) => {
            const id = column.id ?? (column as { accessorKey?: string }).accessorKey;
            if (id && column.meta?.hideOnMobile) {
                mobileOverrides[id] = false;
            }
        });

        return { ...columnVisibility, ...mobileOverrides };
    }, [columnVisibility, effectiveColumns, isMdUp]);

    // Table instance
    const table = useReactTable({
        data,
        columns: effectiveColumns,
        state: {
            sorting,
            columnFilters,
            globalFilter,
            columnVisibility: effectiveColumnVisibility,
            columnOrder,
            columnSizing,
            rowSelection,
            pagination: { pageIndex: 0, pageSize },
        },
        onSortingChange: setSorting,
        onColumnFiltersChange: setColumnFilters,
        onGlobalFilterChange: setGlobalFilter,
        onColumnVisibilityChange: setColumnVisibility,
        onColumnOrderChange: setColumnOrder,
        onColumnSizingChange: setColumnSizing,
        onRowSelectionChange: setRowSelection,
        getRowId,
        getCoreRowModel: getCoreRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
        enableRowSelection,
        columnResizeMode: 'onChange',
    });

    // Persist preferences
    useEffect(() => {
        prefs.setColumnVisibility(tableId, columnVisibility);
    }, [columnVisibility]);

    useEffect(() => {
        prefs.setColumnOrder(tableId, columnOrder);
    }, [columnOrder]);

    useEffect(() => {
        prefs.setPageSize(tableId, pageSize);
    }, [pageSize]);

    useEffect(() => {
        Object.entries(columnSizing).forEach(([colId, width]) => {
            prefs.setColumnWidth(tableId, colId, width);
        });
    }, [columnSizing]);

    // Row selection callback
    useEffect(() => {
        if (onRowSelectionChange) {
            const selectedRows = table
                .getSelectedRowModel()
                .rows.map((r: Row<T>) => r.original);
            onRowSelectionChange(selectedRows);
        }
    }, [rowSelection]);

    // Programmatic selection clear — bump `clearSelectionSignal` to reset selection (e.g. after a bulk action)
    const prevClearSelectionSignal = useRef(clearSelectionSignal);
    useEffect(() => {
        if (clearSelectionSignal !== undefined && clearSelectionSignal !== prevClearSelectionSignal.current) {
            setRowSelection({});
        }
        prevClearSelectionSignal.current = clearSelectionSignal;
    }, [clearSelectionSignal]);

    useEffect(() => {
        const element = tableScrollRef.current;
        if (!element) return;

        const updateScrollState = () => {
            setTableCanScroll(element.scrollWidth > element.clientWidth + 4);
        };

        updateScrollState();
        const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateScrollState) : null;
        observer?.observe(element);
        window.addEventListener('resize', updateScrollState);

        return () => {
            observer?.disconnect();
            window.removeEventListener('resize', updateScrollState);
        };
    }, [data, effectiveColumnVisibility, isLoading, columnOrder]);

    // Click outside handlers
    useEffect(() => {
        function handleClickOutside(e: MouseEvent) {
            if (columnSelectorRef.current && !columnSelectorRef.current.contains(e.target as Node)) {
                setShowColumnSelector(false);
            }
            if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
                setShowExportMenu(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // DnD column reorder
    const handleDragEnd = useCallback(
        (event: DragEndEvent) => {
            const { active, over } = event;
            if (active && over && active.id !== over.id) {
                setColumnOrder((prev) => {
                    const oldIndex = prev.indexOf(active.id as string);
                    const newIndex = prev.indexOf(over.id as string);
                    const newOrder = [...prev];
                    newOrder.splice(oldIndex, 1);
                    newOrder.splice(newIndex, 0, active.id as string);
                    return newOrder;
                });
            }
        },
        [],
    );

    const handlePageSizeChange = (size: number) => {
        setPageSize(size);
        table.setPageSize(size);
    };

    const handlePreset = (preset: { label: string; filters: ColumnFiltersState }) => {
        if (activePreset === preset.label) {
            setColumnFilters([]);
            setActivePreset(null);
        } else {
            setColumnFilters(preset.filters);
            setActivePreset(preset.label);
        }
    };

    // Advanced filter state for individual columns
    const filterableColumns = table.getAllLeafColumns().filter(
        (c) => c.id !== 'actions' && c.id !== 'select' && c.getCanFilter(),
    );

    const totalRows = table.getFilteredRowModel().rows.length;
    const currentPage = table.getState().pagination.pageIndex;
    const totalPages = table.getPageCount();
    const startRow = currentPage * pageSize + 1;
    const endRow = Math.min((currentPage + 1) * pageSize, totalRows);

    const columnIds = useMemo(
        () => table.getVisibleLeafColumns().map((c) => c.id),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [columnOrder, columnVisibility],
    );

    const toolbarBtnBase = `${d.toolbarBtn} ${d.toolbarBtnIdle}`;

    const selectedRows = useMemo(
        () => table.getSelectedRowModel().rows.map((r: Row<T>) => r.original),
        [rowSelection, data],
    );
    const clearSelection = useCallback(() => setRowSelection({}), []);

    return (
        <div className={`bg-white ${d.wrapper} shadow-sm border border-gray-100 overflow-hidden`}>
            {/* ── Toolbar ─────────────────────────────────────────── */}
            <div className={d.toolbar}>
                <div className="flex items-center justify-between gap-3 flex-wrap">
                    {/* Search */}
                    {showSearch && (
                        <div className="relative flex-1 min-w-[200px] max-w-md">
                            <Search className={`absolute top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4 ${isCompact ? 'left-2.5' : 'left-3'}`} />
                            <input
                                type="text"
                                placeholder={resolvedSearchPlaceholder}
                                className={d.searchInput}
                                value={globalFilter}
                                onChange={(e) => setGlobalFilter(e.target.value)}
                            />
                            {globalFilter && (
                                <button
                                    onClick={() => setGlobalFilter('')}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                                >
                                    <X className="w-3.5 h-3.5" />
                                </button>
                            )}
                        </div>
                    )}

                    {/* Toolbar buttons — always aligned to the right, even when the search box is hidden */}
                    <div className="flex items-center gap-2 flex-wrap ml-auto">
                        {/* Advanced Filters */}
                        <button
                            onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
                            className={`${d.toolbarBtn} ${
                                showAdvancedFilters || columnFilters.length > 0
                                    ? 'bg-blue-50 text-blue-700 border-blue-200'
                                    : d.toolbarBtnIdle
                            }`}
                            title={t.common.dataTable.filters}
                        >
                            <SlidersHorizontal className="w-3.5 h-3.5" />
                            <span className={isCompact ? 'sr-only' : undefined}>{t.common.dataTable.filters}</span>
                            {columnFilters.length > 0 && (
                                <span className="bg-blue-600 text-white rounded-full w-4 h-4 flex items-center justify-center text-[9px]">
                                    {columnFilters.length}
                                </span>
                            )}
                        </button>

                        {/* Column Selector */}
                        <div className="relative" ref={columnSelectorRef}>
                            <button
                                onClick={() => setShowColumnSelector(!showColumnSelector)}
                                className={toolbarBtnBase}
                                title={t.common.dataTable.columns}
                            >
                                <Columns3 className="w-3.5 h-3.5" />
                                <span className={isCompact ? 'sr-only' : undefined}>{t.common.dataTable.columns}</span>
                            </button>
                            {showColumnSelector && (
                                <div className="absolute right-0 top-full mt-2 w-56 bg-white rounded-xl shadow-lg border border-gray-200 py-2 z-50 max-h-72 overflow-y-auto">
                                    {table.getAllLeafColumns()
                                        .filter((c) => c.id !== 'select')
                                        .map((column) => (
                                            <label
                                                key={column.id}
                                                className="flex items-center px-3 py-1.5 hover:bg-gray-50 cursor-pointer"
                                            >
                                                <div className={`w-4 h-4 rounded border mr-2.5 flex items-center justify-center transition-colors ${
                                                    column.getIsVisible()
                                                        ? 'bg-blue-600 border-blue-600'
                                                        : 'border-gray-300'
                                                }`}>
                                                    {column.getIsVisible() && <Check className="w-3 h-3 text-white" />}
                                                </div>
                                                <input
                                                    type="checkbox"
                                                    checked={column.getIsVisible()}
                                                    onChange={column.getToggleVisibilityHandler()}
                                                    className="sr-only"
                                                />
                                                <span className="text-sm text-gray-700 font-medium capitalize">
                                                    {typeof column.columnDef.header === 'string'
                                                        ? column.columnDef.header
                                                        : column.id}
                                                </span>
                                            </label>
                                        ))}
                                </div>
                            )}
                        </div>

                        {/* Export Menu */}
                        <div className="relative" ref={exportMenuRef}>
                            <button
                                onClick={() => setShowExportMenu(!showExportMenu)}
                                className={toolbarBtnBase}
                                title={t.common.dataTable.export}
                            >
                                <Download className="w-3.5 h-3.5" />
                                <span className={isCompact ? 'sr-only' : undefined}>{t.common.dataTable.export}</span>
                            </button>
                            {showExportMenu && (
                                <div className="absolute right-0 top-full mt-2 w-44 bg-white rounded-xl shadow-lg border border-gray-200 py-1 z-50">
                                    <button
                                        onClick={() => { exportToCSV(table, title); setShowExportMenu(false); }}
                                        className="flex items-center w-full px-3 py-2 hover:bg-gray-50 text-sm text-gray-700 font-medium"
                                    >
                                        <FileDown className="w-4 h-4 mr-2 text-green-600" />
                                        {t.common.dataTable.exportCsv}
                                    </button>
                                    <button
                                        onClick={() => { exportToExcel(table, title); setShowExportMenu(false); }}
                                        className="flex items-center w-full px-3 py-2 hover:bg-gray-50 text-sm text-gray-700 font-medium"
                                    >
                                        <FileSpreadsheet className="w-4 h-4 mr-2 text-emerald-600" />
                                        {t.common.dataTable.exportExcel}
                                    </button>
                                    <button
                                        onClick={() => { exportToPDF(table, title); setShowExportMenu(false); }}
                                        className="flex items-center w-full px-3 py-2 hover:bg-gray-50 text-sm text-gray-700 font-medium"
                                    >
                                        <FileText className="w-4 h-4 mr-2 text-red-600" />
                                        {t.common.dataTable.exportPdf}
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* Print */}
                        <button
                            onClick={() => printTable(table, title)}
                            className={toolbarBtnBase}
                            title={t.common.dataTable.print}
                        >
                            <Printer className="w-3.5 h-3.5" />
                            <span className={isCompact ? 'sr-only' : undefined}>{t.common.dataTable.print}</span>
                        </button>

                        {/* Custom toolbar actions */}
                        {toolbarActions}
                    </div>
                </div>

                {/* Filter Presets */}
                {filterPresets && filterPresets.length > 0 && (
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className={d.filterLabel}>{t.common.dataTable.quick}</span>
                        {filterPresets.map((preset) => (
                            <button
                                key={preset.label}
                                onClick={() => handlePreset(preset)}
                                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all border ${
                                    activePreset === preset.label
                                        ? 'bg-blue-50 text-blue-700 border-blue-200'
                                        : 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100'
                                }`}
                            >
                                {preset.label}
                            </button>
                        ))}
                        {columnFilters.length > 0 && (
                            <button
                                onClick={() => { setColumnFilters([]); setActivePreset(null); }}
                                className="px-2.5 py-1 rounded-lg text-xs font-bold text-red-500 bg-red-50 border border-red-200 hover:bg-red-100 transition-all"
                            >
                                {t.common.dataTable.clearAll}
                            </button>
                        )}
                    </div>
                )}

                {/* Advanced Column Filters */}
                {showAdvancedFilters && (
                    <div className="bg-gray-50 rounded-xl p-3 space-y-2">
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                            {filterableColumns.map((column) => (
                                <div key={column.id} className="space-y-1">
                                    <label className={d.filterLabel}>
                                        {typeof column.columnDef.header === 'string'
                                            ? column.columnDef.header
                                            : column.id}
                                    </label>
                                    <input
                                        type="text"
                                        placeholder={formatMessage(t.common.dataTable.filterPlaceholder, {
                                            column: typeof column.columnDef.header === 'string' ? column.columnDef.header : column.id,
                                        })}
                                        value={(column.getFilterValue() as string) ?? ''}
                                        onChange={(e) => column.setFilterValue(e.target.value || undefined)}
                                        className="w-full bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:ring-2 focus:ring-blue-500/20 focus:border-blue-300 transition-all"
                                    />
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Bulk action bar */}
                {enableRowSelection && selectedRows.length > 0 && (
                    <BulkActionBar<T>
                        count={selectedRows.length}
                        selectedRows={selectedRows}
                        actions={bulkActions ?? []}
                        onClear={clearSelection}
                        extra={renderBulkExtra?.(selectedRows)}
                        disabled={bulkActionsDisabled}
                    />
                )}
            </div>

            {/* ── Table ───────────────────────────────────────────── */}
            <div className="relative">
                {!isMdUp && tableCanScroll ? (
                    <div
                        aria-hidden
                        className="pointer-events-none absolute right-0 top-0 bottom-0 z-10 w-10 bg-gradient-to-l from-white via-white/80 to-transparent md:hidden"
                    />
                ) : null}
                <div ref={tableScrollRef} className="overflow-x-auto overflow-x-touch [scrollbar-width:thin]">
                {isLoading ? (
                    <div className={`${d.emptyState} text-center text-gray-400 font-medium text-xs`}>
                        {t.common.dataTable.loading}
                    </div>
                ) : totalRows === 0 ? (
                    <div className={`${d.emptyState} text-center`}>
                        {emptyIcon && <div className="mb-2 flex justify-center">{emptyIcon}</div>}
                        <p className="text-xs font-medium text-gray-400">
                            {resolvedEmptyMessage}
                        </p>
                    </div>
                ) : (
                    <DndContext
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragEnd={handleDragEnd}
                    >
                        <table className="w-full" style={{ tableLayout: 'fixed' }}>
                            <thead>
                                {table.getHeaderGroups().map((headerGroup) => (
                                    <tr key={headerGroup.id}>
                                        <SortableContext
                                            items={columnIds}
                                            strategy={horizontalListSortingStrategy}
                                        >
                                            {headerGroup.headers.map((header) => {
                                                const canSort = header.column.getCanSort();
                                                const sorted = header.column.getIsSorted();

                                                // Selection checkbox column: render a plain, non-draggable
                                                // header so the "select all" box lines up with the row
                                                // checkboxes instead of being offset by the drag grip.
                                                if (header.column.id === 'select') {
                                                    return (
                                                        <th
                                                            key={header.id}
                                                            style={{ width: header.getSize(), minWidth: header.getSize() }}
                                                            className={d.headerCell}
                                                        >
                                                            {header.isPlaceholder
                                                                ? null
                                                                : flexRender(header.column.columnDef.header, header.getContext())}
                                                        </th>
                                                    );
                                                }

                                                return (
                                                    <SortableHeader key={header.id} header={header} headerClassName={d.headerCell}>
                                                        <button
                                                            onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                                                            className={`flex items-center space-x-1 ${canSort ? 'cursor-pointer hover:text-gray-600' : ''}`}
                                                        >
                                                            <span>
                                                                {header.isPlaceholder
                                                                    ? null
                                                                    : flexRender(header.column.columnDef.header, header.getContext())}
                                                            </span>
                                                            {canSort && (
                                                                <span className="ml-0.5">
                                                                    {sorted === 'asc' ? (
                                                                        <ChevronUp className="w-3 h-3 text-blue-600" />
                                                                    ) : sorted === 'desc' ? (
                                                                        <ChevronDown className="w-3 h-3 text-blue-600" />
                                                                    ) : (
                                                                        <ChevronsUpDown className="w-3 h-3 opacity-30" />
                                                                    )}
                                                                </span>
                                                            )}
                                                        </button>
                                                    </SortableHeader>
                                                );
                                            })}
                                        </SortableContext>
                                    </tr>
                                ))}
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                                {table.getRowModel().rows.map((row) => (
                                    <tr key={row.id} className="hover:bg-gray-50/50 transition-colors">
                                        {row.getVisibleCells().map((cell) => (
                                            <td
                                                key={cell.id}
                                                className={d.bodyCell}
                                                style={{ width: cell.column.getSize() }}
                                            >
                                                {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </DndContext>
                )}
                </div>
                {!isMdUp && tableCanScroll ? (
                    <p className="px-3 py-1.5 text-center text-[10px] font-semibold uppercase tracking-wider text-gray-400 md:hidden">
                        {t.common.dataTable.scrollHint} →
                    </p>
                ) : null}
            </div>

            {/* ── Pagination ──────────────────────────────────────── */}
            {totalRows > 0 && (
                <div className={`${d.pagination} border-t border-gray-100 flex items-center justify-between flex-wrap gap-2`}>
                    {/* Row info */}
                    <div className="flex items-center gap-4">
                        <span className="text-xs text-gray-500 font-medium">
                            {formatMessage(t.common.showingRange, { start: startRow, end: endRow, total: totalRows })}
                        </span>

                        {/* Page size selector */}
                        <div className="flex items-center gap-1.5">
                            <span className={d.filterLabel}>{t.common.dataTable.rows}</span>
                            <select
                                value={pageSize}
                                onChange={(e) => handlePageSizeChange(Number(e.target.value))}
                                className="bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 text-xs font-bold text-gray-700 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-300"
                            >
                                {PAGE_SIZE_OPTIONS.map((size) => (
                                    <option key={size} value={size}>
                                        {size}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {/* Page navigation */}
                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => table.setPageIndex(0)}
                            disabled={!table.getCanPreviousPage()}
                            className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                        >
                            <ChevronsLeft className="w-4 h-4" />
                        </button>
                        <button
                            onClick={() => table.previousPage()}
                            disabled={!table.getCanPreviousPage()}
                            className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                        >
                            <ChevronLeft className="w-4 h-4" />
                        </button>

                        {/* Page numbers */}
                        {(() => {
                            const pages: number[] = [];
                            const maxVisible = 5;
                            let start = Math.max(0, currentPage - Math.floor(maxVisible / 2));
                            const end = Math.min(totalPages, start + maxVisible);
                            if (end - start < maxVisible) start = Math.max(0, end - maxVisible);
                            for (let i = start; i < end; i++) pages.push(i);
                            return pages.map((p) => (
                                <button
                                    key={p}
                                    onClick={() => table.setPageIndex(p)}
                                    className={`w-8 h-8 rounded-lg text-xs font-bold transition-all ${
                                        p === currentPage
                                            ? 'bg-blue-600 text-white shadow-sm'
                                            : 'text-gray-500 hover:bg-gray-50 border border-gray-200'
                                    }`}
                                >
                                    {p + 1}
                                </button>
                            ));
                        })()}

                        <button
                            onClick={() => table.nextPage()}
                            disabled={!table.getCanNextPage()}
                            className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                        >
                            <ChevronRight className="w-4 h-4" />
                        </button>
                        <button
                            onClick={() => table.setPageIndex(totalPages - 1)}
                            disabled={!table.getCanNextPage()}
                            className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                        >
                            <ChevronsRight className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
