'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { Ship, Plus, Eye } from 'lucide-react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { api } from '@/lib/api';
import { formatCurrency, formatBDT, formatDate } from '@/lib/format';
import { DataTable } from '@/components/data-table';
import { compactDensity } from '@/lib/ui/compact-density';
import { routes } from '@/lib/routes';
import { useI18n } from '@/lib/i18n';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { PageShell, Checkbox } from '@/components/ui';

interface Shipment {
    id: string;
    reference_number: string;
    lc_number: string | null;
    status: string;
    currency: string;
    invoice_value_fc: string;
    fx_rate_at_open: string | null;
    eta: string | null;
    supplier?: { name: string } | null;
    items: Array<{ id: string }>;
    costs: Array<{ amount_bdt: string; is_capitalized: boolean }>;
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

const columnHelper = createColumnHelper<Shipment>();

export default function ImportShipmentsPage() {
    const { t, locale } = useI18n();
    const copy = t.imports;
    const [shipments, setShipments] = useState<Shipment[]>([]);
    const [loading, setLoading] = useState(true);
    const [openOnly, setOpenOnly] = useState(false);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        api.getImportShipments({ openOnly })
            .then((data: Shipment[]) => {
                // Guards against an out-of-order response overwriting a newer
                // one when the filter is toggled quickly.
                if (!cancelled) setShipments(data);
            })
            .catch(() => {})
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [openOnly]);

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
                sortingFn: (a, b) =>
                    Number(a.getValue('invoice_value_fc')) - Number(b.getValue('invoice_value_fc')),
                size: 140,
            }),
            columnHelper.accessor(
                (row) => row.costs.reduce((sum, cost) => sum + Number(cost.amount_bdt), 0),
                {
                    id: 'costs',
                    header: copy.columns.costsToDate,
                    // Always BDT: the charges are paid locally whatever the
                    // shipment is denominated in.
                    cell: (info) => <span className="text-sm text-gray-700">{formatBDT(info.getValue(), { locale })}</span>,
                    size: 140,
                },
            ),
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
                    t.sidebar.modules.purchase,
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
                searchPlaceholder={copy.searchPlaceholder}
            />
        </PageShell>
    );
}
