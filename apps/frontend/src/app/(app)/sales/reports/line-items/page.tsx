'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { Boxes, FileText, ListOrdered, ScrollText, Undo2, Wallet } from 'lucide-react';
import { DataTable, type ListFilter, type ListFilterOption, type ListStat } from '@/components/data-table';
import { Alert, BranchFilter, PageShell } from '@/components/ui';
import PageHeader from '@/components/ui/compact/PageHeader';
import { defaultLineItemWindow } from '@/components/reports/useLineItemFilters';
import { searchProductOptions } from '@/components/reports/filter-searches';
import { useServerList } from '@/hooks/useServerList';
import { api, type Paginated, type SalesLineItemParams, type SalesLineItemRow, type SalesLineItemsReport } from '@/lib/api';
import { formatBDT, formatDate, formatNumber } from '@/lib/format';
import { formatMessage, useI18n } from '@/lib/i18n';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { useBranchForbiddenReset, useBranchScope } from '@/lib/branch-scope';
import type { CreatedRange } from '@/lib/created-range';
import { numberConditionParam, type NumberCondition } from '@/lib/number-condition';
import { routes } from '@/lib/routes';
import { customerListFilter } from '../../components/customer-list-filter';
import { reportPeriodFilter, reportPeriodQuery } from '../report-period';

type SalesLinePage = Paginated<SalesLineItemRow> & SalesLineItemsReport;
type MultiSelectFilter = Extract<ListFilter, { type: 'multi-select' }>;

const columnHelper = createColumnHelper<SalesLineItemRow>();

const idList = (raw: string | null) => (raw ? raw.split(',').map((id) => id.trim()).filter(Boolean) : []);

/**
 * Sales > Reports > Sales Line Items: every line of every completed sale,
 * narrowed by period, customers, products, branch, price, quantity, returns
 * and free text.
 *
 * The per-product and per-customer reports say how much; this one says which
 * invoices it came from. Every chip goes to the server, and the strip above
 * the table adds up every matching line, not only the page on screen.
 */
function SalesLineItemsContent() {
    const { t, locale } = useI18n();
    const copy = t.salesReports.lineItems;
    const ui = t.salesReports.listUi;
    const searchParams = useSearchParams();
    const branch = useBranchScope();

    // The URL seeds the chips — a customer or product screen links here with
    // its own id — and does not follow them after.
    const [initial] = useState(() => {
        const opening = defaultLineItemWindow();
        return {
            period: { from: searchParams.get('from') ?? opening.from, to: searchParams.get('to') ?? opening.to },
            customerIds: idList(searchParams.get('customerId')),
            productIds: idList(searchParams.get('productId')),
        };
    });
    const [period, setPeriod] = useState<CreatedRange>(initial.period);
    const [customerIds, setCustomerIds] = useState<string[]>(initial.customerIds);
    const [productIds, setProductIds] = useState<string[]>(initial.productIds);
    const [unitPrice, setUnitPrice] = useState<NumberCondition | null>(null);
    const [quantity, setQuantity] = useState<NumberCondition | null>(null);
    const [returned, setReturned] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');

    // Typing must not fire a request per keystroke.
    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
        return () => clearTimeout(timer);
    }, [search]);

    const query = useMemo<SalesLineItemParams>(
        () => ({
            ...reportPeriodQuery(period),
            storeId: branch.apiStoreId,
            customerId: customerIds.length ? customerIds.join(',') : undefined,
            productId: productIds.length ? productIds.join(',') : undefined,
            unitPrice: numberConditionParam(unitPrice),
            quantity: numberConditionParam(quantity),
            returned: returned === 'yes' || returned === 'no' ? returned : undefined,
            search: debouncedSearch || undefined,
        }),
        [period, branch.apiStoreId, customerIds, productIds, unitPrice, quantity, returned, debouncedSearch],
    );

    const { items, response, loading, error, serverPagination } = useServerList<SalesLineItemRow, SalesLinePage>({
        tableId: 'sales-line-items',
        initialSort: { id: 'date', desc: true },
        deps: [query],
        enabled: branch.ready,
        fetch: async (params) => {
            const report = await api.getSalesLineItems({
                ...query,
                page: params.page,
                limit: params.limit,
                sortBy: params.sortBy,
                sortDir: params.sortDir,
            });
            return { ...report, items: report.rows, ...report.pagination };
        },
    });
    // A branch the server refused: say so and go back to the header branch.
    useBranchForbiddenReset(error, branch, t.dashboardLayout.branchFilterForbidden);

    // Names for the ids the chips were seeded with, from the response that
    // echoes what it was narrowed by — so a linked-in customer reads by name.
    const [named, setNamed] = useState<{ customers: ListFilterOption[]; products: ListFilterOption[] }>({
        customers: [],
        products: [],
    });
    useEffect(() => {
        if (!response) return;
        const filters = response.filters;
        const customers = filters.customers ?? (filters.customer ? [filters.customer] : []);
        const products = filters.products ?? (filters.product ? [filters.product] : []);
        setNamed((current) => ({
            customers: customers.length
                ? customers.map((customer) => ({ value: customer.id, label: customer.name }))
                : current.customers,
            products: products.length
                ? products.map((product) => ({ value: product.id, label: product.name }))
                : current.products,
        }));
    }, [response]);

    const summary = response?.summary;

    const columns = useMemo<ColumnDef<SalesLineItemRow, any>[]>(() => {
        const muted = <span className="text-gray-400">{t.shared.dash}</span>;

        return [
            // Accessors return what an export should print; the cells dress it.
            columnHelper.accessor((row) => formatDate(row.date, locale), {
                id: 'date',
                header: copy.columns.date,
                size: 96,
                cell: (info) => <span className="whitespace-nowrap">{info.getValue()}</span>,
            }),
            columnHelper.accessor('invoiceNumber', {
                id: 'invoice',
                header: copy.columns.invoice,
                size: 124,
                cell: (info) => {
                    const row = info.row.original;
                    return (
                        <span className="flex flex-col">
                            <Link href={routes.sales.detail(row.saleId)} className="font-medium text-blue-600 hover:underline">
                                {row.invoiceNumber}
                            </Link>
                            {row.referenceNumber && row.referenceNumber !== row.invoiceNumber && (
                                <span className="text-xs text-gray-500">{row.referenceNumber}</span>
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
            }),
            columnHelper.accessor((row) => row.store?.name ?? '', {
                id: 'branch',
                header: copy.columns.branch,
                size: 110,
                enableSorting: false,
                meta: { hideOnMobile: true },
                cell: (info) => info.getValue() || muted,
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
                            <span>{product.name}</span>
                            {product.sku && <span className="text-xs text-gray-500">{product.sku}</span>}
                        </span>
                    );
                },
            }),
            columnHelper.accessor('quantity', {
                id: 'quantity',
                header: copy.columns.quantity,
                size: 64,
                meta: { align: 'end' },
                cell: (info) => formatNumber(info.getValue(), locale),
            }),
            columnHelper.accessor('unitPrice', {
                id: 'unitPrice',
                header: copy.columns.unitPrice,
                size: 104,
                meta: { align: 'end', hideOnMobile: true },
                cell: (info) => formatBDT(info.getValue(), { locale }),
            }),
            // Not sortable: quantity × price is not a column the database holds.
            columnHelper.accessor('amount', {
                id: 'amount',
                header: copy.columns.amount,
                size: 116,
                enableSorting: false,
                meta: { align: 'end' },
                cell: (info) => formatBDT(info.getValue(), { locale }),
            }),
            columnHelper.accessor('returnedQuantity', {
                id: 'returned',
                header: copy.columns.returned,
                size: 96,
                // Summed from the line's returns, not a stored value to sort on.
                enableSorting: false,
                meta: { align: 'end', hideOnMobile: true },
                cell: (info) => {
                    const row = info.row.original;
                    if (!row.returnedQuantity) return muted;
                    return (
                        <span className="flex flex-col items-end">
                            <span className="text-amber-700">{formatNumber(row.returnedQuantity, locale)}</span>
                            <span className="text-xs text-gray-500">{formatBDT(row.returnedAmount, { locale })}</span>
                        </span>
                    );
                },
            }),
        ];
    }, [copy, locale, t.shared.walkIn, t.shared.dash]);

    const filters = useMemo<ListFilter[]>(() => {
        const customer = customerListFilter({
            label: copy.customerLabel,
            walkInLabel: t.shared.walkIn,
            value: customerIds,
            onChange: setCustomerIds,
            storeId: branch.apiStoreId,
        }) as MultiSelectFilter;
        return [
            reportPeriodFilter({ label: ui.period, value: period, onChange: setPeriod, fallback: defaultLineItemWindow }),
            { ...customer, options: [...customer.options, ...named.customers] },
            {
                id: 'product',
                type: 'multi-select',
                label: copy.productLabel,
                value: productIds,
                onChange: setProductIds,
                options: named.products,
                loadOptions: (term) =>
                    searchProductOptions(term).then((found) =>
                        found.map((product) => ({
                            value: product.id,
                            label: product.detail ? `${product.name} (${product.detail})` : product.name,
                        })),
                    ),
            },
            {
                id: 'unitPrice',
                type: 'number',
                label: copy.columns.unitPrice,
                value: unitPrice,
                onChange: setUnitPrice,
                money: true,
            },
            {
                id: 'quantity',
                type: 'number',
                label: copy.columns.quantity,
                value: quantity,
                onChange: setQuantity,
                more: true,
            },
            {
                id: 'returned',
                type: 'select',
                label: ui.returnedFilter,
                value: returned,
                onChange: setReturned,
                options: [
                    { value: 'yes', label: ui.someReturned },
                    { value: 'no', label: ui.noneReturned },
                ],
                more: true,
            },
        ];
    }, [copy, ui, t.shared.walkIn, branch.apiStoreId, period, customerIds, productIds, named, unitPrice, quantity, returned]);

    const stats = useMemo(() => {
        const n = (value: number) => formatNumber(value, locale);
        const money = (value: number) => formatBDT(value, { locale, minimumFractionDigits: 0, maximumFractionDigits: 0 });
        const dash = t.shared.dash;
        const returnedAmount = summary?.returnedAmount ?? 0;
        const items: ListStat[] = [
            { id: 'lines', icon: <ListOrdered aria-hidden />, label: copy.lines, value: summary ? n(summary.lineCount) : dash },
            { id: 'invoices', icon: <FileText aria-hidden />, label: copy.invoices, value: summary ? n(summary.invoiceCount) : dash },
            { id: 'quantity', icon: <Boxes aria-hidden />, label: copy.quantity, value: summary ? n(summary.quantity) : dash },
            { id: 'amount', icon: <Wallet aria-hidden />, label: copy.amount, value: summary ? money(summary.amount) : dash },
            {
                id: 'returned',
                icon: <Undo2 aria-hidden />,
                label: copy.columns.returned,
                value: summary ? money(returnedAmount) : dash,
                hint: summary?.returnedQuantity ? formatMessage(ui.returnedUnits, { count: n(summary.returnedQuantity) }) : undefined,
                tone: returnedAmount > 0 ? 'danger' : 'default',
            },
        ];
        return { items, loading: loading && !summary, label: ui.statsLabel };
    }, [summary, loading, locale, copy, ui, t.shared.dash]);

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

            {error ? (
                <Alert tone="danger">
                    {formatMessage(copy.loadError, { message: error instanceof Error ? error.message : String(error) })}
                </Alert>
            ) : null}

            <p className="text-xs text-gray-500">{copy.basisNote}</p>

            <DataTable<SalesLineItemRow>
                tableId="sales-line-items"
                columns={columns}
                data={items}
                title={copy.tableTitle}
                isLoading={loading}
                emptyMessage={copy.emptyMessage}
                emptyIcon={<ScrollText className="h-16 w-16 text-gray-200" />}
                searchPlaceholder={copy.searchPlaceholder}
                onSearchChange={setSearch}
                filters={filters}
                filterLayout="row"
                stats={stats}
                enableColumnFilters={false}
                viewOptions
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
