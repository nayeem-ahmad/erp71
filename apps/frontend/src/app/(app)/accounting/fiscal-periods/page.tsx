'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { CalendarCheck, CalendarClock, CalendarDays, CalendarRange, Lock, Unlock } from 'lucide-react';
import { DataTable, type ListFilter, type ListStat } from '@/components/data-table';
import { RowActions, RowActionButton } from '@/components/table';
import { AccountingPageShell } from '@/components/accounting/compact';
import PageHeader from '@/components/ui/compact/PageHeader';
import { Alert, StatusBadge, type StatusBadgeTone } from '@/components/ui';
import { api } from '@/lib/api';
import { tenantDateOnly, type CreatedRange } from '@/lib/created-range';
import { formatDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { calendarDayOf, inDateRange, matchesAnyOf, matchesSearch } from '@/lib/list-filter';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { toast } from '@/lib/toast';

interface FiscalPeriod {
    id: string;
    year: number;
    month: number;
    period_label: string;
    start_date?: string | null;
    end_date?: string | null;
    is_locked: boolean;
    locked_at: string | null;
}

type PeriodStatus = 'open' | 'closed' | 'locked';

const STATUSES: PeriodStatus[] = ['open', 'closed', 'locked'];
const STATUS_TONE: Record<PeriodStatus, StatusBadgeTone> = { open: 'success', closed: 'warning', locked: 'neutral' };

/** Locked, or — unlocked — whether the month has ended ("closed") or is still running or ahead. */
function statusOf(period: FiscalPeriod, today: string): PeriodStatus {
    if (period.is_locked) return 'locked';
    const end = calendarDayOf(period.end_date) ?? lastDayOf(period.year, period.month);
    return end < today ? 'closed' : 'open';
}

function lastDayOf(year: number, month: number): string {
    return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

const columnHelper = createColumnHelper<FiscalPeriod>();

export default function FiscalPeriodsPage() {
    const { t, fmt, locale } = useI18n();
    const f = t.fiscalPeriods;
    const m = t.accountingMastersUi.fiscalPeriods;
    const currentYear = new Date().getFullYear();
    const [year, setYear] = useState(currentYear);
    const [periods, setPeriods] = useState<FiscalPeriod[]>([]);
    const [loading, setLoading] = useState(true);
    const [working, setWorking] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<string[]>([]);
    const [statusExclude, setStatusExclude] = useState(false);
    const [dateRange, setDateRange] = useState<CreatedRange | null>(null);

    useEffect(() => {
        void load();
        // load reads the year from this render.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [year]);

    const load = async () => {
        setLoading(true);
        try {
            const data = await api.getFiscalPeriods({ year });
            setPeriods(Array.isArray(data) ? data : []);
        } catch (e: any) {
            setPeriods([]);
            toast.error(e?.message ?? f.loadFailed);
        } finally {
            setLoading(false);
        }
    };

    const periodLabel = (p: FiscalPeriod) => {
        const month = f.months[p.month as keyof typeof f.months];
        return month ? `${month} ${p.year}` : p.period_label;
    };

    const toggle = async (p: FiscalPeriod) => {
        const key = `${p.year}-${p.month}`;
        setWorking(key);
        try {
            if (p.is_locked) {
                await api.unlockFiscalPeriod({ year: p.year, month: p.month });
                toast.success(fmt(m.unlockedToast, { period: periodLabel(p) }));
            } else {
                await api.lockFiscalPeriod({ year: p.year, month: p.month });
                toast.success(fmt(m.lockedToast, { period: periodLabel(p) }));
            }
            await load();
        } catch (e: any) {
            toast.error(e?.message ?? f.actionFailed);
        } finally {
            setWorking(null);
        }
    };

    const today = tenantDateOnly();

    const filtered = useMemo(
        () =>
            periods.filter((p) => {
                if (!matchesAnyOf(statusFilter, statusOf(p, today), statusExclude)) return false;
                if (!inDateRange(p.start_date ?? `${p.year}-${String(p.month).padStart(2, '0')}-01`, dateRange)) return false;
                return matchesSearch(search, periodLabel(p), p.period_label);
            }),
        // periodLabel reads only the copy.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [periods, statusFilter, statusExclude, dateRange, search, today, f],
    );

    const yearOptions = useMemo(() => {
        const years = new Set<number>([year]);
        for (let y = currentYear + 1; y >= currentYear - 6; y -= 1) years.add(y);
        return [...years].sort((a, b) => b - a).map((y) => ({ value: String(y), label: String(y) }));
    }, [year, currentYear]);

    const filters = useMemo<ListFilter[]>(() => [
        {
            id: 'year',
            type: 'select',
            label: f.fiscalYear,
            value: String(year),
            // The year is the report's own parameter: clearing it goes back to this year.
            onChange: (next) => setYear(next ? Number(next) : currentYear),
            options: yearOptions,
        },
        {
            id: 'status',
            type: 'multi-select',
            label: f.status,
            value: statusFilter,
            onChange: setStatusFilter,
            exclude: { value: statusExclude, onChange: setStatusExclude },
            options: STATUSES.map((status) => ({ value: status, label: m.statuses[status] })),
        },
        {
            id: 'dates',
            type: 'date-range',
            label: m.dates,
            value: dateRange,
            onChange: setDateRange,
            operators: true,
            presets: ['thisMonth', 'last3Months', 'last6Months', 'thisYear'],
        },
    ], [f, m, year, currentYear, yearOptions, statusFilter, statusExclude, dateRange]);

    const stats = useMemo(() => {
        const n = (value: number) => value.toLocaleString(locale);
        const count = (status: PeriodStatus) => filtered.filter((p) => statusOf(p, today) === status).length;
        const closed = count('closed');
        // The run of locked months from the first one shown — the books are final up to there.
        const ordered = [...filtered].sort((a, b) => a.year - b.year || a.month - b.month);
        const firstOpen = ordered.findIndex((p) => !p.is_locked);
        const lastLocked = firstOpen === -1 ? ordered[ordered.length - 1] : ordered[firstOpen - 1];
        const items: ListStat[] = [
            { id: 'periods', icon: <CalendarDays aria-hidden />, label: m.periods, value: n(filtered.length) },
            { id: 'open', icon: <CalendarClock aria-hidden />, label: m.statuses.open, value: n(count('open')) },
            {
                id: 'closed',
                icon: <CalendarRange aria-hidden />,
                label: m.statuses.closed,
                value: n(closed),
                tone: closed > 0 ? 'warning' : 'default',
            },
            { id: 'locked', icon: <Lock aria-hidden />, label: m.statuses.locked, value: n(count('locked')) },
            {
                id: 'lockedThrough',
                icon: <CalendarCheck aria-hidden />,
                label: m.lockedThrough,
                value: lastLocked ? periodLabel(lastLocked) : m.none,
            },
        ];
        return { items, loading, label: m.statsLabel };
        // periodLabel reads only the copy.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filtered, loading, locale, m, today, f]);

    const columns = useMemo<ColumnDef<FiscalPeriod, any>[]>(
        () => [
            columnHelper.accessor((row) => row.year * 100 + row.month, {
                id: 'period',
                header: f.period,
                cell: (info) => <span className="text-gray-900">{periodLabel(info.row.original)}</span>,
                size: 180,
            }),
            columnHelper.accessor((row) => row.start_date ?? '', {
                id: 'dates',
                header: m.dates,
                cell: (info) => {
                    const p = info.row.original;
                    if (!p.start_date || !p.end_date) return '—';
                    return (
                        <span className="text-gray-500">
                            {formatDate(calendarDayOf(p.start_date), locale)} – {formatDate(calendarDayOf(p.end_date), locale)}
                        </span>
                    );
                },
                size: 220,
                meta: { hideOnMobile: true },
            }),
            columnHelper.accessor((row) => statusOf(row, today), {
                id: 'status',
                header: f.status,
                cell: (info) => {
                    const status = info.getValue() as PeriodStatus;
                    return <StatusBadge tone={STATUS_TONE[status]}>{m.statuses[status]}</StatusBadge>;
                },
                size: 150,
            }),
            columnHelper.accessor((row) => row.locked_at ?? '', {
                id: 'lockedAt',
                header: f.lockedAt,
                cell: (info) => <span className="text-gray-500">{formatDate(info.row.original.locked_at, locale)}</span>,
                size: 140,
                meta: { hideOnMobile: true, align: 'end' },
            }),
            columnHelper.display({
                id: 'actions',
                header: t.common.actions,
                cell: (info) => {
                    const p = info.row.original;
                    const busy = working === `${p.year}-${p.month}`;
                    return (
                        <RowActions>
                            {p.is_locked ? (
                                <RowActionButton
                                    icon={<Unlock />}
                                    label={f.unlock}
                                    intent="success"
                                    disabled={busy}
                                    onClick={() => void toggle(p)}
                                />
                            ) : (
                                <RowActionButton
                                    icon={<Lock />}
                                    label={f.lockPeriod}
                                    intent="warning"
                                    disabled={busy}
                                    onClick={() => void toggle(p)}
                                />
                            )}
                        </RowActions>
                    );
                },
                enableSorting: false,
                enableColumnFilter: false,
                enableResizing: false,
                size: 80,
            }),
        ],
        // periodLabel/toggle read only the copy and setters.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [t, f, m, locale, today, working],
    );

    return (
        <AccountingPageShell>
            <PageHeader
                title={f.title}
                subtitle={f.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.accounting,
                    f.title,
                    'accounting',
                )}
            />

            <Alert tone="warning">{m.lockNotice}</Alert>

            <DataTable<FiscalPeriod>
                tableId="accounting-fiscal-periods"
                columns={columns}
                data={filtered}
                title={f.title}
                isLoading={loading}
                emptyMessage={m.empty}
                emptyIcon={<CalendarDays className="h-10 w-10 text-gray-200" />}
                searchPlaceholder={m.searchPlaceholder}
                searchValue={search}
                onSearchChange={setSearch}
                filters={filters}
                filterLayout="row"
                stats={stats}
                enableColumnFilters={false}
                viewOptions
                getRowId={(row) => row.id}
            />
        </AccountingPageShell>
    );
}
