'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { History, Loader2, Search, X } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import PageShell from '@/components/ui/compact/PageShell';
import PageHeader from '@/components/ui/compact/PageHeader';
import { api } from '@/lib/api';
import { useDismissOnClickOutside } from '@/lib/click-outside';
import { formatBDT, formatCalendarDate, formatDateTime } from '@/lib/format';
import { formatMessage, useI18n } from '@/lib/i18n';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { warehouseLabel } from '@/lib/warehouse-label';

interface ProductOption {
    id: string;
    name: string;
    sku?: string | null;
}

interface HistoryRow {
    id: string;
    /**
     * `opening` is the synthetic first row: the quantity the card stands at
     * before any movement below it. It is a table row rather than a caption so
     * that the CSV, Excel and PDF exports carry it too — a stock card whose
     * printed copy starts mid-balance reconciles with nothing.
     */
    rowType: 'opening' | 'movement';
    occurredAt: string;
    movementType: string;
    direction: 'IN' | 'OUT';
    quantityIn: number;
    quantityOut: number;
    balanceAfter: number;
    warehouse?: { id: string; name: string; code?: string | null } | null;
    referenceType?: string | null;
    referenceNumber?: string | null;
    referenceParty?: string | null;
    unitCost?: number | null;
    value?: number | null;
    note?: string | null;
}

interface HistoryResponse {
    product: { id: string; name: string; sku?: string | null; unit_type?: string | null; deleted_at?: string | null };
    warehouse: { id: string; name: string } | null;
    summary: {
        openingQuantity: number;
        totalIn: number;
        totalOut: number;
        netChange: number;
        closingQuantity: number;
        currentStockQuantity: number;
        movementCount: number;
        matchesStockOnHand: boolean | null;
    };
    pageOpeningQuantity: number;
    rows: Omit<HistoryRow, 'rowType'>[];
    pagination: { page: number; limit: number; total: number; pages: number };
}

const columnHelper = createColumnHelper<HistoryRow>();

const PAGE_SIZE = 100;

/**
 * `PURCHASE_RECEIPT` → `Purchase Receipt`.
 *
 * Derived rather than translated: movement types are added server-side as new
 * workflows land, and a lookup table would render the raw constant for every one
 * it had not caught up with. Full translation of the vocabulary is worth doing
 * once, for the stock ledger and this card together.
 */
function humanizeMovementType(value: string): string {
    return value
        .split('_')
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
}

function ProductTransactionHistoryContent() {
    const { t, locale } = useI18n();
    const copy = t.inventoryReports.productTransactionHistory;
    const searchParams = useSearchParams();

    const [productId, setProductId] = useState(searchParams.get('productId') ?? '');
    const [selectedProduct, setSelectedProduct] = useState<ProductOption | null>(null);
    const [warehouseId, setWarehouseId] = useState(searchParams.get('warehouseId') ?? '');
    const [storeId, setStoreId] = useState('');
    const [fromDate, setFromDate] = useState('');
    const [toDate, setToDate] = useState('');
    const [page, setPage] = useState(1);

    const [report, setReport] = useState<HistoryResponse | null>(null);
    const [loading, setLoading] = useState(false);
    // A failed read leaves the table empty, which reads exactly like "this
    // product never moved" — the one answer a stock card must not give by
    // accident.
    const [error, setError] = useState<string | null>(null);

    const [stores, setStores] = useState<any[]>([]);
    const [warehouses, setWarehouses] = useState<any[]>([]);

    useEffect(() => {
        const loadFilters = async () => {
            try {
                const [storeData, warehouseData] = await Promise.all([api.getStores(), api.getInventoryWarehouses()]);
                setStores(storeData);
                setWarehouses(warehouseData);
            } catch (err) {
                console.error('Failed to load transaction history filters', err);
            }
        };
        void loadFilters();
    }, []);

    // Any filter change restarts the card at its first page: the running balance
    // is positional, so page 4 of the old filter is a balance from a different
    // report.
    useEffect(() => {
        setPage(1);
    }, [productId, warehouseId, storeId, fromDate, toDate]);

    useEffect(() => {
        if (!productId) {
            setReport(null);
            setError(null);
            return;
        }

        let cancelled = false;
        const loadReport = async () => {
            setLoading(true);
            try {
                const data = await api.getProductTransactionHistory({
                    productId,
                    warehouseId: warehouseId || undefined,
                    storeId: storeId || undefined,
                    from: fromDate || undefined,
                    to: toDate || undefined,
                    page,
                    limit: PAGE_SIZE,
                });
                if (cancelled) return;
                setReport(data);
                setError(null);
                // A product reached by URL has no name until the report names it.
                setSelectedProduct({ id: data.product.id, name: data.product.name, sku: data.product.sku });
            } catch (err) {
                if (cancelled) return;
                console.error('Failed to load product transaction history', err);
                setReport(null);
                setError(err instanceof Error ? err.message : String(err));
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        void loadReport();
        return () => {
            cancelled = true;
        };
    }, [productId, warehouseId, storeId, fromDate, toDate, page]);

    // A warehouse belongs to exactly one branch, so picking a branch narrows the
    // warehouse list. The branch select clears `warehouseId` on the way past:
    // the two are AND-ed server-side, so a warehouse left over from another
    // branch would report nothing at all.
    const visibleWarehouses = useMemo(
        () => warehouses.filter((warehouse: any) => !storeId || warehouse.store_id === storeId),
        [warehouses, storeId],
    );

    const tableData = useMemo<HistoryRow[]>(() => {
        if (!report) return [];
        const opening: HistoryRow = {
            id: '__opening__',
            rowType: 'opening',
            occurredAt: fromDate,
            movementType: '',
            direction: 'IN',
            quantityIn: 0,
            quantityOut: 0,
            // Page 1 opens on the window's own opening quantity; every later page
            // opens where the previous one closed.
            balanceAfter: page > 1 ? report.pageOpeningQuantity : report.summary.openingQuantity,
        };
        return [opening, ...report.rows.map((row) => ({ ...row, rowType: 'movement' as const }))];
    }, [report, fromDate, page]);

    const columns = useMemo<ColumnDef<HistoryRow, any>[]>(() => {
        const muted = <span className="text-gray-300">—</span>;

        return [
            columnHelper.accessor('occurredAt', {
                header: copy.columns.date,
                enableSorting: false,
                size: 160,
                cell: (info) => {
                    const row = info.row.original;
                    if (row.rowType === 'opening') {
                        return (
                            <span className="text-sm font-semibold text-gray-800">
                                {fromDate
                                    ? formatMessage(copy.openingRowDated, { date: formatCalendarDate(fromDate, locale) })
                                    : page > 1
                                      ? copy.broughtForward
                                      : copy.openingRow}
                            </span>
                        );
                    }
                    return <span className="text-sm text-gray-700">{formatDateTime(row.occurredAt, locale)}</span>;
                },
            }),
            columnHelper.accessor('movementType', {
                header: copy.columns.movement,
                enableSorting: false,
                size: 150,
                cell: (info) =>
                    info.row.original.rowType === 'opening' ? (
                        <span className="text-xs font-semibold text-blue-600">
                            {page > 1 ? copy.broughtForward : copy.openingRow}
                        </span>
                    ) : (
                        <span className="text-sm text-gray-700">{humanizeMovementType(info.getValue())}</span>
                    ),
            }),
            columnHelper.accessor(
                (row) => (row.referenceNumber ? row.referenceNumber : row.referenceType ? humanizeMovementType(row.referenceType) : ''),
                {
                    id: 'reference',
                    header: copy.columns.reference,
                    enableSorting: false,
                    size: 160,
                    cell: (info) => {
                        const row = info.row.original;
                        if (row.rowType === 'opening') return muted;
                        if (!row.referenceNumber) {
                            return (
                                <span className="text-xs text-gray-500">
                                    {row.referenceType ? humanizeMovementType(row.referenceType) : '—'}
                                </span>
                            );
                        }
                        return (
                            <span className="flex flex-col">
                                <span className="text-sm font-medium text-gray-800">{row.referenceNumber}</span>
                                {row.referenceType && (
                                    <span className="text-xs text-gray-400">{humanizeMovementType(row.referenceType)}</span>
                                )}
                            </span>
                        );
                    },
                },
            ),
            columnHelper.accessor((row) => row.referenceParty ?? '', {
                id: 'party',
                header: copy.columns.party,
                enableSorting: false,
                size: 160,
                meta: { hideOnMobile: true },
                cell: (info) =>
                    info.row.original.rowType === 'opening' || !info.getValue() ? (
                        muted
                    ) : (
                        <span className="text-sm text-gray-600">{info.getValue()}</span>
                    ),
            }),
            columnHelper.accessor((row) => row.warehouse?.name ?? '', {
                id: 'warehouse',
                header: copy.columns.warehouse,
                enableSorting: false,
                size: 140,
                meta: { hideOnMobile: true },
                cell: (info) =>
                    info.row.original.rowType === 'opening' || !info.getValue() ? (
                        muted
                    ) : (
                        <span className="text-sm text-gray-600">{info.getValue()}</span>
                    ),
            }),
            columnHelper.accessor('quantityIn', {
                header: copy.columns.quantityIn,
                enableSorting: false,
                size: 90,
                cell: (info) => {
                    if (info.row.original.rowType === 'opening') return muted;
                    const value = Number(info.getValue() || 0);
                    return value > 0 ? <span className="text-sm font-semibold text-emerald-600">{value}</span> : muted;
                },
            }),
            columnHelper.accessor('quantityOut', {
                header: copy.columns.quantityOut,
                enableSorting: false,
                size: 90,
                cell: (info) => {
                    if (info.row.original.rowType === 'opening') return muted;
                    const value = Number(info.getValue() || 0);
                    return value > 0 ? <span className="text-sm font-semibold text-red-600">{value}</span> : muted;
                },
            }),
            columnHelper.accessor('balanceAfter', {
                header: copy.columns.balance,
                enableSorting: false,
                size: 110,
                cell: (info) => {
                    const value = Number(info.getValue() || 0);
                    return (
                        <span
                            className={`text-sm font-bold ${
                                info.row.original.rowType === 'opening'
                                    ? 'text-gray-800'
                                    : value < 0
                                      ? 'text-red-600'
                                      : 'text-gray-900'
                            }`}
                        >
                            {value}
                        </span>
                    );
                },
            }),
            columnHelper.accessor((row) => row.unitCost ?? '', {
                id: 'unitCost',
                header: copy.columns.unitCost,
                enableSorting: false,
                size: 120,
                meta: { hideOnMobile: true },
                cell: (info) => {
                    const row = info.row.original;
                    if (row.rowType === 'opening' || row.unitCost == null) return muted;
                    return <span className="text-sm text-gray-600">{formatBDT(row.unitCost)}</span>;
                },
            }),
            columnHelper.accessor((row) => row.value ?? '', {
                id: 'value',
                header: copy.columns.value,
                enableSorting: false,
                size: 120,
                meta: { hideOnMobile: true },
                cell: (info) => {
                    const row = info.row.original;
                    if (row.rowType === 'opening' || row.value == null) return muted;
                    return (
                        <span className={`text-sm ${row.value < 0 ? 'text-red-600' : 'text-gray-700'}`}>
                            {formatBDT(row.value)}
                        </span>
                    );
                },
            }),
            columnHelper.accessor((row) => row.note ?? '', {
                id: 'note',
                header: copy.columns.note,
                enableSorting: false,
                size: 180,
                meta: { hideOnMobile: true },
                cell: (info) =>
                    info.row.original.rowType === 'opening' || !info.getValue() ? (
                        muted
                    ) : (
                        <span className="text-sm text-gray-500 line-clamp-2">{info.getValue()}</span>
                    ),
            }),
        ];
    }, [copy, locale, fromDate, page]);

    const summary = report?.summary ?? null;
    const showMismatch = summary?.matchesStockOnHand === false;

    return (
        <PageShell>
            <PageHeader
                title={copy.title}
                subtitle={copy.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.inventory,
                    copy.title,
                    'inventory',
                )}
            />

            <div className="bg-white border border-gray-100 rounded-lg p-3 md:p-4 space-y-3">
                <ProductPicker
                    copy={copy}
                    selected={selectedProduct}
                    onSelect={(product) => {
                        setSelectedProduct(product);
                        setProductId(product?.id ?? '');
                    }}
                />

                <div className="flex flex-wrap gap-3 items-end">
                    <label className="space-y-1 min-w-[180px] flex-1">
                        <span className="block text-xs font-medium text-gray-500">{copy.branchLabel}</span>
                        <select
                            value={storeId}
                            onChange={(e) => {
                                setStoreId(e.target.value);
                                setWarehouseId('');
                            }}
                            className="w-full rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-sm min-h-touch"
                        >
                            <option value="">{copy.allBranches}</option>
                            {stores.map((store: any) => (
                                <option key={store.id} value={store.id}>
                                    {store.name}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="space-y-1 min-w-[180px] flex-1">
                        <span className="block text-xs font-medium text-gray-500">{copy.warehouseLabel}</span>
                        <select
                            value={warehouseId}
                            onChange={(e) => setWarehouseId(e.target.value)}
                            className="w-full rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-sm min-h-touch"
                        >
                            <option value="">{copy.allWarehouses}</option>
                            {visibleWarehouses.map((warehouse: any) => (
                                <option key={warehouse.id} value={warehouse.id}>
                                    {warehouseLabel(warehouse, visibleWarehouses)}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="space-y-1 min-w-[150px]">
                        <span className="block text-xs font-medium text-gray-500">{copy.fromLabel}</span>
                        <input
                            type="date"
                            value={fromDate}
                            onChange={(e) => setFromDate(e.target.value)}
                            className="w-full rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-sm min-h-touch"
                        />
                    </label>
                    <label className="space-y-1 min-w-[150px]">
                        <span className="block text-xs font-medium text-gray-500">{copy.toLabel}</span>
                        <input
                            type="date"
                            value={toDate}
                            onChange={(e) => setToDate(e.target.value)}
                            className="w-full rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-sm min-h-touch"
                        />
                    </label>
                    <button
                        type="button"
                        onClick={() => {
                            setStoreId('');
                            setWarehouseId('');
                            setFromDate('');
                            setToDate('');
                        }}
                        className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 min-h-touch"
                    >
                        {copy.clearFilters}
                    </button>
                </div>
            </div>

            {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm">
                    {formatMessage(copy.loadError, { message: error })}
                </div>
            )}

            {report?.product.deleted_at && (
                <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-3 text-xs">
                    {copy.deletedProduct}
                </div>
            )}

            {/* The ledger and the warehouse row are two different records of the
                same stock, and they can legitimately disagree. Saying so beats
                printing a balance the shelf does not agree with. */}
            {showMismatch && summary && (
                <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-3 text-xs">
                    {formatMessage(copy.stockMismatch, {
                        closing: summary.closingQuantity,
                        onHand: summary.currentStockQuantity,
                    })}
                </div>
            )}

            {summary && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-white border border-gray-100 rounded-lg p-3 md:p-4">
                        <div className="text-xs font-medium text-gray-500">{copy.openingQuantity}</div>
                        <div className="text-2xl font-bold text-gray-900 mt-1">{summary.openingQuantity}</div>
                    </div>
                    <div className="bg-white border border-gray-100 rounded-lg p-3 md:p-4">
                        <div className="text-xs font-medium text-gray-500">{copy.totalIn}</div>
                        <div className="text-2xl font-bold text-emerald-600 mt-1">{summary.totalIn}</div>
                    </div>
                    <div className="bg-white border border-gray-100 rounded-lg p-3 md:p-4">
                        <div className="text-xs font-medium text-gray-500">{copy.totalOut}</div>
                        <div className="text-2xl font-bold text-red-600 mt-1">{summary.totalOut}</div>
                    </div>
                    <div className="bg-white border border-gray-100 rounded-lg p-3 md:p-4">
                        <div className="text-xs font-medium text-gray-500">{copy.closingQuantity}</div>
                        <div className="text-2xl font-bold text-blue-700 mt-1">{summary.closingQuantity}</div>
                    </div>
                </div>
            )}

            {!productId ? (
                <div className="flex flex-col items-center justify-center gap-3 py-20 text-gray-400">
                    <History className="w-16 h-16 text-gray-200" />
                    <p className="text-sm">{copy.noProductSelected}</p>
                </div>
            ) : (
                <>
                    <DataTable<HistoryRow>
                        tableId="inventory-product-transaction-history"
                        columns={columns}
                        data={tableData}
                        title={copy.title}
                        isLoading={loading}
                        emptyMessage={error ? copy.loadErrorEmpty : copy.emptyMessage}
                        emptyIcon={<History className="w-16 h-16 text-gray-200" />}
                        showSearch={false}
                        serverPagination={{
                            total: report?.pagination.total ?? 0,
                            page,
                            pageSize: PAGE_SIZE,
                            onPageChange: setPage,
                            // Fixed: the running balance is positional, so a page
                            // size the table could change mid-read would silently
                            // renumber every balance below the fold.
                            onPageSizeChange: () => {},
                            sort: null,
                            onSortChange: () => {},
                        }}
                    />

                    {!warehouseId && <p className="text-xs text-gray-500">{copy.allWarehousesNote}</p>}
                </>
            )}
        </PageShell>
    );
}

/**
 * A typed-search product field rather than a `<select>`: a mid-sized shop has
 * thousands of SKUs, and a dropdown of all of them is unusable on a phone and
 * slow everywhere else.
 */
function ProductPicker({
    copy,
    selected,
    onSelect,
}: {
    copy: any;
    selected: ProductOption | null;
    onSelect: (product: ProductOption | null) => void;
}) {
    const [query, setQuery] = useState('');
    const [options, setOptions] = useState<ProductOption[]>([]);
    const [open, setOpen] = useState(false);
    const [searching, setSearching] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    const isInside = useCallback((target: Node) => Boolean(containerRef.current?.contains(target)), []);
    useDismissOnClickOutside(open, isInside, () => setOpen(false));

    useEffect(() => {
        if (!open) return;

        let cancelled = false;
        const timer = setTimeout(async () => {
            const term = query.trim();
            try {
                setSearching(true);
                // An empty term browses the most-sold products, so the list can be
                // opened and read without typing anything.
                const data = await api.searchProductsByQuantity(term, term ? 20 : 30);
                if (!cancelled) setOptions(Array.isArray(data) ? data : []);
            } catch (err) {
                console.error('Failed to search products', err);
                if (!cancelled) setOptions([]);
            } finally {
                if (!cancelled) setSearching(false);
            }
        }, 250);

        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [query, open]);

    return (
        <div ref={containerRef} className="relative">
            <span className="block text-xs font-medium text-gray-500 mb-1">{copy.productLabel}</span>
            {selected ? (
                <div className="flex items-center gap-2 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 min-h-touch">
                    <span className="text-sm font-semibold text-gray-800">{selected.name}</span>
                    {selected.sku && <span className="text-xs text-gray-400">{selected.sku}</span>}
                    <button
                        type="button"
                        aria-label={copy.changeProduct}
                        onClick={() => {
                            onSelect(null);
                            setQuery('');
                            setOpen(true);
                        }}
                        className="ms-auto inline-flex items-center gap-1 text-xs font-semibold text-blue-600"
                    >
                        <X className="w-4 h-4" /> {copy.changeProduct}
                    </button>
                </div>
            ) : (
                <div className="relative">
                    <Search className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onFocus={() => setOpen(true)}
                        placeholder={copy.searchPlaceholder}
                        aria-label={copy.selectProduct}
                        className="w-full rounded-xl border border-gray-100 bg-gray-50 ps-9 pe-3 py-2 text-sm min-h-touch"
                    />
                </div>
            )}

            {open && !selected && (
                <div className="absolute z-20 mt-1 w-full max-h-72 overflow-auto rounded-xl border border-gray-200 bg-white shadow-lg">
                    {searching && (
                        <div className="flex items-center gap-2 px-3 py-2 text-xs text-gray-500">
                            <Loader2 className="w-4 h-4 animate-spin" /> {copy.searching}
                        </div>
                    )}
                    {!searching && options.length === 0 && (
                        <div className="px-3 py-3 text-xs text-gray-500">{copy.noMatches}</div>
                    )}
                    {options.map((product) => (
                        <button
                            key={product.id}
                            type="button"
                            onClick={() => {
                                onSelect({ id: product.id, name: product.name, sku: product.sku });
                                setOpen(false);
                            }}
                            className="flex w-full items-center justify-between gap-3 px-3 py-2 text-start hover:bg-gray-50 min-h-touch"
                        >
                            <span className="text-sm text-gray-800">{product.name}</span>
                            {product.sku && <span className="text-xs text-gray-400">{product.sku}</span>}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

export default function ProductTransactionHistoryPage() {
    return (
        <Suspense fallback={<div className="p-8 text-sm text-gray-500" />}>
            <ProductTransactionHistoryContent />
        </Suspense>
    );
}
