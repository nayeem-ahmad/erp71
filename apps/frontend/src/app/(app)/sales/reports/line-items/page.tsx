'use client';

import { Suspense, useEffect, useId, useMemo } from 'react';
import Link from 'next/link';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { ScrollText } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { Alert, BranchFilter, Button, CompactStat, Field, Input, PageShell } from '@/components/ui';
import PageHeader from '@/components/ui/compact/PageHeader';
import SearchFilterPicker from '@/components/reports/SearchFilterPicker';
import { searchCustomerOptions, searchProductOptions } from '@/components/reports/filter-searches';
import { useLineItemFilters } from '@/components/reports/useLineItemFilters';
import { useServerList } from '@/hooks/useServerList';
import { api, type Paginated, type SalesLineItemRow, type SalesLineItemsReport } from '@/lib/api';
import { formatBDT, formatDate, formatNumber } from '@/lib/format';
import { formatMessage, useI18n } from '@/lib/i18n';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { handleBranchForbidden } from '@/lib/branch-scope';
import { routes } from '@/lib/routes';

type SalesLinePage = Paginated<SalesLineItemRow> & SalesLineItemsReport;

const columnHelper = createColumnHelper<SalesLineItemRow>();

/**
 * Sales > Reports > Sales Line Items: every line of every completed sale,
 * narrowed by period, customer, product, branch and free text.
 *
 * The per-product and per-customer reports say how much; this one says which
 * invoices it came from. The totals above the table cover every matching line,
 * not only the page on screen.
 */
function SalesLineItemsContent() {
    const { t, locale } = useI18n();
    const copy = t.salesReports.lineItems;
    const fieldId = useId();
    const filters = useLineItemFilters('customerId');
    const { nameFromResponse, branch } = filters;

    const { items, response, loading, error, serverPagination } = useServerList<SalesLineItemRow, SalesLinePage>({
        tableId: 'sales-line-items',
        initialSort: { id: 'date', desc: true },
        deps: filters.deps,
        enabled: branch.ready,
        fetch: async (params) => {
            const report = await api.getSalesLineItems({
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
        if (response) nameFromResponse({ party: response.filters.customer, product: response.filters.product });
    }, [response, nameFromResponse]);

    // A branch the server refused: say so and go back to the header branch.
    useEffect(() => {
        if (error) handleBranchForbidden(error, branch, t.dashboardLayout.branchFilterForbidden);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [error]);

    const summary = response?.summary;

    const columns = useMemo<ColumnDef<SalesLineItemRow, any>[]>(() => {
        const muted = <span className="text-gray-300">—</span>;

        return [
            // Accessors return what an export should print; the cells dress it.
            columnHelper.accessor((row) => formatDate(row.date, locale), {
                id: 'date',
                header: copy.columns.date,
                size: 96,
                cell: (info) => <span className="whitespace-nowrap text-sm text-gray-700">{info.getValue()}</span>,
            }),
            columnHelper.accessor('invoiceNumber', {
                id: 'invoice',
                header: copy.columns.invoice,
                size: 124,
                cell: (info) => {
                    const row = info.row.original;
                    return (
                        <span className="flex flex-col">
                            <Link
                                href={routes.sales.detail(row.saleId)}
                                className="text-sm font-semibold text-blue-600 hover:underline"
                            >
                                {row.invoiceNumber}
                            </Link>
                            {row.referenceNumber && row.referenceNumber !== row.invoiceNumber && (
                                <span className="text-xs text-gray-400">{row.referenceNumber}</span>
                            )}
                        </span>
                    );
                },
            }),
            columnHelper.accessor((row) => row.customer?.name ?? t.shared.walkIn, {
                id: 'customer',
                header: copy.columns.customer,
                size: 150,
                meta: { hideOnMobile: true },
                cell: (info) => (
                    <span className={`text-sm ${info.row.original.customer ? 'text-gray-800' : 'text-gray-400'}`}>
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
            columnHelper.accessor('unitPrice', {
                id: 'unitPrice',
                header: copy.columns.unitPrice,
                size: 104,
                meta: { hideOnMobile: true },
                cell: (info) => (
                    <span className="text-sm tabular-nums text-gray-700">{formatBDT(info.getValue(), { locale })}</span>
                ),
            }),
            // Not sortable: quantity × price is not a column the database holds.
            columnHelper.accessor('amount', {
                id: 'amount',
                header: copy.columns.amount,
                size: 116,
                enableSorting: false,
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
    }, [copy, locale, t.shared.walkIn]);

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
                    t.sidebar.modules.sales,
                    copy.title,
                    'sales',
                )}
                actions={<BranchFilter scope={branch} />}
            />

            <div className="space-y-3 rounded-lg border border-gray-100 bg-white p-3 md:p-4">
                <div className="grid gap-3 md:grid-cols-2">
                    <SearchFilterPicker
                        copy={{
                            label: copy.customerLabel,
                            placeholder: copy.customerPlaceholder,
                            searchLabel: copy.customerSearchLabel,
                            clear: copy.clear,
                            searching: copy.searching,
                            noMatches: copy.noMatches,
                        }}
                        selected={filters.party}
                        onSelect={filters.setParty}
                        search={searchCustomerOptions}
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
                    <Field label={t.salesReports.common.from} htmlFor={`${fieldId}-from`} className="min-w-[140px]">
                        <Input
                            id={`${fieldId}-from`}
                            type="date"
                            value={filters.from}
                            max={filters.to || undefined}
                            onChange={(e) => filters.setFrom(e.target.value)}
                        />
                    </Field>
                    <Field label={t.salesReports.common.to} htmlFor={`${fieldId}-to`} className="min-w-[140px]">
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
                <CompactStat label={copy.invoices} value={formatNumber(summary?.invoiceCount ?? 0, locale)} />
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

            <DataTable<SalesLineItemRow>
                tableId="sales-line-items"
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

export default function SalesLineItemsPage() {
    return (
        <Suspense fallback={<div className="p-8 text-sm text-gray-500" />}>
            <SalesLineItemsContent />
        </Suspense>
    );
}
