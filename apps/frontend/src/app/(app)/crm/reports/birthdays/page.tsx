'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { Cake, CalendarDays, Users } from 'lucide-react';
import { DataTable, type ListFilter, type ListStat } from '@/components/data-table';
import { PageShell } from '@/components/ui';
import PageHeader from '@/components/ui/compact/PageHeader';
import { api } from '@/lib/api';
import { formatCalendarDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import type { BirthdayRow, BirthdaysReport } from '@/components/crm/reports/types';

const columnHelper = createColumnHelper<BirthdayRow>();

const WINDOWS = [7, 30, 90] as const;

export default function CrmBirthdaysPage() {
    const { t, locale } = useI18n();
    const r = t.crm.reports;
    const copy = r.birthdays;
    const dash = t.shared.dash;

    const [days, setDays] = useState<number>(30);
    const [report, setReport] = useState<BirthdaysReport | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        void load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [days]);

    const load = async () => {
        setLoading(true);
        try {
            const data = await api.getCrmBirthdays({ days });
            setReport(data ?? null);
        } catch (err) {
            setReport(null);
            toast.error(err instanceof Error ? err.message : t.common.loadFailed);
        } finally {
            setLoading(false);
        }
    };

    const rows = report?.rows ?? [];
    const total = report?.total ?? 0;
    const today = report?.today ?? 0;

    const columns: ColumnDef<BirthdayRow, any>[] = useMemo(() => [
        columnHelper.accessor('name', {
            header: copy.columns.customer,
            cell: (info) => (
                <span className="flex items-center gap-2">
                    {info.getValue()}
                    {info.row.original.today ? (
                        <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">
                            {copy.todayBadge}
                        </span>
                    ) : null}
                </span>
            ),
            size: 200,
        }),
        columnHelper.accessor((row) => row.phone ?? dash, {
            id: 'phone',
            header: copy.columns.phone,
            size: 130,
            meta: { hideOnMobile: true },
        }),
        columnHelper.accessor('birthday', {
            header: copy.columns.birthday,
            cell: (info) => formatCalendarDate(info.getValue(), locale),
            size: 110,
            meta: { hideOnMobile: true },
        }),
        columnHelper.accessor('next_birthday', {
            header: copy.columns.next,
            cell: (info) => formatCalendarDate(info.getValue(), locale),
            size: 120,
        }),
        columnHelper.accessor('days_until', {
            header: copy.columns.days,
            cell: (info) => Number(info.getValue()).toLocaleString(locale),
            size: 100,
            meta: { align: 'end' },
        }),
        columnHelper.accessor('turning', {
            header: copy.columns.turning,
            cell: (info) => info.getValue() == null ? dash : Number(info.getValue()).toLocaleString(locale),
            size: 90,
            meta: { align: 'end' },
        }),
    ], [copy, locale, dash]);

    const filters = useMemo<ListFilter[]>(() => [
        {
            id: 'days',
            type: 'select',
            label: copy.window,
            value: String(days),
            onChange: (next) => setDays(Number(next ?? 30)),
            options: WINDOWS.map((value) => ({ value: String(value), label: `${value}` })),
        },
    ], [copy.window, days]);

    const stats = useMemo(() => {
        const items: ListStat[] = [
            { id: 'total', icon: <Users aria-hidden />, label: copy.columns.customer, value: total.toLocaleString(locale) },
            { id: 'today', icon: <Cake aria-hidden />, label: copy.today, value: today.toLocaleString(locale), tone: today > 0 ? 'warning' : 'default' },
            { id: 'window', icon: <CalendarDays aria-hidden />, label: copy.window, value: String(days) },
        ];
        return { items, loading: loading && !report, label: copy.statsLabel };
    }, [total, today, days, loading, report, locale, copy]);

    return (
        <PageShell>
            <PageHeader
                title={copy.title}
                subtitle={copy.subtitle.replace('{days}', String(days))}
                breadcrumbs={modulePageBreadcrumbs(t.dashboardHome.breadcrumbHome, t.sidebar.modules.crm, copy.title, 'crm')}
            />
            <DataTable<BirthdayRow>
                tableId="crm-birthdays"
                columns={columns}
                data={rows}
                title={copy.title}
                isLoading={loading}
                emptyMessage={copy.empty}
                emptyIcon={<Cake className="w-16 h-16 text-gray-200" />}
                filters={filters}
                filterLayout="row"
                stats={stats}
                enableColumnFilters={false}
                viewOptions
                getRowId={(row) => row.customer_id}
            />
            <p className="text-xs text-gray-500">{copy.note}</p>
        </PageShell>
    );
}
