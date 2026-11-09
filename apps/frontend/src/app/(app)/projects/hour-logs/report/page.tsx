'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
    BarChart3,
    CalendarDays,
    Clock,
    FolderKanban,
    ListTodo,
    Timer,
    Users,
} from 'lucide-react';
import { PageShell, PageHeader, Button } from '@/components/ui';
import {
    DataTable,
    ListStats,
    type ListFilter,
    type ListStat,
} from '@/components/data-table';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import {
    hourLogPresetRange,
    type HourLogRange,
    type HourLogRangePreset,
} from '@/components/projects/HourLogRangeFilter';
import type { CreatedRange, CreatedRangePreset } from '@/lib/created-range';

type GroupBy = 'task' | 'date' | 'week' | 'month' | 'user' | 'project' | 'tag';

interface ReportRow {
    key: string;
    label: string;
    sublabel: string | null;
    hours: number;
    entries: number;
    share: number;
}

interface ReportSummary {
    totalHours: number;
    entries: number;
    days: number;
    people: number;
    tasks: number;
    projects: number;
    avgHoursPerDay: number;
}

interface ProjectOption {
    id: string;
    code: string;
    name: string;
}

interface PersonOption {
    id: string;
    name: string | null;
    email: string | null;
}

const GROUPS: GroupBy[] = ['task', 'date', 'week', 'month', 'user', 'project', 'tag'];

const CHIP_TO_PRESET: Partial<Record<CreatedRangePreset, HourLogRangePreset>> = {
    last7: '7',
    last30: '30',
    thisMonth: 'month',
};

const DEFAULT_RANGE = hourLogPresetRange('30');
const TABLE_ID = 'project-hour-log-report';

export default function HourLogReportPage() {
    const { t } = useI18n();
    const m = t.projects;
    const hl = m.hourLogs;
    const r = m.hourLogReport;
    const listUi = r.listUi;

    const [range, setRange] = useState<HourLogRange>(() => DEFAULT_RANGE);
    const [groupBy, setGroupBy] = useState<GroupBy>('task');
    const [projectId, setProjectId] = useState('');
    const [personId, setPersonId] = useState('');
    const [projects, setProjects] = useState<ProjectOption[]>([]);
    const [people, setPeople] = useState<PersonOption[]>([]);
    const [rows, setRows] = useState<ReportRow[]>([]);
    const [summary, setSummary] = useState<ReportSummary | null>(null);
    /**
     * How many entries in the range carry more than one tag. Only the server
     * knows, and only for the tag dimension — where it is the difference
     * between a column of shares that reads as wrong and one that says why it
     * adds to more than 100%.
     */
    const [multiTagged, setMultiTagged] = useState(0);
    const [loading, setLoading] = useState(true);

    const valid = range.from <= range.to;
    const createdRange: CreatedRange = useMemo(
        () => ({ from: range.from, to: range.to }),
        [range.from, range.to],
    );

    useEffect(() => {
        api.getProjects({ limit: 100 })
            .then((res) => setProjects((res?.items ?? []) as ProjectOption[]))
            .catch(() => setProjects([]));
    }, []);

    useEffect(() => {
        let cancelled = false;
        api.getProjectTimePeople({ from: range.from, to: range.to, projectId: projectId || undefined })
            .then((data: unknown) => {
                if (!cancelled) setPeople(Array.isArray(data) ? (data as PersonOption[]) : []);
            })
            .catch(() => {
                if (!cancelled) setPeople([]);
            });
        return () => {
            cancelled = true;
        };
    }, [range.from, range.to, projectId]);

    const load = useCallback(async () => {
        if (!valid) return;
        setLoading(true);
        try {
            const data = await api.getProjectTimeReport({
                from: range.from,
                to: range.to,
                groupBy,
                projectId: projectId || undefined,
                userId: personId || undefined,
            });
            setRows((data?.rows ?? []) as ReportRow[]);
            setSummary((data?.summary ?? null) as ReportSummary | null);
            setMultiTagged(Number((data as { multiTaggedEntries?: number })?.multiTaggedEntries ?? 0));
        } catch (error) {
            toast.error(error instanceof Error ? error.message : r.loadFailed);
            setRows([]);
            setSummary(null);
            setMultiTagged(0);
        } finally {
            setLoading(false);
        }
    }, [valid, range.from, range.to, groupBy, projectId, personId, r.loadFailed]);

    useEffect(() => {
        void load();
    }, [load]);

    const chooseRange = useCallback((next: CreatedRange | null, chosen?: CreatedRangePreset) => {
        const mapped = chosen ? CHIP_TO_PRESET[chosen] : undefined;
        if (mapped) {
            setRange(hourLogPresetRange(mapped));
            return;
        }
        if (!next || (!next.from && !next.to)) {
            setRange(hourLogPresetRange('30'));
            return;
        }
        setRange({
            from: next.from ?? range.from,
            to: next.to ?? range.to,
        });
    }, [range.from, range.to]);

    const listFilters = useMemo<ListFilter[]>(
        () => [
            {
                id: 'range',
                type: 'date-range',
                label: m.time.workDate,
                value: createdRange,
                onChange: chooseRange,
                presets: ['last7', 'last30', 'thisMonth'],
                required: true,
                defaultValue: { from: DEFAULT_RANGE.from, to: DEFAULT_RANGE.to },
            },
            {
                id: 'groupBy',
                type: 'select',
                label: r.groupBy,
                value: groupBy,
                onChange: (next) => setGroupBy((next as GroupBy) || 'task'),
                options: GROUPS.map((group) => ({ value: group, label: r.group[group] })),
                required: true,
                defaultValue: 'task',
            },
            {
                id: 'project',
                type: 'select',
                label: m.fields.project,
                value: projectId || null,
                onChange: (next) => setProjectId(next ?? ''),
                options: projects.map((project) => ({
                    value: project.id,
                    label: `${project.code} · ${project.name}`,
                })),
            },
            {
                id: 'person',
                type: 'select',
                label: hl.person,
                value: personId || null,
                onChange: (next) => setPersonId(next ?? ''),
                options: [
                    { value: 'me', label: hl.mine },
                    ...people.map((person) => ({
                        value: person.id,
                        label: person.name || person.email || person.id,
                    })),
                ],
            },
        ],
        [hl, r, m.fields.project, m.time.workDate, createdRange, chooseRange, groupBy, projectId, projects, personId, people],
    );

    const stats = useMemo(() => {
        const items: ListStat[] = [
            {
                id: 'hours',
                icon: <Clock aria-hidden />,
                label: listUi.stats.hours,
                value: (summary?.totalHours ?? 0).toFixed(2),
            },
            {
                id: 'avg',
                icon: <BarChart3 aria-hidden />,
                label: listUi.stats.avgPerDay,
                value: (summary?.avgHoursPerDay ?? 0).toFixed(2),
            },
            {
                id: 'entries',
                icon: <Timer aria-hidden />,
                label: listUi.stats.entries,
                value: String(summary?.entries ?? 0),
            },
            {
                id: 'days',
                icon: <CalendarDays aria-hidden />,
                label: listUi.stats.days,
                value: String(summary?.days ?? 0),
            },
            {
                id: 'people',
                icon: <Users aria-hidden />,
                label: listUi.stats.people,
                value: String(summary?.people ?? 0),
            },
            {
                id: 'tasks',
                icon: <ListTodo aria-hidden />,
                label: listUi.stats.tasks,
                value: String(summary?.tasks ?? 0),
            },
            {
                id: 'projects',
                icon: <FolderKanban aria-hidden />,
                label: listUi.stats.projects,
                value: String(summary?.projects ?? 0),
            },
        ];
        return { items, loading, label: listUi.statsLabel };
    }, [summary, loading, listUi]);

    const columns = useMemo(
        () => [
            {
                id: 'label',
                header: r.group[groupBy],
                accessorKey: 'label',
                cell: ({ row }: { row: { original: ReportRow } }) => (
                    <div className="min-w-0">
                        <span className="font-medium">{row.original.label}</span>
                        {row.original.sublabel ? (
                            <span className="block truncate text-xs text-gray-500">
                                {row.original.sublabel}
                            </span>
                        ) : null}
                    </div>
                ),
            },
            {
                id: 'entries',
                header: r.entries,
                accessorKey: 'entries',
                meta: { hideOnMobile: true, align: 'end' as const },
                cell: ({ row }: { row: { original: ReportRow } }) => (
                    <span className="tabular-nums">{row.original.entries}</span>
                ),
            },
            {
                id: 'hours',
                header: r.hours,
                accessorKey: 'hours',
                meta: { align: 'end' as const },
                cell: ({ row }: { row: { original: ReportRow } }) => (
                    <span className="font-semibold tabular-nums text-blue-600">
                        {row.original.hours.toFixed(2)}
                    </span>
                ),
            },
            {
                id: 'share',
                header: r.share,
                accessorKey: 'share',
                meta: { hideOnMobile: true },
                cell: ({ row }: { row: { original: ReportRow } }) => (
                    <div className="flex items-center gap-2">
                        <div className="h-1.5 min-w-[60px] flex-1 rounded-full bg-gray-100">
                            <div
                                className="h-1.5 rounded-full bg-blue-600"
                                style={{ width: `${Math.min(row.original.share, 100)}%` }}
                            />
                        </div>
                        <span className="w-12 text-end text-xs tabular-nums text-gray-600">
                            {row.original.share.toFixed(1)}%
                        </span>
                    </div>
                ),
            },
        ],
        [r, groupBy],
    );

    return (
        <PageShell>
            <PageHeader
                title={r.title}
                subtitle={r.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.projects,
                    r.title,
                    'projects',
                )}
                actions={
                    <Link href={routes.projects.hourLogs}>
                        <Button variant="secondary" className="min-h-touch">
                            <Clock className="h-4 w-4" />
                            {r.openLogs}
                        </Button>
                    </Link>
                }
            />

            <ListStats stats={stats.items} loading={stats.loading} label={stats.label} />

            {valid ? (
                <div className="space-y-1">
                    <p className="text-xs text-gray-500">{r.rangeHint}</p>
                    {/* Said only when it is true. A tag report where nothing is
                        double-tagged adds to exactly 100%, and warning about it
                        anyway would teach people to ignore the line. */}
                    {groupBy === 'tag' && multiTagged > 0 ? (
                        <p className="text-xs text-amber-700">
                            {r.multiTagged.replace('{count}', String(multiTagged))}
                        </p>
                    ) : null}
                </div>
            ) : (
                <p className="text-sm text-red-600">{hl.rangeInvalid}</p>
            )}

            <DataTable
                title={r.title}
                tableId={TABLE_ID}
                columns={columns as never}
                data={rows}
                isLoading={loading}
                emptyMessage={r.empty}
                emptyIcon={<BarChart3 className="h-16 w-16 text-gray-200" />}
                showSearch={false}
                filters={listFilters}
                filterLayout="row"
                enableColumnFilters={false}
                viewOptions
            />
        </PageShell>
    );
}
