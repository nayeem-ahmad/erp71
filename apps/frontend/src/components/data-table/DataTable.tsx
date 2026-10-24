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
    type Column,
    type Updater,
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
import { stripedRowClass } from '@/lib/ui/striped-row';
import { useTablePreferences } from './useTablePreferences';
import FilterBar, { type ListFilter, type ResolvedListFilter } from './FilterBar';
import { TableViewOptions, useTableViewSettings, TABLE_DENSITY_CLASSES, TABLE_FONT_PX, TABLE_ROW_CLASSES, type TableViewLayout } from '@/components/table';
import {
    columnDefId,
    isPinnedColumnId,
    reconcileColumnOrder,
    PINNED_FIRST_COLUMN_ID,
    PINNED_LAST_COLUMN_ID,
} from './column-order';
import { exportToCSV, exportToExcel, exportToPDF, printTable, buildExportMatrix, exportableColumnLabel, isExportableColumnId, valueFromColumn } from './export-utils';
import { renderHeaderHtml, sheetPaper } from '@/lib/print';
import type { HeaderContext } from '@/lib/print';
import { usePrintHeader } from '@/lib/print/use-print-header';
import { printBranch } from '@/lib/print/print-branch';
import { resolvePrintPaper } from '@/lib/hooks/useSalePrintPrefs';
import BulkActionBar, { type BulkAction } from './BulkActionBar';
import ExportDialog, { type ExportFormat, type ExportRowScope } from './ExportDialog';
import { toast } from '@/lib/toast';

declare module '@tanstack/react-table' {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    interface ColumnMeta<TData, TValue> {
        hideOnMobile?: boolean;
        /**
         * `end` for amounts, quantities and counts: header and cells aligned to
         * the end edge, with even-width digits, so a column of figures lines up
         * on its last digit — on paper too.
         */
        align?: 'start' | 'center' | 'end';
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
    /** Show the built-in global search input in the toolbar (default: true). Set false when the caller renders its own search box. */
    showSearch?: boolean;
    /**
     * The toolbar search box reports each change here and does not filter the
     * rows on screen. A server-paginated list debounces this and sends it with
     * the query. Leave unset and the box filters the loaded rows.
     */
    onSearchChange?: (query: string) => void;
    /**
     * The text the toolbar box shows when the page owns the query. A remembered
     * search arrives after mount, so the box cannot keep its own copy.
     */
    searchValue?: string;
    /** Predefined filter presets */
    filterPresets?: { label: string; filters: ColumnFiltersState }[];
    /**
     * False to offer no per-column filters at all — for a server-paginated report
     * whose rows cannot be filtered on their own (a stock card's running balance
     * is positional). The Filters button is left out whenever no column can filter.
     */
    enableColumnFilters?: boolean;
    /** Table density — defaults to CompactUiContext when inside accounting module */
    density?: UiDensity;
    /**
     * Opens a row: clicking anywhere on it that is not itself a control, or
     * Enter on the focused row. Buttons, links and inputs inside keep their own
     * clicks.
     */
    onRowClick?: (row: T) => void;
    /** Extra classes per row — a selected row, one just added. */
    rowClassName?: (row: T) => string | undefined;
    /**
     * Alternating row fill and a blue hover wash. Off by default: most lists
     * keep the faint gray hover they already have.
     */
    striped?: boolean;
    /**
     * Draws the list with the person's view settings — row spacing, text size,
     * striping, fit-to-width — and adds the View options menu to the toolbar.
     * Every cell then takes the table's one text size and weight, and the
     * actions column is centred. Piloted on Sales Orders before every list
     * takes it.
     */
    viewOptions?: boolean;
    /** Another way to read the same rows, chosen at the top of View options. Needs `viewOptions`. */
    viewLayout?: TableViewLayout;
    /**
     * The list's filters, drawn in the toolbar beside the search box (and in a
     * bottom sheet on a phone). See `ListFilter`.
     */
    filters?: ListFilter[];
    /** Opt-in server-side pagination + sorting. When set, the table drives page/size/sort
     *  through these callbacks and uses `total` for the footer count instead of the
     *  client row count. Pages using this pass `onSearchChange` so the toolbar box
     *  searches the server, or set `showSearch={false}` and render their own box.
     *  IMPORTANT: `onPageSizeChange` consumers MUST also reset the current page to 1 when
     *  the page size changes (see the leads page), or the new page size can be requested
     *  against a stale page index and return an empty/mismatched result. */
    serverPagination?: {
        total: number;
        page: number;
        pageSize: number;
        onPageChange: (page: number) => void;
        onPageSizeChange: (size: number) => void;
        sort: { id: string; desc: boolean } | null;
        onSortChange: (sort: { id: string; desc: boolean } | null) => void;
        /** Walk the current filtered list for a complete-list export. */
        fetchAllRows?: (onProgress?: (loaded: number, total: number) => void) => Promise<{
            items: T[];
            truncated: boolean;
            total: number;
        }>;
        /** The advanced column filters, owned by the page so it can send them to the server.
         *  When `onColumnFiltersChange` is set the table stops filtering rows itself: a
         *  filter applied to one page's rows splits its matches across pages and leaves the
         *  total counting rows that do not match. Without it, the filters still only narrow
         *  the rows of the page on screen. */
        columnFilters?: ColumnFiltersState;
        onColumnFiltersChange?: (filters: ColumnFiltersState) => void;
    };
}

/** Whether a click started on something with a click of its own inside a row. */
function isFromControl(target: EventTarget | null): boolean {
    return target instanceof Element
        && !!target.closest('button, a, input, select, textarea, label, [role="button"], [role="menuitem"]');
}

/** The label around a selection checkbox — see the injected `select` column. */
const SELECT_HIT_AREA =
    'inline-flex cursor-pointer items-center justify-center max-md:min-h-touch max-md:min-w-touch';

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100, 500];
/** Mirrors the backend `PaginationDto` hard cap on `take` (e.g. crm-leads.service.ts). Server-mode
 *  page-size options must not exceed this, or requesting a larger size silently gets clamped
 *  server-side while the client still believes it fetched that many rows. */
const SERVER_MAX_PAGE_SIZE = 100;

/* --------------------------------------------------------------- */
/*  Header Cells                                                    */
/* --------------------------------------------------------------- */

type ColumnAlign = 'start' | 'center' | 'end';

const JUSTIFY_CLASS: Record<ColumnAlign, string> = {
    start: '',
    center: 'justify-center',
    end: 'justify-end',
};

const TEXT_ALIGN_CLASS: Record<ColumnAlign, string> = {
    start: '',
    center: 'text-center',
    // A figure never wraps — "৳" on one line and the digits on the next reads as two values.
    end: 'text-end tabular-nums whitespace-nowrap text-ellipsis',
};

/**
 * The label and its sort control — identical whether the cell is draggable.
 * An end-aligned column puts the arrow before the label, so the label ends
 * flush with the figures under it.
 */
function HeaderLabel({ header, align = 'start' }: { header: any; align?: ColumnAlign }) {
    const canSort = header.column.getCanSort();
    const sorted = header.column.getIsSorted();

    return (
        <button
            onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
            className={`flex items-center gap-1 ${align === 'end' ? 'flex-row-reverse' : ''} ${canSort ? 'cursor-pointer hover:text-gray-600' : ''}`}
        >
            <span>
                {header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext())}
            </span>
            {canSort && (
                <span>
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
    );
}

/** The resize grip on the cell's end edge, for a column that allows it. */
function ResizeHandle({ header }: { header: any }) {
    if (!header.column.getCanResize()) return null;
    return (
        <div
            onMouseDown={header.getResizeHandler()}
            onTouchStart={header.getResizeHandler()}
            className={`absolute end-0 top-0 h-full w-1 cursor-col-resize select-none touch-none hover:bg-blue-400 transition-colors ${
                header.column.getIsResizing() ? 'bg-blue-500' : 'bg-transparent'
            }`}
        />
    );
}

function SortableHeader({
    header,
    headerClassName,
    widthStyle,
    align = 'start',
    floatingGrip = false,
}: {
    header: any;
    headerClassName: string;
    widthStyle: React.CSSProperties;
    align?: ColumnAlign;
    /** Pilot lists (`viewOptions`) float the grip so labels line up with values. */
    floatingGrip?: boolean;
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
                ...widthStyle,
            }}
            className={`${headerClassName} ${TEXT_ALIGN_CLASS[align]}`}
        >
            {floatingGrip ? (
                <>
                    {/* The grip floats in the cell's start padding, so the label
                        starts where the values under it do. */}
                    <span
                        {...attributes}
                        {...listeners}
                        className="absolute start-0 top-1/2 -translate-y-1/2 cursor-grab opacity-0 group-hover:opacity-40 transition-opacity"
                    >
                        <GripVertical className="w-2.5 h-3" />
                    </span>
                    <div className={`flex items-center ${JUSTIFY_CLASS[align]}`}>
                        <HeaderLabel header={header} align={align} />
                    </div>
                </>
            ) : (
                <div className={`flex items-center space-x-1 rtl:space-x-reverse ${JUSTIFY_CLASS[align]}`}>
                    <span {...attributes} {...listeners} className="cursor-grab opacity-0 group-hover:opacity-40 transition-opacity">
                        <GripVertical className="w-3 h-3" />
                    </span>
                    <HeaderLabel header={header} align={align} />
                </div>
            )}
            <ResizeHandle header={header} />
        </th>
    );
}

/**
 * The actions header: same cell as a draggable one minus the grip, since the
 * column is pinned to the end edge. It keeps the resize handle — most tables
 * leave their actions column resizable, and the gutter is exactly the width
 * people adjust.
 */
function PinnedHeader({
    header,
    headerClassName,
    widthStyle,
    align = 'start',
}: {
    header: any;
    headerClassName: string;
    widthStyle: React.CSSProperties;
    align?: ColumnAlign;
}) {
    return (
        <th
            style={{
                position: 'relative',
                ...widthStyle,
            }}
            className={`${headerClassName} ${TEXT_ALIGN_CLASS[align]}`}
        >
            <div className={`flex items-center ${JUSTIFY_CLASS[align]}`}>
                <HeaderLabel header={header} align={align} />
            </div>
            <ResizeHandle header={header} />
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
    onSearchChange,
    searchValue: searchValueProp,
    filterPresets,
    enableColumnFilters = true,
    density,
    serverPagination,
    onRowClick,
    rowClassName,
    striped: stripedProp = false,
    viewOptions = false,
    viewLayout,
    filters,
}: DataTableProps<T>) {
    const { t } = useI18n();
    // Lazy: every list page renders this table, but printing is a rare click.
    const printHeader = usePrintHeader('LIST_REPORT', { eager: false });
    const compactUi = useCompactUi();
    const resolvedDensity = density ?? compactUi.density;
    const d = dataTableDensity[resolvedDensity];
    const isCompact = resolvedDensity === 'compact';
    const resolvedEmptyMessage = emptyMessage ?? t.common.noData;
    const resolvedSearchPlaceholder = searchPlaceholder ?? t.common.dataTable.searchPlaceholder;
    const prefs = useTablePreferences();
    const savedPrefs = prefs.getPreferences(tableId);
    /**
     * What the member has saved for this list, as a comparable key, once their
     * preferences have loaded — `null` before (and in the modes that never load
     * them). Watched so the list can follow what loads after it opened.
     */
    const personEntryKey = prefs.personColumns ? JSON.stringify(prefs.personColumns[tableId] ?? null) : null;
    const isMdUp = useIsMdUp();
    const { settings: view } = useTableViewSettings(tableId);
    const rowToneClass = viewOptions
        ? view.striped ? TABLE_ROW_CLASSES.striped : TABLE_ROW_CLASSES.plain
        : stripedProp ? stripedRowClass : 'hover:bg-gray-50/50 transition-colors';
    /** Compact rows hold to one line; stacked cell content runs along it. */
    const singleLine = viewOptions && view.density === 'compact';
    /** A phone keeps sideways scrolling — eight columns in 360px read as none. */
    const fitWidth = viewOptions && view.fitWidth && isMdUp;
    const headerCellClass = viewOptions
        ? `text-start font-medium text-gray-500 select-none group bg-gray-50 border-b border-gray-200 ${TABLE_DENSITY_CLASSES[view.density].headerCell}`
        : d.headerCell;
    const bodyCellClass = viewOptions
        ? `align-middle ${TABLE_DENSITY_CLASSES[view.density].bodyCell}${singleLine || fitWidth ? ' overflow-hidden' : ''}`
        : d.bodyCell;

    // Inject a checkbox selection column when the caller hasn't supplied their own `id: 'select'` column
    const hasCallerSelectColumn = useMemo(
        () => columns.some((c) => (c as { id?: string }).id === 'select'),
        [columns],
    );

    const effectiveColumns = useMemo<ColumnDef<T, any>[]>(() => {
        if (!enableRowSelection || hasCallerSelectColumn) return columns;
        const selectColumn: ColumnDef<T, any> = {
            id: 'select',
            // The box stays 16px; the label around it is the 44px target a
            // finger needs on a phone, and collapses to the box on desktop so
            // the rows keep their density.
            header: ({ table }) => (
                <label className={SELECT_HIT_AREA}>
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
                </label>
            ),
            cell: ({ row }) => (
                // A click anywhere in the target must not also open the row.
                <label className={SELECT_HIT_AREA} onClick={(e) => e.stopPropagation()}>
                    <input
                        type="checkbox"
                        aria-label="Select row"
                        className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary/40 cursor-pointer"
                        checked={row.getIsSelected()}
                        onChange={row.getToggleSelectedHandler()}
                        onClick={(e) => e.stopPropagation()}
                    />
                </label>
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
    /** What the box shows when the page owns the query (`onSearchChange`). */
    const [searchText, setSearchText] = useState('');
    const remoteSearch = !!onSearchChange;
    const shownSearch = remoteSearch ? (searchValueProp ?? searchText) : globalFilter;
    const setSearchValue = (next: string) => {
        if (onSearchChange) {
            if (searchValueProp === undefined) setSearchText(next);
            onSearchChange(next);
        } else {
            setGlobalFilter(next);
        }
    };
    const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(
        savedPrefs?.columnVisibility ?? {},
    );
    // Holds only what has been saved or dragged. The order the table actually
    // renders in is `effectiveColumnOrder` below, which reconciles this against
    // the columns currently declared — an empty state is simply "declared order".
    const [columnOrder, setColumnOrder] = useState<ColumnOrderState>(
        savedPrefs?.columnOrder ?? [],
    );
    const [columnSizing, setColumnSizing] = useState<ColumnSizingState>(
        savedPrefs?.columnWidths ?? {},
    );
    const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({});
    const [pageSize, setPageSize] = useState(savedPrefs?.pageSize ?? d.defaultPageSize);
    /** Client-mode page index. In server mode the page lives in `serverPagination`. */
    const [clientPageIndex, setClientPageIndex] = useState(0);

    /*
     * Column choices are saved only from the viewer's own change — the column
     * menu, a header drag, the rows-per-page box — never on mount. Saving on
     * mount would turn whatever the list opened with (the built-in columns, a
     * profile's, or this browser's before preferences loaded) into the member's
     * own answer.
     *
     * Until the viewer changes one of these on this list, it follows what is
     * saved: preferences that load after the list opened (a first visit paints
     * before them) re-seed it, as does a refresh that brings a newer answer.
     * Once they have changed it, their change stands.
     */
    const changedByViewer = useRef({ visibility: false, order: false, pageSize: false });
    /** What the next change builds on — a second change in one tick lands before the re-render. */
    const latestVisibility = useRef(columnVisibility);
    latestVisibility.current = columnVisibility;
    const latestOrder = useRef(columnOrder);
    latestOrder.current = columnOrder;
    const seededFrom = useRef(personEntryKey);

    useEffect(() => {
        if (personEntryKey === null || personEntryKey === seededFrom.current) return;
        seededFrom.current = personEntryKey;
        const saved = prefs.getPreferences(tableId);
        const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
        if (!changedByViewer.current.visibility) {
            const next = saved?.columnVisibility ?? {};
            setColumnVisibility((current) => (same(current, next) ? current : next));
        }
        if (!changedByViewer.current.order) {
            const next = saved?.columnOrder ?? [];
            setColumnOrder((current) => (same(current, next) ? current : next));
        }
        if (!changedByViewer.current.pageSize) {
            const next = saved?.pageSize ?? d.defaultPageSize;
            if (next !== pageSize) {
                setPageSize(next);
                setClientPageIndex(0);
            }
        }
        // Keyed on what is saved; `prefs` itself changes with every width drag.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [personEntryKey, tableId]);

    // UI toggles
    const [showColumnSelector, setShowColumnSelector] = useState(false);
    const [showExportDialog, setShowExportDialog] = useState(false);
    const [exportBusy, setExportBusy] = useState(false);
    const [exportProgress, setExportProgress] = useState<{ loaded: number; total: number } | null>(null);
    const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
    const [activePreset, setActivePreset] = useState<string | null>(null);

    // Refs for click-outside
    const columnSelectorRef = useRef<HTMLDivElement>(null);
    const tableScrollRef = useRef<HTMLDivElement>(null);
    const [tableCanScroll, setTableCanScroll] = useState(false);
    /** The scroller's width, which fit-to-width shares out between the columns. */
    const [containerWidth, setContainerWidth] = useState(0);

    // DnD sensors
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
        useSensor(KeyboardSensor),
    );

    const declaredColumnIds = useMemo(
        () => effectiveColumns.map(columnDefId),
        [effectiveColumns],
    );

    /**
     * What the table renders. Derived rather than stored so it re-settles when
     * the column set changes mid-session — the leads list, for one, grows its
     * custom-field columns after a fetch resolves.
     */
    const effectiveColumnOrder = useMemo(
        () => reconcileColumnOrder(columnOrder, declaredColumnIds),
        [columnOrder, declaredColumnIds],
    );

    const changeColumnVisibility = (updater: Updater<VisibilityState>) => {
        const next = typeof updater === 'function' ? updater(latestVisibility.current) : updater;
        latestVisibility.current = next;
        changedByViewer.current.visibility = true;
        setColumnVisibility(next);
        prefs.setColumnVisibility(tableId, next);
    };

    /**
     * Applies and saves a new order. It is reconciled first — the saved order can
     * predate a column — and saved whole, so the stored one stops drifting.
     */
    const changeColumnOrder = (updater: Updater<ColumnOrderState>) => {
        const current = reconcileColumnOrder(latestOrder.current, declaredColumnIds);
        const next = typeof updater === 'function' ? updater(current) : updater;
        latestOrder.current = next;
        changedByViewer.current.order = true;
        setColumnOrder(next);
        prefs.setColumnOrder(tableId, next);
    };

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

    const isServer = !!serverPagination;
    const serverSorting: SortingState = serverPagination?.sort
        ? [{ id: serverPagination.sort.id, desc: serverPagination.sort.desc }]
        : [];
    const effectivePageSize = serverPagination ? serverPagination.pageSize : pageSize;
    const effectivePageIndex = serverPagination ? serverPagination.page - 1 : clientPageIndex;

    const onServerColumnFiltersChange = serverPagination?.onColumnFiltersChange;
    const isServerFiltering = isServer && !!onServerColumnFiltersChange;
    const activeColumnFilters = isServerFiltering ? serverPagination?.columnFilters ?? [] : columnFilters;
    const applyColumnFilters = useCallback(
        (next: ColumnFiltersState) => {
            if (onServerColumnFiltersChange) onServerColumnFiltersChange(next);
            else {
                setColumnFilters(next);
                // Page 3 of the unfiltered list can be past the end of the filtered one.
                setClientPageIndex(0);
            }
        },
        [onServerColumnFiltersChange],
    );

    // The selector renders `effectivePageSize` as its value, so that size MUST exist as an
    // option: a <select> whose value matches no <option> silently displays the first one.
    // Compact density defaults to 25, which is not a preset — the control read "10" while
    // the table paged at 25. A saved preference can be off-list the same way.
    const pageSizeOptions = useMemo(() => {
        const base = isServer
            ? PAGE_SIZE_OPTIONS.filter((s) => s <= SERVER_MAX_PAGE_SIZE)
            : PAGE_SIZE_OPTIONS;
        return base.includes(effectivePageSize)
            ? base
            : [...base, effectivePageSize].sort((a, b) => a - b);
    }, [isServer, effectivePageSize]);

    // Table instance
    const table = useReactTable({
        data,
        columns: effectiveColumns,
        state: {
            sorting: isServer ? serverSorting : sorting,
            columnFilters: activeColumnFilters,
            // A remote query must not also hide rows on this page.
            globalFilter: remoteSearch ? '' : globalFilter,
            columnVisibility: effectiveColumnVisibility,
            columnOrder: effectiveColumnOrder,
            columnSizing,
            rowSelection,
            pagination: { pageIndex: effectivePageIndex, pageSize: effectivePageSize },
        },
        onSortingChange: isServer
            ? (updater) => {
                  const next =
                      typeof updater === 'function' ? updater(serverSorting) : updater;
                  const first = next[0] ?? null;
                  serverPagination!.onSortChange(
                      first ? { id: first.id, desc: first.desc } : null,
                  );
              }
            : setSorting,
        onColumnFiltersChange: (updater) =>
            applyColumnFilters(typeof updater === 'function' ? updater(activeColumnFilters) : updater),
        onGlobalFilterChange: setGlobalFilter,
        onColumnVisibilityChange: changeColumnVisibility,
        onColumnOrderChange: changeColumnOrder,
        onColumnSizingChange: setColumnSizing,
        onRowSelectionChange: setRowSelection,
        // `pagination` is supplied in `state`, which makes it fully controlled — so this
        // handler is mandatory in BOTH modes. Client mode previously passed `undefined`,
        // leaving the table permanently on page 1: setPageIndex/nextPage had nowhere to
        // write. It went unnoticed while list endpoints were truncated to one page's worth
        // of rows, and became reachable as soon as those pages loaded their full result set.
        onPaginationChange: (updater) => {
            const prev = { pageIndex: effectivePageIndex, pageSize: effectivePageSize };
            const next = typeof updater === 'function' ? updater(prev) : updater;

            if (isServer) {
                if (next.pageSize !== prev.pageSize) {
                    serverPagination!.onPageSizeChange(next.pageSize);
                } else if (next.pageIndex !== prev.pageIndex) {
                    serverPagination!.onPageChange(next.pageIndex + 1);
                }
                return;
            }

            if (next.pageSize !== prev.pageSize) {
                // Row 40 is on a different page at 20/page than at 50/page, so holding the
                // index across a size change lands somewhere arbitrary — or past the end.
                setPageSize(next.pageSize);
                setClientPageIndex(0);
            } else {
                setClientPageIndex(next.pageIndex);
            }
        },
        getRowId,
        getCoreRowModel: getCoreRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
        enableRowSelection,
        enableColumnFilters,
        columnResizeMode: 'onChange',
        manualPagination: isServer,
        manualSorting: isServer,
        manualFiltering: isServerFiltering,
        pageCount: isServer
            ? Math.max(1, Math.ceil(serverPagination!.total / serverPagination!.pageSize))
            : undefined,
    });

    // Widths are this browser's, and only ever written here. Visibility, order and
    // page size are saved by the change handlers (see `changedByViewer`), not on mount.
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
            setContainerWidth(element.clientWidth);
        };

        updateScrollState();
        const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateScrollState) : null;
        observer?.observe(element);
        window.addEventListener('resize', updateScrollState);

        return () => {
            observer?.disconnect();
            window.removeEventListener('resize', updateScrollState);
        };
    }, [data, effectiveColumnVisibility, isLoading, effectiveColumnOrder, fitWidth]);

    // Click outside handlers
    useEffect(() => {
        function handleClickOutside(e: MouseEvent) {
            if (columnSelectorRef.current && !columnSelectorRef.current.contains(e.target as Node)) {
                setShowColumnSelector(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // DnD column reorder
    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        if (!active || !over || active.id === over.id) return;
        const activeId = String(active.id);
        const overId = String(over.id);
        // Neither edge column can be dragged or dropped onto. The headers
        // below already withhold their grips and leave them out of the
        // sortable set, so this is the belt to that pair of braces.
        if (isPinnedColumnId(activeId) || isPinnedColumnId(overId)) return;
        // Reconciled first: the saved order can predate a column, and
        // splicing at an index of -1 would drop the last one instead.
        const current = reconcileColumnOrder(latestOrder.current, declaredColumnIds);
        const from = current.indexOf(activeId);
        const to = current.indexOf(overId);
        if (from === -1 || to === -1) return;
        const next = [...current];
        next.splice(from, 1);
        next.splice(to, 0, activeId);
        changeColumnOrder(next);
    };

    // Routed through the table so both modes take the single path in `onPaginationChange`
    // (which also resets to page 1). Setting `pageSize` here as well would fork that logic
    // and, in server mode, write a client page size that nothing reads. The size saved is
    // the one picked, in either mode — in server mode it lives in `serverPagination`.
    const handlePageSizeChange = (size: number) => {
        changedByViewer.current.pageSize = true;
        table.setPageSize(size);
        prefs.setPageSize(tableId, size);
    };

    const handlePreset = (preset: { label: string; filters: ColumnFiltersState }) => {
        if (activePreset === preset.label) {
            applyColumnFilters([]);
            setActivePreset(null);
        } else {
            applyColumnFilters(preset.filters);
            setActivePreset(preset.label);
        }
    };

    // Advanced filter state for individual columns. A column one of the
    // list's own filters already narrows is left to that filter.
    const boundFilterColumns = new Set(
        (filters ?? []).flatMap((f) => (f.type === 'select' && f.columnId ? [f.columnId] : [])),
    );
    const filterableColumns = table.getAllLeafColumns().filter(
        (c) => !isPinnedColumnId(c.id) && c.getCanFilter() && !boundFilterColumns.has(c.id),
    );
    const advancedFiltersLabel = filters?.length ? t.common.dataTable.moreFilters : t.common.dataTable.filters;
    /** Only what the advanced panel itself narrows — the filter bar shows its own. */
    const advancedFilterCount = activeColumnFilters.filter((f) => !boundFilterColumns.has(f.id)).length;

    const totalRows = isServer
        ? serverPagination!.total
        : table.getFilteredRowModel().rows.length;
    const currentPage = table.getState().pagination.pageIndex;
    const totalPages = table.getPageCount();
    const startRow = currentPage * effectivePageSize + 1;
    const endRow = Math.min((currentPage + 1) * effectivePageSize, totalRows);

    /** Drop targets for the header drag — the pinned edges are not among them. */
    const columnIds = useMemo(
        () => table.getVisibleLeafColumns().map((c) => c.id).filter((id) => !isPinnedColumnId(id)),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [effectiveColumnOrder, columnVisibility],
    );

    const toolbarBtnBase = `${d.toolbarBtn} ${d.toolbarBtnIdle}`;

    /*
     * Column widths. Normally each column is its own size in px and a wide list
     * scrolls. Fit-to-width shares the scroller's width out in proportion to
     * those sizes — so a resize still means something — while the checkbox and
     * actions gutters, and the figures, keep their own width — a total cut to
     * "৳ 128,450…" is a wrong number.
     */
    const keepsWidth = (column: Column<T, unknown>) =>
        isPinnedColumnId(column.id) || column.columnDef.meta?.align === 'end';
    const visibleLeafColumns = table.getVisibleLeafColumns();
    const keptWidth = visibleLeafColumns
        .filter(keepsWidth)
        .reduce((sum, c) => sum + c.getSize(), 0);
    const flexibleSize = visibleLeafColumns
        .filter((c) => !keepsWidth(c))
        .reduce((sum, c) => sum + c.getSize(), 0);
    const fitActive = fitWidth && containerWidth > 0 && flexibleSize > 0;
    const columnWidthStyle = (column: Column<T, unknown>): React.CSSProperties => {
        if (!fitActive || keepsWidth(column)) {
            return { width: column.getSize(), minWidth: column.getSize() };
        }
        const share = (Math.max(0, containerWidth - keptWidth) * column.getSize()) / flexibleSize;
        return { width: Math.floor(share) };
    };
    const columnAlign = (column: Column<T, unknown>): ColumnAlign =>
        viewOptions && column.id === PINNED_LAST_COLUMN_ID ? 'center' : column.columnDef.meta?.align ?? 'start';
    /** The whole value as a tooltip, for a cell that may be cut off. */
    const cellTitle = (value: unknown, column: Column<T, unknown>): string | undefined => {
        if (!(singleLine || fitActive) || isPinnedColumnId(column.id)) return undefined;
        return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
    };

    const resolvedFilters = useMemo<ResolvedListFilter[]>(
        () =>
            (filters ?? []).map((filter) => {
                if (filter.type !== 'select') return filter;
                if (filter.columnId) {
                    const columnId = filter.columnId;
                    const current = activeColumnFilters.find((f) => f.id === columnId)?.value;
                    const others = activeColumnFilters.filter((f) => f.id !== columnId);
                    return {
                        ...filter,
                        value: typeof current === 'string' && current ? current : null,
                        onChange: (next: string | null) => {
                            applyColumnFilters(next ? [...others, { id: columnId, value: next }] : others);
                            setActivePreset(null);
                        },
                    };
                }
                return { ...filter, value: filter.value ?? null, onChange: filter.onChange ?? (() => {}) };
            }),
        [filters, activeColumnFilters, applyColumnFilters],
    );

    const selectedRows = useMemo(
        () => table.getSelectedRowModel().rows.map((r: Row<T>) => r.original),
        [rowSelection, data],
    );
    const clearSelection = useCallback(() => setRowSelection({}), []);

    const exportColumns = useMemo(
        () =>
            table
                .getAllLeafColumns()
                .filter((c) => isExportableColumnId(c.id))
                .map((c) => ({
                    id: c.id,
                    label: exportableColumnLabel(c),
                    visible: c.getIsVisible(),
                })),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [columnVisibility, effectiveColumnOrder, effectiveColumns, isMdUp],
    );

    const pageRowCount = table.getPaginationRowModel().rows.length;

    const handleExport = async (opts: {
        format: ExportFormat;
        rowScope: ExportRowScope;
        columnIds: string[];
    }) => {
        const specs = table
            .getAllLeafColumns()
            .filter((c) => opts.columnIds.includes(c.id))
            .map((c) => ({
                id: c.id,
                header: exportableColumnLabel(c),
                getValue: (record: T) => valueFromColumn(c, record),
            }));

        let records: T[];
        try {
            if (opts.rowScope === 'selected') {
                records = table.getSelectedRowModel().rows.map((r) => r.original);
            } else if (opts.rowScope === 'page') {
                records = table.getPaginationRowModel().rows.map((r) => r.original);
            } else if (isServer && serverPagination?.fetchAllRows) {
                setExportBusy(true);
                setExportProgress({ loaded: 0, total: serverPagination.total });
                const result = await serverPagination.fetchAllRows((loaded, total) => {
                    setExportProgress({ loaded, total });
                });
                records = result.items;
            } else {
                records = table.getFilteredRowModel().rows.map((r) => r.original);
            }

            const matrix = buildExportMatrix(records, specs);
            if (opts.format === 'csv') {
                exportToCSV(title, matrix.headers, matrix.rows);
            } else if (opts.format === 'excel') {
                await exportToExcel(title, matrix.headers, matrix.rows);
            } else {
                await exportToPDF(title, matrix.headers, matrix.rows);
            }
            setShowExportDialog(false);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : t.common.dataTable.exportFailed);
        } finally {
            setExportBusy(false);
            setExportProgress(null);
        }
    };

    return (
        <div className={`bg-white ${d.wrapper} shadow-sm border border-gray-100 overflow-hidden`}>
            {/* ── Toolbar ─────────────────────────────────────────── */}
            <div className={d.toolbar}>
                <div className="flex items-center justify-between gap-3 flex-wrap">
                    {/* Search */}
                    {showSearch && (
                        <div className="relative flex-1 min-w-[200px] max-w-md">
                            <Search className={`absolute top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4 ${isCompact ? 'start-2.5' : 'start-3'}`} />
                            <input
                                type="text"
                                placeholder={resolvedSearchPlaceholder}
                                className={d.searchInput}
                                value={shownSearch}
                                onChange={(e) => setSearchValue(e.target.value)}
                            />
                            {shownSearch && (
                                <button
                                    onClick={() => setSearchValue('')}
                                    className="absolute end-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                                >
                                    <X className="w-3.5 h-3.5" />
                                </button>
                            )}
                        </div>
                    )}

                    {resolvedFilters.length > 0 && (
                        <div className="flex flex-wrap items-center gap-2">
                            <FilterBar filters={resolvedFilters} compact={!isMdUp} />
                        </div>
                    )}

                    {/* Toolbar buttons — always aligned to the right, even when the search box is hidden */}
                    <div className="flex items-center gap-2 flex-wrap ms-auto">
                        {/* Advanced Filters */}
                        {filterableColumns.length > 0 && (
                            <button
                                onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
                                className={`${d.toolbarBtn} ${
                                    showAdvancedFilters || advancedFilterCount > 0
                                        ? 'bg-blue-50 text-blue-700 border-blue-200'
                                        : d.toolbarBtnIdle
                                }`}
                                title={advancedFiltersLabel}
                            >
                                <SlidersHorizontal className="w-3.5 h-3.5" />
                                <span className={isCompact ? 'sr-only' : undefined}>{advancedFiltersLabel}</span>
                                {advancedFilterCount > 0 && (
                                    <span className="bg-blue-600 text-white rounded-full w-4 h-4 flex items-center justify-center text-[9px]">
                                        {advancedFilterCount}
                                    </span>
                                )}
                            </button>
                        )}

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
                                <div className="absolute end-0 top-full mt-2 w-56 bg-white rounded-xl shadow-lg border border-gray-200 py-2 z-50 max-h-72 overflow-y-auto">
                                    {table.getAllLeafColumns()
                                        .filter((c) => c.id !== PINNED_FIRST_COLUMN_ID)
                                        .map((column) => (
                                            <label
                                                key={column.id}
                                                className="flex items-center px-3 py-1.5 hover:bg-gray-50 cursor-pointer"
                                            >
                                                <div className={`w-4 h-4 rounded border me-2.5 flex items-center justify-center transition-colors ${
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

                        {viewOptions && (
                            <TableViewOptions tableId={tableId} buttonClassName={toolbarBtnBase} iconOnly={isCompact} layout={viewLayout} />
                        )}

                        {/* Export */}
                        <button
                            onClick={() => setShowExportDialog(true)}
                            className={toolbarBtnBase}
                            title={t.common.dataTable.export}
                        >
                            <Download className="w-3.5 h-3.5" />
                            <span className={isCompact ? 'sr-only' : undefined}>{t.common.dataTable.export}</span>
                        </button>

                        {/* Print */}
                        <button
                            onClick={async () => {
                                // The branch the page is filtered to; company
                                // paper under "All branches" or with no filter.
                                const [header, chosenPaper] = await Promise.all([
                                    printHeader.resolve(printBranch()),
                                    resolvePrintPaper(),
                                ]);
                                // The paper Print settings chose on this browser; a
                                // table has no roll layout, so a roll prints on A4.
                                const printPaper = sheetPaper(chosenPaper);
                                const headerContext: HeaderContext = {
                                    docTitle: title,
                                    companyName: header.companyName,
                                };
                                printTable(table, title, {
                                    html: renderHeaderHtml(header.headerConfig, headerContext, printPaper),
                                    config: header.headerConfig,
                                    context: headerContext,
                                }, printPaper);
                            }}
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
                        {activeColumnFilters.length > 0 && (
                            <button
                                onClick={() => { applyColumnFilters([]); setActivePreset(null); }}
                                className="px-2.5 py-1 rounded-lg text-xs font-bold text-red-500 bg-red-50 border border-red-200 hover:bg-red-100 transition-all"
                            >
                                {t.common.dataTable.clearAll}
                            </button>
                        )}
                    </div>
                )}

                {/* Advanced Column Filters */}
                {showAdvancedFilters && filterableColumns.length > 0 && (
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
                        className="pointer-events-none absolute end-0 top-0 bottom-0 z-10 w-10 bg-gradient-to-l from-white via-white/80 to-transparent md:hidden"
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
                        <table
                            className={`w-full${viewOptions ? ' dt-view' : ''}${singleLine ? ' dt-single-line' : ''}`}
                            style={{
                                tableLayout: 'fixed',
                                ...(viewOptions
                                    ? ({ '--dt-font-size': `${TABLE_FONT_PX[view.fontSize]}px` } as React.CSSProperties)
                                    : {}),
                            }}
                        >
                            <thead>
                                {table.getHeaderGroups().map((headerGroup) => (
                                    <tr key={headerGroup.id}>
                                        <SortableContext
                                            items={columnIds}
                                            strategy={horizontalListSortingStrategy}
                                        >
                                            {headerGroup.headers.map((header) => {
                                                // Selection checkbox: pinned to the start edge, and the
                                                // one header with no label — a bare cell, so the "select
                                                // all" box lines up with the row checkboxes below it
                                                // rather than being offset by a drag grip.
                                                if (header.column.id === PINNED_FIRST_COLUMN_ID) {
                                                    return (
                                                        <th
                                                            key={header.id}
                                                            style={columnWidthStyle(header.column)}
                                                            className={headerCellClass}
                                                        >
                                                            {header.isPlaceholder
                                                                ? null
                                                                : flexRender(header.column.columnDef.header, header.getContext())}
                                                        </th>
                                                    );
                                                }

                                                // Row actions: pinned to the end edge, so the same cell
                                                // as a draggable one minus the grip. It keeps its resize
                                                // handle — most tables leave this column resizable.
                                                if (header.column.id === PINNED_LAST_COLUMN_ID) {
                                                    return (
                                                        <PinnedHeader
                                                            key={header.id}
                                                            header={header}
                                                            headerClassName={headerCellClass}
                                                            widthStyle={columnWidthStyle(header.column)}
                                                            align={columnAlign(header.column)}
                                                        />
                                                    );
                                                }

                                                return (
                                                    <SortableHeader
                                                        key={header.id}
                                                        header={header}
                                                        headerClassName={headerCellClass}
                                                        widthStyle={columnWidthStyle(header.column)}
                                                        align={columnAlign(header.column)}
                                                        floatingGrip={viewOptions}
                                                    />
                                                );
                                            })}
                                        </SortableContext>
                                    </tr>
                                ))}
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                                {table.getRowModel().rows.map((row) => (
                                    <tr
                                        key={row.id}
                                        className={`${rowToneClass} ${onRowClick ? 'cursor-pointer focus-visible:outline-none focus-visible:bg-blue-50/60' : ''} ${
                                            // A ticked row stays marked over its stripe, not just by its box.
                                            viewOptions && row.getIsSelected() ? TABLE_ROW_CLASSES.selected : ''
                                        } ${rowClassName?.(row.original) ?? ''}`}
                                        onClick={onRowClick ? (event) => {
                                            if (isFromControl(event.target)) return;
                                            onRowClick(row.original);
                                        } : undefined}
                                        onKeyDown={onRowClick ? (event) => {
                                            if (event.key !== 'Enter' || event.target !== event.currentTarget) return;
                                            event.preventDefault();
                                            onRowClick(row.original);
                                        } : undefined}
                                        tabIndex={onRowClick ? 0 : undefined}
                                    >
                                        {row.getVisibleCells().map((cell) => (
                                            <td
                                                key={cell.id}
                                                className={`${bodyCellClass} ${TEXT_ALIGN_CLASS[columnAlign(cell.column)]}`}
                                                style={{ width: columnWidthStyle(cell.column).width }}
                                                data-actions={cell.column.id === PINNED_LAST_COLUMN_ID || undefined}
                                                title={cellTitle(cell.getValue(), cell.column)}
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
                        {t.common.dataTable.scrollHint}
                        {/* Points the way the table actually scrolls, which is
                            the other way round in Arabic and Urdu. */}
                        <span className="rtl:hidden"> →</span>
                        <span className="hidden rtl:inline"> ←</span>
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
                                data-testid="page-size-select"
                                value={effectivePageSize}
                                onChange={(e) => handlePageSizeChange(Number(e.target.value))}
                                className="bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 text-xs font-bold text-gray-700 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-300"
                            >
                                {pageSizeOptions.map((size) => (
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
                            data-testid="pagination-next"
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

            <ExportDialog
                open={showExportDialog}
                title={title}
                pageCount={pageRowCount}
                totalCount={totalRows}
                selectedCount={enableRowSelection ? selectedRows.length : 0}
                columns={exportColumns}
                busy={exportBusy}
                progress={exportProgress}
                onClose={() => { if (!exportBusy) setShowExportDialog(false); }}
                onConfirm={handleExport}
            />
        </div>
    );
}
