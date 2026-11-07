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
import { api, type Paginated, type PurchaseLineItemParams, type PurchaseLineItemRow, type PurchaseLineItemsReport } from '@/lib/api';
import { formatBDT, formatDate, formatNumber } from '@/lib/format';
import { formatMessage, useI18n } from '@/lib/i18n';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { useBranchForbiddenReset, useBranchScope } from '@/lib/branch-scope';
import type { CreatedRange } from '@/lib/created-range';
import { numberConditionParam, type NumberCondition } from '@/lib/number-condition';
import { routes } from '@/lib/routes';
import { supplierListFilter } from '../../components/supplier-list-filter';
import { reportPeriodFilter, reportPeriodQuery } from '../report-period';

type PurchaseLinePage = Paginated<PurchaseLineItemRow> & PurchaseLineItemsReport;
type MultiSelectFilter = Extract<ListFilter, { type: 'multi-select' }>;

const columnHelper = createColumnHelper<PurchaseLineItemRow>();

const idList = (raw: string | null) => (raw ? raw.split(',').map((id) => id.trim()).filter(Boolean) : []);

function PurchaseLineItemsContent() {
    const { t, locale } = useI18n();
    const copy = t.purchaseReports.lineItems;
    const ui = t.purchaseReports.listUi;
    const searchParams = useSearchParams();
    const branch = useBranchScope();

    const [initial] = useState(() => {
        const opening = defaultLineItemWindow();
        return {
            period: { from: searchParams.get('from') ?? opening.from, to: searchParams.get('to') ?? opening.to },
            supplierIds: idList(searchParams.get('supplierId')),
            productIds: idList(searchParams.get('productId')),
        };
    });
    const [period, setPeriod] = useState<CreatedRange>(initial.period);
    const [supplierIds, setSupplierIds] = useState<string[]>(initial.supplierIds);
    const [productIds, setProductIds] = useState<string[]>(initial.productIds);
    const [unitCost, setUnitCost] = useState<NumberCondition | null>(null);
    const [quantity, setQuantity] = useState<NumberCondition | null>(null);
    const [returned, setReturned] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');

    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
        return () => clearTimeout(timer);
    }, [search]);

    const query = useMemo<PurchaseLineItemParams>(
        () => ({
            ...reportPeriodQuery(period),
            storeId: branch.apiStoreId,
            supplierId: supplierIds.length ? supplierIds.join(',') : undefined,
            productId: productIds.length ? productIds.join(',') : undefined,
            unitCost: numberConditionParam(unitCost),
            quantity: numberConditionParam(quantity),
            returned: returned === 'yes' || returned === 'no' ? returned : undefined,
            search: debouncedSearch || undefined,
        }),
        [period, branch.apiStoreId, supplierIds, productIds, unitCost, quantity, returned, debouncedSearch],
    );

    const { items, response, loading, error, serverPagination } = useServerList<PurchaseLineItemRow, PurchaseLinePage>({
        tableId: 'purchase-line-items',
        initialSort: { id: 'date', desc: true },
        deps: [query],
        enabled: branch.ready,
        fetch: async (params) => {
            const report = await api.getPurchaseLineItems({
                ...query,
                page: params.page,
                limit: params.limit,
                sortBy: params.sortBy,
                sortDir: params.sortDir,
            });
            return { ...report, items: report.rows, ...report.pagination };
        },
    });
    useBranchForbiddenReset(error, branch, t.dashboardLayout.branchFilterForbidden);

    const [named, setNamed] = useState<{ suppliers: ListFilterOption[]; products: ListFilterOption[] }>({
        suppliers: [],
        products: [],
    });
    useEffect(() => {
        if (!response) return;
        const filters = response.filters;
        const suppliers = filters.suppliers ?? (filters.supplier ? [filters.supplier] : []);
        const products = filters.products ?? (filters.product ? [filters.product] : []);
        setNamed((current) => ({
            suppliers: suppliers.length
                ? suppliers.map((supplier) => ({ value: supplier.id, label: supplier.name }))
                : current.suppliers,
            products: products.length
                ? products.map((product) => ({ value: product.id, label: product.name }))
                : current.products,
        }));
    }, [response]);

    const summary = response?.summary;

    const columns = useMemo<ColumnDef<PurchaseLineItemRow, any>[]>(() => {
        const muted = <span className="text-gray-400">{t.shared.dash}</span>;

        return [
            columnHelper.accessor((row) => formatDate(row.date, locale), {
                id: 'date',
                header: copy.columns.date,
                size: 96,
                cell: (info) => <span className="whitespace-nowrap">{info.getValue()}</span>,
            }),
            columnHelper.accessor('purchaseNumber', {
                id: 'bill',
                header: copy.columns.purchase,
                size: 124,
                cell: (info) => {
                    const row = info.row.original;
                    return (
                        <span className="flex flex-col">
                            <Link href={routes.purchases.purchaseInvoice(row.purchaseId)} className="font-medium text-blue-600 hover:underline">
                                {row.purchaseNumber}
                            </Link>
                            {row.referenceNumber && (
                                <span className="text-xs text-gray-500">{row.referenceNumber}</span>
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
            }),
            columnHelper.accessor((row) => row.store?.name ?? '', {
                id: 'branch',
                header: copy.columns.branch,
                size: 110,
                enableSorting: false,
                meta: { hideOnMobile: true },
                cell: (info) => info.getValue() || muted,
            }),
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
            columnHelper.accessor('unitCost', {
                id: 'unitCost',
                header: copy.columns.unitCost,
                size: 104,
                meta: { align: 'end', hideOnMobile: true },
                cell: (info) => formatBDT(info.getValue(), { locale }),
            }),
            columnHelper.accessor('amount', {
                id: 'amount',
                header: copy.columns.amount,
                size: 116,
                meta: { align: 'end' },
                cell: (info) => formatBDT(info.getValue(), { locale }),
            }),
            columnHelper.accessor('returnedQuantity', {
                id: 'returned',
                header: copy.columns.returned,
                size: 96,
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
    }, [copy, locale, t.shared.dash]);

    const filters = useMemo<ListFilter[]>(() => {
        const supplier = supplierListFilter({
            label: copy.supplierLabel,
            noSupplierLabel: copy.noSupplier,
            value: supplierIds,
            onChange: setSupplierIds,
        }) as MultiSelectFilter;
        return [
            reportPeriodFilter({ label: ui.period, value: period, onChange: setPeriod, fallback: defaultLineItemWindow }),
            { ...supplier, options: [...supplier.options, ...named.suppliers] },
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
                id: 'unitCost',
                type: 'number',
                label: copy.columns.unitCost,
                value: unitCost,
                onChange: setUnitCost,
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
    }, [copy, ui, period, supplierIds, productIds, named, unitCost, quantity, returned]);

    const stats = useMemo(() => {
        const n = (value: number) => formatNumber(value, locale);
        const money = (value: number) => formatBDT(value, { locale, minimumFractionDigits: 0, maximumFractionDigits: 0 });
        const dash = t.shared.dash;
        const returnedAmount = summary?.returnedAmount ?? 0;
        const items: ListStat[] = [
            { id: 'lines', icon: <ListOrdered aria-hidden />, label: copy.lines, value: summary ? n(summary.lineCount) : dash },
            { id: 'bills', icon: <FileText aria-hidden />, label: copy.bills, value: summary ? n(summary.billCount) : dash },
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
                    t.sidebar.modules.purchase,
                    copy.title,
                    'purchases',
                )}
                actions={<BranchFilter scope={branch} />}
            />

            {error ? (
                <Alert tone="danger">
                    {formatMessage(copy.loadError, { message: error instanceof Error ? error.message : String(error) })}
                </Alert>
            ) : null}

            <p className="text-xs text-gray-500">{copy.basisNote}</p>

            <DataTable<PurchaseLineItemRow>
                tableId="purchase-line-items"
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

export default function PurchaseLineItemsPage() {
    return (
        <Suspense fallback={<div className="p-8 text-sm text-gray-500" />}>
            <PurchaseLineItemsContent />
        </Suspense>
    );
}
