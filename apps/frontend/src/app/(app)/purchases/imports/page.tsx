'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { Ship, Plus, Eye, Search } from 'lucide-react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { api } from '@/lib/api';
import { formatCurrency, formatBDT, formatDate } from '@/lib/format';
import { DataTable } from '@/components/data-table';
import { useServerList } from '@/hooks/useServerList';
import { compactDensity } from '@/lib/ui/compact-density';
import { routes } from '@/lib/routes';
import { useI18n } from '@/lib/i18n';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { PageShell, Checkbox, Input, Select } from '@/components/ui';

interface Shipment {
    id: string;
    reference_number: string;
    lc_number: string | null;
    status: string;
    currency: string;
    invoice_value_fc: string;
    invoice_value_bdt: number;
    fx_rate_at_open: string | null;
    eta: string | null;
    supplier?: { name: string } | null;
    item_count: number;
    costs_to_date_bdt: number;
}

/**
 * Neutral until the goods exist, then emerald. Amber for cancelled rather than
 * red: a cancelled shipment is a decision, not a failure.
 */
const statusColors: Record<string, string> = {
    DRAFT: 'bg-gray-50 text-gray-600 border-gray-200',
    LC_APPLIED: 'bg-blue-50 text-blue-700 border-blue-200',
    LC_ISSUED: 'bg-blue-50 text-blue-700 border-blue-200',
    SHIPPED: 'bg-blue-50 text-blue-700 border-blue-200',
    DOCS_RECEIVED: 'bg-blue-50 text-blue-700 border-blue-200',
    CUSTOMS: 'bg-amber-50 text-amber-700 border-amber-200',
    RECEIVED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    CLOSED: 'bg-gray-100 text-gray-500 border-gray-200',
    CANCELLED: 'bg-amber-50 text-amber-700 border-amber-200',
};

/** Kept in step with SHIPMENT_SORTABLE; anything else the server ignores. */
const SORTABLE = new Set([
    'reference_number',
    'lc_number',
    'status',
    'currency',
    'invoice_value_fc',
    'eta',
    'created_at',
]);

const columnHelper = createColumnHelper<Shipment>();

export default function ImportShipmentsPage() {
    const { t, locale } = useI18n();
    const copy = t.imports;
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [openOnly, setOpenOnly] = useState(false);

    // Typing must not fire a request per keystroke.
    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
        return () => clearTimeout(timer);
    }, [search]);

    /**
     * Pages against the server. This list used to pull every shipment a tenant
     * had ever opened — each with its full item and cost rows — and filter in
     * the browser, which is what made `sales/list` fall over on an imported
     * tenant.
     */
    const {
        items: shipments,
        loading,
        serverPagination,
    } = useServerList<Shipment>({
        tableId: 'import-shipments',
        initialSort: { id: 'created_at', desc: true },
        deps: [debouncedSearch, statusFilter, openOnly],
        fetch: (params) =>
            api.getImportShipments({
                ...params,
                sortBy: params.sortBy && SORTABLE.has(params.sortBy) ? params.sortBy : undefined,
                search: debouncedSearch || undefined,
                status: statusFilter || undefined,
                openOnly: openOnly || undefined,
            }),
    });

    const columns: ColumnDef<Shipment, any>[] = useMemo(
        () => [
            columnHelper.accessor('reference_number', {
                header: copy.columns.reference,
                cell: (info) => (
                    <Link
                        href={routes.purchases.imports.shipmentDetail(info.row.original.id)}
                        className="text-sm font-semibold text-blue-600 hover:underline"
                    >
                        {info.getValue()}
                    </Link>
                ),
                size: 160,
            }),
            columnHelper.accessor((row) => row.lc_number ?? '', {
                id: 'lc_number',
                header: copy.columns.lcNumber,
                cell: (info) => (
                    <span className="text-sm text-gray-700">{info.getValue() || <span className="text-gray-300">—</span>}</span>
                ),
                size: 140,
            }),
            columnHelper.accessor((row) => row.supplier?.name ?? '', {
                id: 'supplier',
                header: copy.columns.supplier,
                // Sorting this means ordering by a joined column, which the
                // server's allowlist deliberately does not offer.
                enableSorting: false,
                cell: (info) => (
                    <span className="text-sm text-gray-700">{info.getValue() || <span className="text-gray-300">—</span>}</span>
                ),
                size: 180,
            }),
            columnHelper.accessor('status', {
                header: copy.columns.status,
                cell: (info) => {
                    const status = info.getValue();
                    return (
                        <span
                            className={`px-2.5 py-1 rounded-full text-[10px] font-semibold border ${
                                statusColors[status] ?? statusColors.DRAFT
                            }`}
                        >
                            {copy.status[status as keyof typeof copy.status] ?? status}
                        </span>
                    );
                },
                size: 130,
            }),
            columnHelper.accessor('invoice_value_fc', {
                header: copy.columns.invoiceValue,
                cell: (info) => (
                    // In the shipment's own currency: a USD invoice reads as
                    // USD, because that is the figure on the supplier's paper.
                    <span className="text-sm font-semibold text-gray-900">
                        {formatCurrency(Number(info.getValue()), {
                            currency: info.row.original.currency,
                            locale,
                        })}
                    </span>
                ),
                size: 140,
            }),
            columnHelper.accessor('invoice_value_bdt', {
                header: copy.columns.invoiceValueBdt,
                enableSorting: false,
                meta: { hideOnMobile: true },
                cell: (info) => <span className="text-sm text-gray-700">{formatBDT(info.getValue(), { locale })}</span>,
                size: 140,
            }),
            columnHelper.accessor('costs_to_date_bdt', {
                id: 'costs',
                header: copy.columns.costsToDate,
                // Always BDT: the charges are paid locally whatever the
                // shipment is denominated in.
                enableSorting: false,
                meta: { hideOnMobile: true },
                cell: (info) => <span className="text-sm text-gray-700">{formatBDT(info.getValue(), { locale })}</span>,
                size: 140,
            }),
            columnHelper.accessor('eta', {
                header: copy.columns.eta,
                cell: (info) => (
                    <span className="text-sm text-gray-600">
                        {info.getValue() ? formatDate(info.getValue() as string, locale) : '—'}
                    </span>
                ),
                size: 120,
            }),
            columnHelper.display({
                id: 'actions',
                header: copy.columns.actions,
                cell: (info) => (
                    <div className="flex items-center justify-end">
                        <Link
                            href={routes.purchases.imports.shipmentDetail(info.row.original.id)}
                            className="p-1.5 rounded-lg text-blue-600 hover:bg-blue-50 transition-colors"
                            title={t.common.view}
                        >
                            <Eye className="w-4 h-4" />
                        </Link>
                    </div>
                ),
                enableSorting: false,
                enableColumnFilter: false,
                size: 80,
            }),
        ],
        [copy, locale, t],
    );

    return (
        <PageShell>
            <PageHeader
                title={copy.title}
                subtitle={copy.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.imports,
                    copy.title,
                    'purchases',
                )}
                actions={
                    <Link
                        href={routes.purchases.imports.shipmentNew}
                        className={`${compactDensity.btnPrimary} bg-primary hover:bg-primary-hover text-white`}
                    >
                        <Plus className="w-4 h-4" />
                        {copy.newShipment}
                    </Link>
                }
            />

            <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[220px] flex-1">
                    <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                    <Input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={copy.searchPlaceholder}
                        className="ps-9"
                    />
                </div>
                <Select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="w-auto max-w-[180px]"
                    aria-label={copy.columns.status}
                >
                    <option value="">{copy.allStatuses}</option>
                    {Object.entries(copy.status).map(([value, label]) => (
                        <option key={value} value={value}>
                            {label}
                        </option>
                    ))}
                </Select>
                <label className="inline-flex min-h-touch cursor-pointer items-center gap-2 text-sm text-gray-700">
                    <Checkbox checked={openOnly} onChange={() => setOpenOnly((value) => !value)} />
                    {copy.openOnly}
                </label>
            </div>

            <DataTable<Shipment>
                tableId="import-shipments"
                columns={columns}
                data={shipments}
                title={copy.title}
                isLoading={loading}
                emptyMessage={copy.empty}
                emptyIcon={<Ship className="w-16 h-16 text-gray-200" />}
                // The page owns the search box, and it queries the server.
                // DataTable's own box filters the current page only, so both on
                // screen at once is two inputs that disagree.
                showSearch={false}
                serverPagination={serverPagination}
            />
        </PageShell>
    );
}
