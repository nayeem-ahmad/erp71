'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Landmark, ListChecks } from 'lucide-react';
import { AccountingPageShell } from '@/components/accounting/compact';
import PageHeader from '@/components/ui/compact/PageHeader';
import { DataTable, type ListFilter, type ListStat } from '@/components/data-table';
import { StatusBadge } from '@/components/ui';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { useApprovedOnly } from '@/lib/accounting-report-scope';
import type { CreatedRange } from '@/lib/created-range';
import { matchesAnyOf, matchesSearch } from '@/lib/list-filter';
import { PERIOD_PRESETS, approvedOnlyFilter, defaultPeriod, requiredPeriod, wholeTaka } from '../_shared/report-chips';

interface VatAccount { id: string; name: string; code?: string | null; type: string; total: number; }
interface VatData {
    filters: { from: string; to: string };
    output_vat: { accounts: VatAccount[]; total: number };
    input_vat: { accounts: VatAccount[]; total: number };
    net_vat_payable: number;
    note: string;
}

type Side = 'output' | 'input';
interface VatRow extends VatAccount { side: Side; }

const SIDES: Side[] = ['output', 'input'];

export default function VatTaxPage() {
    const { t, locale } = useI18n();
    const ui = t.accountingReportsUi.vat;
    const [data, setData] = useState<VatData | null>(null);
    const [period, setPeriod] = useState<CreatedRange>(defaultPeriod);
    const [loading, setLoading] = useState(true);
    const { approvedOnly, setApprovedOnly, approvalEnabled, ready: approvalReady } = useApprovedOnly();
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [sides, setSides] = useState<string[]>([]);

    // approvalReady holds the first fetch until the tenant's approved-only
    // setting is known, so the report is never generated against the wrong value.
    useEffect(() => {
        if (!approvalReady) return;
        let active = true;
        setLoading(true);
        setError(null);
        api.getVatTaxReport({ approvedOnly, from: period.from || undefined, to: period.to || undefined })
            .then((result: VatData) => {
                if (active) setData(result);
            })
            .catch((err: unknown) => {
                if (active) setError(err instanceof Error ? err.message : t.accounting.reports.loadFailed);
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => {
            active = false;
        };
    }, [period, approvalReady, approvedOnly, t.accounting.reports.loadFailed]);

    const sideLabels: Record<Side, string> = useMemo(() => ({ output: ui.output, input: ui.input }), [ui]);

    const allRows = useMemo<VatRow[]>(() => [
        ...(data?.output_vat.accounts ?? []).map((account) => ({ ...account, side: 'output' as const })),
        ...(data?.input_vat.accounts ?? []).map((account) => ({ ...account, side: 'input' as const })),
    ], [data]);

    const rows = useMemo(
        () => allRows.filter((row) => matchesAnyOf(sides, row.side) && matchesSearch(search, row.name, row.code)),
        [allRows, sides, search],
    );

    const columns = useMemo(() => [
        {
            id: 'name',
            header: t.accountingShared.account,
            accessorKey: 'name',
            cell: ({ row }: { row: { original: VatRow } }) => (
                <span className="font-medium text-gray-800">
                    {row.original.name}
                    {row.original.code ? <span className="ms-2 text-xs text-gray-400">{row.original.code}</span> : null}
                </span>
            ),
        },
        {
            id: 'side',
            header: ui.side,
            accessorKey: 'side',
            cell: ({ row }: { row: { original: VatRow } }) => (
                <StatusBadge tone={row.original.side === 'output' ? 'warning' : 'neutral'}>{sideLabels[row.original.side]}</StatusBadge>
            ),
        },
        {
            id: 'total',
            header: t.accountingShared.amount,
            accessorKey: 'total',
            meta: { align: 'end' },
            cell: ({ row }: { row: { original: VatRow } }) => (
                <span className="tabular-nums">{formatBDT(row.original.total, { locale })}</span>
            ),
        },
    ], [t, ui, sideLabels, locale]);

    const filters = useMemo<ListFilter[]>(() => [
        {
            id: 'period',
            type: 'date-range',
            label: t.accountingShared.period,
            value: period,
            // A VAT return is always for some period: cleared, it goes back to this month.
            onChange: (next) => setPeriod(requiredPeriod(next)),
            presets: PERIOD_PRESETS,
            operators: true,
        },
        {
            id: 'side',
            type: 'multi-select',
            label: ui.side,
            value: sides,
            onChange: setSides,
            options: SIDES.map((side) => ({ value: side, label: sideLabels[side] })),
        },
        ...approvedOnlyFilter(t, { approvalEnabled, approvedOnly, onChange: setApprovedOnly }),
    ], [t, ui, period, sides, sideLabels, approvalEnabled, approvedOnly, setApprovedOnly]);

    const stats = useMemo(() => {
        const sum = (side: Side) => rows.filter((row) => row.side === side).reduce((total, row) => total + row.total, 0);
        const output = sum('output');
        const input = sum('input');
        const net = output - input;
        const items: ListStat[] = [
            { id: 'accounts', icon: <ListChecks aria-hidden />, label: t.accountingReportsUi.common.accounts, value: rows.length.toLocaleString(locale) },
            { id: 'output', icon: <ArrowUpRight aria-hidden />, label: t.accounting.reports.vatTax.outputVat, value: wholeTaka(output, locale) },
            { id: 'input', icon: <ArrowDownLeft aria-hidden />, label: t.accounting.reports.vatTax.inputVat, value: wholeTaka(input, locale) },
            {
                id: 'net',
                icon: <Landmark aria-hidden />,
                // Money owed to NBR is amber; a refund due back is not a warning.
                label: net >= 0 ? ui.netPayable : ui.refundable,
                value: wholeTaka(Math.abs(net), locale),
                tone: net > 0 ? 'warning' : 'default',
            },
        ];
        return { items, loading, label: t.accountingReportsUi.common.stats };
    }, [rows, loading, locale, t, ui]);

    return (
        <AccountingPageShell maxWidth="full">
            <PageHeader
                title={t.accounting.reports.vatTax.title}
                subtitle={t.accounting.reports.vatTax.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.accounting,
                    t.accounting.reports.vatTax.title,
                    'accounting',
                )}
            />

            {error && <div className="rounded-lg bg-red-50 border border-red-100 p-3 text-sm text-red-700">{error}</div>}

            <DataTable
                title={t.accounting.reports.vatTax.title}
                tableId="accounting-vat-tax"
                columns={columns as never}
                data={rows}
                isLoading={loading}
                emptyMessage={ui.empty}
                searchValue={search}
                onSearchChange={setSearch}
                searchPlaceholder={t.accountingReportsUi.common.searchAccounts}
                filters={filters}
                filterLayout="row"
                stats={stats}
                enableColumnFilters={false}
                viewOptions
            />

            {data?.note ? <p className="text-xs text-gray-400 italic">{data.note}</p> : null}
        </AccountingPageShell>
    );
}
