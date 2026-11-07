'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { ArrowDownLeft, ArrowUpRight, Flag, FlagTriangleRight, History } from 'lucide-react';
import { DataTable, type ListFilter, type ListStat } from '@/components/data-table';
import PageShell from '@/components/ui/compact/PageShell';
import PageHeader from '@/components/ui/compact/PageHeader';
import { searchProductOptions } from '@/components/reports/filter-searches';
import type { FilterOption } from '@/components/reports/SearchFilterPicker';
import { api } from '@/lib/api';
import { formatBDT, formatCalendarDate, formatDateTime } from '@/lib/format';
import { formatMessage, useI18n } from '@/lib/i18n';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { warehouseLabel } from '@/lib/warehouse-label';
import { applyCreatedRangeQuery, type CreatedRange } from '@/lib/created-range';
import { BranchFilter } from '@/components/ui';
import { branchOrEmpty, handleBranchForbidden, useBranchBoundState, useBranchScope } from '@/lib/branch-scope';

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

function productOptionLabel(product: FilterOption): string {
    return product.detail ? `${product.name} (${product.detail})` : product.name;
}

function ProductTransactionHistoryContent() {
    const { t, locale } = useI18n();
    const copy = t.inventoryReports.productTransactionHistory;
    const listUi = t.inventoryReports.listUi;
    const searchParams = useSearchParams();
    const branch = useBranchScope();

    const [productId, setProductId] = useState(searchParams.get('productId') ?? '');
    const [selectedProduct, setSelectedProduct] = useState<FilterOption | null>(null);
    const [warehouseId, setWarehouseId] = useBranchBoundState(branch.apiStoreId, searchParams.get('warehouseId') ?? '');
    const storeId = branchOrEmpty(branch.apiStoreId);
    const [dateRange, setDateRange] = useState<CreatedRange>({});
    const [page, setPage] = useState(1);

    const [report, setReport] = useState<HistoryResponse | null>(null);
    const [loading, setLoading] = useState(false);
    // A failed read leaves the table empty, which reads exactly like "this
    // product never moved" — the one answer a stock card must not give by
    // accident.
    const [error, setError] = useState<string | null>(null);

    const [warehouses, setWarehouses] = useState<any[]>([]);

    useEffect(() => {
        const loadFilters = async () => {
            try {
                setWarehouses(await api.getInventoryWarehouses());
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
    }, [productId, warehouseId, branch.apiStoreId, dateRange]);

    useEffect(() => {
        if (!branch.ready) return;
        if (!productId) {
            setReport(null);
            setError(null);
            return;
        }

        let cancelled = false;
        const loadReport = async () => {
            setLoading(true);
            try {
                // History API expects `from`/`to`; applyCreatedRangeQuery yields createdFrom/createdTo.
                const range = applyCreatedRangeQuery(dateRange);
                const data = await api.getProductTransactionHistory({
                    productId,
                    warehouseId: warehouseId || undefined,
                    storeId: branch.apiStoreId,
                    from: range.createdFrom,
                    to: range.createdTo,
                    page,
                    limit: PAGE_SIZE,
                });
                if (cancelled) return;
                setReport(data);
                setError(null);
                // A product reached by URL has no name until the report names it.
                setSelectedProduct({ id: data.product.id, name: data.product.name, detail: data.product.sku });
            } catch (err) {
                if (cancelled) return;
                if (handleBranchForbidden(err, branch, t.dashboardLayout.branchFilterForbidden)) return;
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
        // `branch` itself is a fresh object each render; what the read depends
        // on is the branch it asks for.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [branch.ready, branch.apiStoreId, productId, warehouseId, dateRange, page]);

    // A warehouse belongs to exactly one branch, so picking a branch narrows the
    // warehouse list ("All branches" offers every one). The branch filter clears
    // `warehouseId` on the way past (`useBranchBoundState`).
    const visibleWarehouses = useMemo(
        () => warehouses.filter((warehouse: any) => !storeId || warehouse.store_id === storeId),
        [warehouses, storeId],
    );

    const fromDate = dateRange.from ?? '';

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
                meta: { align: 'end' },
                cell: (info) => {
                    if (info.row.original.rowType === 'opening') return muted;
                    const value = Number(info.getValue() || 0);
                    return value > 0 ? <span className="tabular-nums text-sm font-semibold text-emerald-600">{value}</span> : muted;
                },
            }),
            columnHelper.accessor('quantityOut', {
                header: copy.columns.quantityOut,
                enableSorting: false,
                size: 90,
                meta: { align: 'end' },
                cell: (info) => {
                    if (info.row.original.rowType === 'opening') return muted;
                    const value = Number(info.getValue() || 0);
                    return value > 0 ? <span className="tabular-nums text-sm font-semibold text-red-600">{value}</span> : muted;
                },
            }),
            columnHelper.accessor('balanceAfter', {
                header: copy.columns.balance,
                enableSorting: false,
                size: 110,
                meta: { align: 'end' },
                cell: (info) => {
                    const value = Number(info.getValue() || 0);
                    return (
                        <span
                            className={`tabular-nums text-sm font-bold ${
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
                meta: { align: 'end', hideOnMobile: true },
                cell: (info) => {
                    const row = info.row.original;
                    if (row.rowType === 'opening' || row.unitCost == null) return muted;
                    return <span className="tabular-nums text-sm text-gray-600">{formatBDT(row.unitCost, { locale })}</span>;
                },
            }),
            columnHelper.accessor((row) => row.value ?? '', {
                id: 'value',
                header: copy.columns.value,
                enableSorting: false,
                size: 120,
                meta: { align: 'end', hideOnMobile: true },
                cell: (info) => {
                    const row = info.row.original;
                    if (row.rowType === 'opening' || row.value == null) return muted;
                    return (
                        <span className={`tabular-nums text-sm ${row.value < 0 ? 'text-red-600' : 'text-gray-700'}`}>
                            {formatBDT(row.value, { locale })}
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

    const filters = useMemo<ListFilter[]>(
        () => [
            {
                id: 'product',
                type: 'select',
                label: copy.productLabel,
                value: productId || null,
                // The card cannot run without a product: Clear all leaves the
                // current pick rather than emptying the report.
                required: true,
                searchable: true,
                options: selectedProduct
                    ? [{ value: selectedProduct.id, label: productOptionLabel(selectedProduct) }]
                    : [],
                loadOptions: (term) =>
                    searchProductOptions(term).then((found) =>
                        found.map((product) => ({
                            value: product.id,
                            label: productOptionLabel(product),
                        })),
                    ),
                onChange: (next) => {
                    setProductId(next ?? '');
                    // loadOptions remembers the label for the chip; the report
                    // fills `selectedProduct` once it returns.
                    if (!next) setSelectedProduct(null);
                    else if (selectedProduct?.id !== next) setSelectedProduct(null);
                },
            },
            {
                id: 'warehouse',
                type: 'select',
                label: copy.warehouseLabel,
                value: warehouseId || null,
                onChange: (v) => setWarehouseId(v ?? ''),
                options: visibleWarehouses.map((warehouse: any) => ({
                    value: warehouse.id,
                    label: warehouseLabel(warehouse, visibleWarehouses),
                })),
            },
            {
                id: 'period',
                type: 'date-range',
                label: t.common.date,
                value: dateRange,
                onChange: (next) => setDateRange(next ?? {}),
            },
        ],
        [copy, t.common.date, productId, selectedProduct, warehouseId, visibleWarehouses, dateRange],
    );

    const stats = useMemo(() => {
        if (!summary) return { items: [] as ListStat[], loading, label: listUi.statsLabel };
        const items: ListStat[] = [
            {
                id: 'opening',
                icon: <Flag aria-hidden />,
                label: copy.openingQuantity,
                value: Number(summary.openingQuantity).toLocaleString(locale),
            },
            {
                id: 'totalIn',
                icon: <ArrowDownLeft aria-hidden />,
                label: copy.totalIn,
                value: Number(summary.totalIn).toLocaleString(locale),
            },
            {
                id: 'totalOut',
                icon: <ArrowUpRight aria-hidden />,
                label: copy.totalOut,
                value: Number(summary.totalOut).toLocaleString(locale),
            },
            {
                id: 'closing',
                icon: <FlagTriangleRight aria-hidden />,
                label: copy.closingQuantity,
                value: Number(summary.closingQuantity).toLocaleString(locale),
            },
        ];
        return { items, loading, label: listUi.statsLabel };
    }, [summary, loading, locale, copy, listUi]);

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
                actions={<BranchFilter scope={branch} />}
            />

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

            <DataTable<HistoryRow>
                tableId="inventory-product-transaction-history"
                columns={columns}
                data={productId ? tableData : []}
                title={copy.title}
                isLoading={loading}
                emptyMessage={!productId ? copy.noProductSelected : error ? copy.loadErrorEmpty : copy.emptyMessage}
                emptyIcon={<History className="w-16 h-16 text-gray-200" />}
                showSearch={false}
                // No per-column filters: a row's balance is the sum of every
                // movement before it, so a card cut down to the matching rows
                // would print balances that reconcile with nothing — and the
                // party and reference are looked up after the query, so the
                // server could not filter on them anyway. Product, warehouse
                // and dates above are the filters this report takes.
                enableColumnFilters={false}
                filters={filters}
                filterLayout="row"
                stats={productId ? stats : undefined}
                viewOptions
                serverPagination={
                    productId
                        ? {
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
                          }
                        : undefined
                }
            />

            {productId && !warehouseId && <p className="text-xs text-gray-500">{copy.allWarehousesNote}</p>}
        </PageShell>
    );
}

export default function ProductTransactionHistoryPage() {
    return (
        <Suspense fallback={<div className="p-8 text-sm text-gray-500" />}>
            <ProductTransactionHistoryContent />
        </Suspense>
    );
}
