'use client';

import { Suspense, useEffect, useId, useMemo } from 'react';
import Link from 'next/link';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { ScrollText } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { Alert, Button, CompactStat, Field, Input, PageShell, Select } from '@/components/ui';
import PageHeader from '@/components/ui/compact/PageHeader';
import SearchFilterPicker from '@/components/reports/SearchFilterPicker';
import { searchProductOptions, searchSupplierOptions } from '@/components/reports/filter-searches';
import { useLineItemFilters } from '@/components/reports/useLineItemFilters';
import { useServerList } from '@/hooks/useServerList';
import { api, type Paginated, type PurchaseLineItemRow, type PurchaseLineItemsReport } from '@/lib/api';
import { formatBDT, formatDate, formatNumber } from '@/lib/format';
import { formatMessage, useI18n } from '@/lib/i18n';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { routes } from '@/lib/routes';

type PurchaseLinePage = Paginated<PurchaseLineItemRow> & PurchaseLineItemsReport;

const columnHelper = createColumnHelper<PurchaseLineItemRow>();

/**
 * Purchase > Reports > Purchase Line Items: every line of every purchase that
 * still stands, narrowed by period, supplier, product, branch and free text —
 * "what did we pay Rahman Traders for rice this quarter, bill by bill".
 */
function PurchaseLineItemsContent() {
    const { t, locale } = useI18n();
    const copy = t.purchaseReports.lineItems;
    const fieldId = useId();
    const filters = useLineItemFilters('supplierId');
    const { nameFromResponse } = filters;

    const { items, response, loading, error, serverPagination } = useServerList<PurchaseLineItemRow, PurchaseLinePage>({
        tableId: 'purchase-line-items',
        initialSort: { id: 'date', desc: true },
        deps: filters.deps,
        fetch: async (params) => {
            const report = await api.getPurchaseLineItems({
                ...filters.query,
                page: params.page,
                limit: params.limit,
                sortBy: params.sortBy,
                sortDir: params.sortDir,
            });
            return { ...report, items: report.rows, ...report.pagination };
        },
    });

    useEffect(() => {
        if (response) nameFromResponse({ party: response.filters.supplier, product: response.filters.product });
    }, [response, nameFromResponse]);

    const summary = response?.summary;

    const columns = useMemo<ColumnDef<PurchaseLineItemRow, any>[]>(() => {
        const muted = <span className="text-gray-300">—</span>;

        return [
            // Accessors return what an export should print; the cells dress it.
            columnHelper.accessor((row) => formatDate(row.date, locale), {
                id: 'date',
                header: copy.columns.date,
                size: 96,
                cell: (info) => <span className="whitespace-nowrap text-sm text-gray-700">{info.getValue()}</span>,
            }),
            columnHelper.accessor('purchaseNumber', {
                id: 'bill',
                header: copy.columns.purchase,
                size: 124,
                cell: (info) => {
                    const row = info.row.original;
                    return (
                        <span className="flex flex-col">
                            <Link
                                href={routes.purchases.purchaseInvoice(row.purchaseId)}
                                className="text-sm font-semibold text-blue-600 hover:underline"
                            >
                                {row.purchaseNumber}
                            </Link>
                            {/* The supplier's own bill number — what their statement quotes. */}
                            {row.referenceNumber && (
                                <span className="text-xs text-gray-400">{row.referenceNumber}</span>
                            )}
                        </span>
                    );
                },
            }),
            columnHelper.accessor((row) => row.supplier?.name ?? copy.noSupplier, {
                id: 'supplier',
                header: copy.columns.supplier,
                size: 150,
                meta: { hideOnMobile: true },
                cell: (info) => (
                    <span className={`text-sm ${info.row.original.supplier ? 'text-gray-800' : 'text-gray-400'}`}>
                        {info.getValue()}
                    </span>
                ),
            }),
            columnHelper.accessor((row) => row.store?.name ?? '', {
                id: 'branch',
                header: copy.columns.branch,
                size: 110,
                enableSorting: false,
                meta: { hideOnMobile: true },
                cell: (info) => (info.getValue() ? <span className="text-sm text-gray-600">{info.getValue()}</span> : muted),
            }),
            // The SKU rides under the name rather than in a column of its own, so
            // the line's value stays on screen at laptop width; the export still
            // carries both.
            columnHelper.accessor((row) => (row.product.sku ? `${row.product.name} (${row.product.sku})` : row.product.name), {
                id: 'product',
                header: copy.columns.product,
                size: 210,
                cell: (info) => {
                    const { product } = info.row.original;
                    return (
                        <span className="flex flex-col">
                            <span className="text-sm font-medium text-gray-900">{product.name}</span>
                            {product.sku && <span className="text-xs text-gray-400">{product.sku}</span>}
                        </span>
                    );
                },
            }),
            columnHelper.accessor('quantity', {
                id: 'quantity',
                header: copy.columns.quantity,
                size: 64,
                cell: (info) => (
                    <span className="text-sm font-semibold tabular-nums text-gray-900">
                        {formatNumber(info.getValue(), locale)}
                    </span>
                ),
            }),
            columnHelper.accessor('unitCost', {
                id: 'unitCost',
                header: copy.columns.unitCost,
                size: 104,
                meta: { hideOnMobile: true },
                cell: (info) => (
                    <span className="text-sm tabular-nums text-gray-700">{formatBDT(info.getValue(), { locale })}</span>
                ),
            }),
            columnHelper.accessor('amount', {
                id: 'amount',
                header: copy.columns.amount,
                size: 116,
                cell: (info) => (
                    <span className="text-sm font-semibold tabular-nums text-gray-900">
                        {formatBDT(info.getValue(), { locale })}
                    </span>
                ),
            }),
            columnHelper.accessor('returnedQuantity', {
                id: 'returned',
                header: copy.columns.returned,
                size: 96,
                enableSorting: false,
                meta: { hideOnMobile: true },
                cell: (info) => {
                    const row = info.row.original;
                    if (!row.returnedQuantity) return muted;
                    return (
                        <span className="flex flex-col">
                            <span className="text-sm font-semibold tabular-nums text-amber-700">
                                {formatNumber(row.returnedQuantity, locale)}
                            </span>
                            <span className="text-xs tabular-nums text-gray-500">
                                {formatBDT(row.returnedAmount, { locale })}
                            </span>
                        </span>
                    );
                },
            }),
        ];
    }, [copy, locale]);

    const returnedNote = (value: string) => (
        <span className="mt-0.5 block text-xs font-normal text-amber-700">
            {formatMessage(copy.returned, { value })}
        </span>
    );

    return (
        <PageShell>
            <PageHeader
                title={copy.title}
                subtitle={copy.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.purchase,
                    copy.title,
                    'purchases',
                )}
            />

            <div className="space-y-3 rounded-lg border border-gray-100 bg-white p-3 md:p-4">
                <div className="grid gap-3 md:grid-cols-2">
                    <SearchFilterPicker
                        copy={{
                            label: copy.supplierLabel,
                            placeholder: copy.supplierPlaceholder,
                            searchLabel: copy.supplierSearchLabel,
                            clear: copy.clear,
                            searching: copy.searching,
                            noMatches: copy.noMatches,
                        }}
                        selected={filters.party}
                        onSelect={filters.setParty}
                        search={searchSupplierOptions}
                    />
                    <SearchFilterPicker
                        copy={{
                            label: copy.productLabel,
                            placeholder: copy.productPlaceholder,
                            searchLabel: copy.productSearchLabel,
                            clear: copy.clear,
                            searching: copy.searching,
                            noMatches: copy.noMatches,
                        }}
                        selected={filters.product}
                        onSelect={filters.setProduct}
                        search={searchProductOptions}
                    />
                </div>

                <div className="flex flex-wrap items-end gap-3">
                    {/* One branch has nothing to choose between. */}
                    {filters.stores.length > 1 && (
                        <Field label={copy.branchLabel} htmlFor={`${fieldId}-branch`} className="min-w-[160px] flex-1">
                            <Select
                                id={`${fieldId}-branch`}
                                value={filters.storeId}
                                onChange={(e) => filters.setStoreId(e.target.value)}
                            >
                                <option value="">{copy.allBranches}</option>
                                {filters.stores.map((store) => (
                                    <option key={store.id} value={store.id}>
                                        {store.name}
                                    </option>
                                ))}
                            </Select>
                        </Field>
                    )}
                    <Field label={t.accountingShared.from} htmlFor={`${fieldId}-from`} className="min-w-[140px]">
                        <Input
                            id={`${fieldId}-from`}
                            type="date"
                            value={filters.from}
                            max={filters.to || undefined}
                            onChange={(e) => filters.setFrom(e.target.value)}
                        />
                    </Field>
                    <Field label={t.accountingShared.to} htmlFor={`${fieldId}-to`} className="min-w-[140px]">
                        <Input
                            id={`${fieldId}-to`}
                            type="date"
                            value={filters.to}
                            min={filters.from || undefined}
                            onChange={(e) => filters.setTo(e.target.value)}
                        />
                    </Field>
                    <Field label={copy.searchLabel} htmlFor={`${fieldId}-search`} className="min-w-[200px] flex-[2]">
                        <Input
                            id={`${fieldId}-search`}
                            type="search"
                            value={filters.search}
                            placeholder={copy.searchPlaceholder}
                            onChange={(e) => filters.setSearch(e.target.value)}
                        />
                    </Field>
                    <Button variant="secondary" onClick={filters.reset}>
                        {copy.clearFilters}
                    </Button>
                </div>
            </div>

            {error ? (
                <Alert tone="danger">
                    {formatMessage(copy.loadError, { message: error instanceof Error ? error.message : String(error) })}
                </Alert>
            ) : null}

            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <CompactStat label={copy.lines} value={formatNumber(summary?.lineCount ?? 0, locale)} />
                <CompactStat label={copy.bills} value={formatNumber(summary?.billCount ?? 0, locale)} />
                <CompactStat
                    label={copy.quantity}
                    value={
                        <>
                            {formatNumber(summary?.quantity ?? 0, locale)}
                            {summary?.returnedQuantity ? returnedNote(formatNumber(summary.returnedQuantity, locale)) : null}
                        </>
                    }
                />
                <CompactStat
                    label={copy.amount}
                    value={
                        <>
                            {formatBDT(summary?.amount ?? 0, { locale })}
                            {summary?.returnedAmount ? returnedNote(formatBDT(summary.returnedAmount, { locale })) : null}
                        </>
                    }
                />
            </div>
            <p className="text-xs text-gray-500">{copy.basisNote}</p>

            <DataTable<PurchaseLineItemRow>
                tableId="purchase-line-items"
                columns={columns}
                data={items}
                title={copy.tableTitle}
                isLoading={loading}
                emptyMessage={copy.emptyMessage}
                emptyIcon={<ScrollText className="h-16 w-16 text-gray-200" />}
                showSearch={false}
                getRowId={(row) => row.id}
                serverPagination={serverPagination}
            />
        </PageShell>
    );
}

export default function PurchaseLineItemsPage() {
    return (
        <Suspense fallback={<div className="p-8 text-sm text-gray-500" />}>
            <PurchaseLineItemsContent />
        </Suspense>
    );
}
