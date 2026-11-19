'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { Mail, PhoneCall, Users, UserX } from 'lucide-react';
import { DataTable, type ListStat } from '@/components/data-table';
import { PageShell } from '@/components/ui';
import PageHeader from '@/components/ui/compact/PageHeader';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { formatRate } from '@/components/crm/reports/format';
import type { ContactCoverageReport, CoverageRow, SourceCoverageRow } from '@/components/crm/reports/types';

const partyHelper = createColumnHelper<CoverageRow & { label: string }>();
const sourceHelper = createColumnHelper<SourceCoverageRow & { label: string }>();

export default function CrmContactCoveragePage() {
    const { t, locale } = useI18n();
    const r = t.crm.reports;
    const copy = r.contactCoverage;
    const dash = t.shared.dash;

    const [report, setReport] = useState<ContactCoverageReport | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        void load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const load = async () => {
        setLoading(true);
        try {
            const data = await api.getCrmContactCoverage();
            setReport(data ?? null);
        } catch (err) {
            setReport(null);
            toast.error(err instanceof Error ? err.message : t.common.loadFailed);
        } finally {
            setLoading(false);
        }
    };

    const count = (value: number) => value.toLocaleString(locale);

    const partyRows = useMemo(
        () => (report?.by_party ?? []).map((row) => ({ ...row, label: copy.parties[row.party] })),
        [report, copy.parties],
    );
    const sourceRows = useMemo(
        () => (report?.by_source ?? []).map((row) => ({ ...row, label: row.name ?? r.common.unspecifiedSource })),
        [report, r.common.unspecifiedSource],
    );

    const totals = report?.totals ?? { total: 0, reachable: 0, unreachable: 0, reachable_pct: null };

    const columns: ColumnDef<CoverageRow & { label: string }, any>[] = useMemo(() => [
        partyHelper.accessor('label', {
            id: 'label',
            header: copy.columns.party,
            footer: () => t.accountingShared.totals,
            size: 160,
        }),
        partyHelper.accessor('total', {
            header: copy.columns.total,
            cell: (info) => count(Number(info.getValue())),
            footer: () => count(totals.total),
            size: 100,
            meta: { align: 'end' },
        }),
        partyHelper.accessor('by_phone', {
            header: copy.columns.phone,
            cell: (info) => count(Number(info.getValue())),
            size: 110,
            meta: { align: 'end' },
        }),
        partyHelper.accessor('by_email', {
            header: copy.columns.email,
            cell: (info) => count(Number(info.getValue())),
            size: 110,
            meta: { align: 'end', hideOnMobile: true },
        }),
        partyHelper.accessor('by_both', {
            header: copy.columns.both,
            cell: (info) => count(Number(info.getValue())),
            size: 90,
            meta: { align: 'end', hideOnMobile: true },
        }),
        partyHelper.accessor('reachable', {
            header: copy.columns.reachable,
            cell: (info) => count(Number(info.getValue())),
            footer: () => count(totals.reachable),
            size: 110,
            meta: { align: 'end' },
        }),
        partyHelper.accessor('reachable_pct', {
            id: 'reachable_pct',
            header: copy.columns.share,
            cell: (info) => formatRate(info.getValue(), locale, dash),
            footer: () => formatRate(totals.reachable_pct, locale, dash),
            size: 110,
            meta: { align: 'end' },
        }),
    ], [copy, locale, dash, totals, t.accountingShared.totals]);

    const sourceColumns: ColumnDef<SourceCoverageRow & { label: string }, any>[] = useMemo(() => [
        sourceHelper.accessor('label', { id: 'label', header: copy.columnsSource.source, size: 200 }),
        sourceHelper.accessor('total', {
            header: copy.columnsSource.total,
            cell: (info) => count(Number(info.getValue())),
            size: 100,
            meta: { align: 'end' },
        }),
        sourceHelper.accessor('reachable', {
            header: copy.columnsSource.reachable,
            cell: (info) => count(Number(info.getValue())),
            size: 110,
            meta: { align: 'end' },
        }),
        sourceHelper.accessor('reachable_pct', {
            id: 'reachable_pct',
            header: copy.columnsSource.share,
            cell: (info) => formatRate(info.getValue(), locale, dash),
            size: 110,
            meta: { align: 'end' },
        }),
    ], [copy, locale, dash]);

    const stats = useMemo(() => {
        const items: ListStat[] = [
            { id: 'total', icon: <Users aria-hidden />, label: copy.columns.total, value: count(totals.total) },
            { id: 'reachable', icon: <PhoneCall aria-hidden />, label: copy.reachableStat, value: formatRate(totals.reachable_pct, locale, dash), hint: count(totals.reachable) },
            { id: 'unreachable', icon: <UserX aria-hidden />, label: copy.unreachableStat, value: count(totals.unreachable), tone: totals.unreachable > 0 ? 'warning' : 'default' },
            { id: 'sources', icon: <Mail aria-hidden />, label: copy.sourcesStat, value: sourceRows.length.toLocaleString(locale) },
        ];
        return { items, loading: loading && !report, label: copy.statsLabel };
    }, [totals, sourceRows.length, loading, report, locale, copy, dash]);

    return (
        <PageShell>
            <PageHeader
                title={copy.title}
                subtitle={copy.subtitle}
                breadcrumbs={modulePageBreadcrumbs(t.dashboardHome.breadcrumbHome, t.sidebar.modules.crm, copy.title, 'crm')}
            />
            <DataTable<CoverageRow & { label: string }>
                tableId="crm-contact-coverage"
                columns={columns}
                data={partyRows}
                title={copy.title}
                isLoading={loading}
                emptyMessage={copy.empty}
                emptyIcon={<PhoneCall className="w-16 h-16 text-gray-200" />}
                stats={stats}
                footerLabel={t.accountingShared.totals}
                enableColumnFilters={false}
                viewOptions
                getRowId={(row) => row.party}
            />

            {sourceRows.length > 0 ? (
                <DataTable<SourceCoverageRow & { label: string }>
                    tableId="crm-contact-coverage-sources"
                    columns={sourceColumns}
                    data={sourceRows}
                    title={copy.sourceSection}
                    emptyMessage={copy.empty}
                    enableColumnFilters={false}
                    getRowId={(row) => row.source_id ?? 'none'}
                />
            ) : null}

            <p className="text-xs text-gray-500">{copy.note}</p>
        </PageShell>
    );
}
