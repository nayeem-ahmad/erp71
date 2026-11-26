'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { ArrowRightLeft, Ban, Filter, TrendingUp } from 'lucide-react';
import { DataTable, type ListFilter, type ListStat } from '@/components/data-table';
import { PageShell } from '@/components/ui';
import PageHeader from '@/components/ui/compact/PageHeader';
import MineOnlyToggle from '@/components/crm/MineOnlyToggle';
import { api } from '@/lib/api';
import { useCrmMineOnly } from '@/lib/crm-scope';
import { useI18n } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import type { CreatedRange } from '@/lib/created-range';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { formatRate } from '@/components/crm/reports/format';
import type { LeadMovementReport, LeadMovementStageRow } from '@/components/crm/reports/types';
import { defaultReportPeriod, reportPeriodFilter, reportPeriodQuery } from '../report-period';

const columnHelper = createColumnHelper<LeadMovementStageRow>();

const EMPTY_TOTALS: LeadMovementReport['totals'] = {
    moved: 0, converted: 0, lost: 0, conversion_pct: null,
};

function parseStatusIdsParam(raw: string | null): string[] | undefined {
    if (raw == null || raw === '') return undefined;
    const ids = raw.split(',').map((id) => id.trim()).filter(Boolean);
    return ids.length ? ids : undefined;
}

function CrmLeadMovementPage() {
    const { t, locale } = useI18n();
    const r = t.crm.reports;
    const copy = r.leadMovement;
    const scope = t.crm.scope;
    const dash = t.shared.dash;

    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const statusIdsParam = searchParams?.get('statusIds') ?? null;
    const urlStatusIds = useMemo(() => parseStatusIdsParam(statusIdsParam), [statusIdsParam]);

    const { mineOnly, setMineOnly, ready: scopeReady } = useCrmMineOnly();
    const [period, setPeriod] = useState<CreatedRange>(defaultReportPeriod);
    const [selectedIds, setSelectedIds] = useState<string[]>(urlStatusIds ?? []);
    const [report, setReport] = useState<LeadMovementReport | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!scopeReady) return;
        void load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scopeReady, mineOnly, period, statusIdsParam]);

    const load = async () => {
        setLoading(true);
        try {
            const data = await api.getCrmLeadMovement({
                ...reportPeriodQuery(period),
                mine: mineOnly,
                ...(urlStatusIds ? { statusIds: urlStatusIds } : {}),
            });
            setReport(data ?? null);
            if (!urlStatusIds) {
                setSelectedIds((data?.available_stages ?? []).filter((stage) => stage.is_active).map((stage) => stage.id));
            } else {
                setSelectedIds(urlStatusIds);
            }
        } catch (err) {
            setReport(null);
            toast.error(err instanceof Error ? err.message : t.common.loadFailed);
        } finally {
            setLoading(false);
        }
    };

    const onStagesChange = useCallback((next: string[]) => {
        setSelectedIds(next);
        const params = new URLSearchParams(searchParams?.toString() ?? '');
        params.set('statusIds', next.join(','));
        const query = params.toString();
        router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    }, [pathname, router, searchParams]);

    const rows = report?.stages ?? [];
    const totals = report?.totals ?? EMPTY_TOTALS;
    const count = (value: number) => value.toLocaleString(locale);

    const columns: ColumnDef<LeadMovementStageRow, any>[] = useMemo(() => [
        columnHelper.accessor('name', {
            id: 'stage',
            header: copy.columns.stage,
            footer: () => t.accountingShared.totals,
            size: 200,
        }),
        columnHelper.accessor('count', {
            id: 'leads',
            header: copy.columns.leads,
            cell: (info) => count(Number(info.getValue())),
            footer: () => count(totals.moved),
            size: 110,
            meta: { align: 'end' },
        }),
        columnHelper.accessor('share_pct', {
            id: 'share_pct',
            header: copy.columns.share,
            cell: (info) => formatRate(info.getValue(), locale, dash),
            size: 90,
            meta: { align: 'end', hideOnMobile: true },
        }),
    ], [copy, locale, dash, totals, t.accountingShared.totals]);

    const filters = useMemo<ListFilter[]>(() => [
        reportPeriodFilter({ label: t.hr.listUi.period, value: period, onChange: setPeriod }),
        {
            id: 'stages',
            type: 'multi-select',
            label: copy.stagesFilter,
            options: (report?.available_stages ?? []).map((stage) => ({ value: stage.id, label: stage.name })),
            value: selectedIds,
            onChange: onStagesChange,
        },
    ], [t.hr.listUi.period, period, copy.stagesFilter, report, selectedIds, onStagesChange]);

    const stats = useMemo(() => {
        const items: ListStat[] = [
            { id: 'moved', icon: <ArrowRightLeft aria-hidden />, label: copy.movedStat, value: count(totals.moved) },
            { id: 'converted', icon: <TrendingUp aria-hidden />, label: copy.convertedStat, value: count(totals.converted) },
            { id: 'lost', icon: <Ban aria-hidden />, label: copy.lostStat, value: count(totals.lost), tone: 'danger' },
            { id: 'rate', icon: <Filter aria-hidden />, label: copy.rateStat, value: formatRate(totals.conversion_pct, locale, dash) },
        ];
        return { items, loading: loading && !report, label: copy.statsLabel };
    }, [totals, loading, report, locale, copy, dash]);

    return (
        <PageShell>
            <PageHeader
                title={copy.title}
                subtitle={copy.subtitle}
                breadcrumbs={modulePageBreadcrumbs(t.dashboardHome.breadcrumbHome, t.sidebar.modules.crm, copy.title, 'crm')}
                actions={(
                    <MineOnlyToggle
                        value={mineOnly}
                        onChange={setMineOnly}
                        label={scope.mineOnly}
                        title={scope.mineOnlyHint}
                    />
                )}
            />
            <DataTable<LeadMovementStageRow>
                tableId="crm-lead-movement"
                columns={columns}
                data={rows}
                title={copy.title}
                isLoading={loading}
                emptyMessage={copy.empty}
                emptyIcon={<ArrowRightLeft className="w-16 h-16 text-gray-200" />}
                filters={filters}
                filterLayout="row"
                stats={stats}
                footerLabel={t.accountingShared.totals}
                enableColumnFilters={false}
                viewOptions
                getRowId={(row) => row.id}
            />
            <p className="text-xs text-gray-500">{copy.note}</p>
        </PageShell>
    );
}

export default function CrmLeadMovementPageWrapper() {
    // useSearchParams needs a Suspense boundary to keep the route statically
    // renderable under the app router.
    return (
        <Suspense fallback={null}>
            <CrmLeadMovementPage />
        </Suspense>
    );
}
