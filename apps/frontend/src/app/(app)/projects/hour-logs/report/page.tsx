'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Clock } from 'lucide-react';
import { PageShell, PageHeader, Button, Select } from '@/components/ui';
import DataTable from '@/components/data-table/DataTable';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import {
    HourLogRangeFilter,
    hourLogPresetRange,
    type HourLogRange,
    type HourLogRangePreset,
} from '@/components/projects/HourLogRangeFilter';

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

export default function HourLogReportPage() {
    const { t } = useI18n();
    const m = t.projects;
    const hl = m.hourLogs;
    const r = m.hourLogReport;

    const [preset, setPreset] = useState<HourLogRangePreset>('30');
    const [range, setRange] = useState<HourLogRange>(() => hourLogPresetRange('30'));
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
                meta: { hideOnMobile: true },
                cell: ({ row }: { row: { original: ReportRow } }) => (
                    <span className="tabular-nums">{row.original.entries}</span>
                ),
            },
            {
                id: 'hours',
                header: r.hours,
                accessorKey: 'hours',
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

            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
                <Tile label={r.totalHours} value={(summary?.totalHours ?? 0).toFixed(2)} accent />
                <Tile label={r.avgPerDay} value={(summary?.avgHoursPerDay ?? 0).toFixed(2)} />
                <Tile label={r.entries} value={String(summary?.entries ?? 0)} />
                <Tile label={r.days} value={String(summary?.days ?? 0)} />
                <Tile label={r.people} value={String(summary?.people ?? 0)} />
                <Tile label={r.tasks} value={String(summary?.tasks ?? 0)} />
                <Tile label={r.projects} value={String(summary?.projects ?? 0)} />
            </div>

            <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center">
                <HourLogRangeFilter
                    preset={preset}
                    range={range}
                    onPresetChange={setPreset}
                    onRangeChange={setRange}
                    labels={{
                        from: hl.from,
                        to: hl.to,
                        preset7: hl.preset7,
                        preset30: hl.preset30,
                        presetMonth: hl.presetMonth,
                        presetCustom: hl.presetCustom,
                    }}
                />
                <Select
                    value={groupBy}
                    onChange={(e) => setGroupBy(e.target.value as GroupBy)}
                    className="md:w-44"
                    aria-label={r.groupBy}
                >
                    {GROUPS.map((group) => (
                        <option key={group} value={group}>
                            {`${r.groupBy}: ${r.group[group]}`}
                        </option>
                    ))}
                </Select>
                <Select
                    value={projectId}
                    onChange={(e) => setProjectId(e.target.value)}
                    className="md:w-52"
                    aria-label={m.fields.project}
                >
                    <option value="">{hl.allProjects}</option>
                    {projects.map((project) => (
                        <option key={project.id} value={project.id}>
                            {project.code} · {project.name}
                        </option>
                    ))}
                </Select>
                <Select
                    value={personId}
                    onChange={(e) => setPersonId(e.target.value)}
                    className="md:w-48"
                    aria-label={hl.person}
                >
                    <option value="">{hl.allPeople}</option>
                    <option value="me">{hl.mine}</option>
                    {people.map((person) => (
                        <option key={person.id} value={person.id}>
                            {person.name || person.email}
                        </option>
                    ))}
                </Select>
            </div>

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
                tableId="project-hour-log-report"
                columns={columns as never}
                data={rows}
                isLoading={loading}
                emptyMessage={r.empty}
            />
        </PageShell>
    );
}

function Tile({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
    return (
        <div className="rounded-lg border border-gray-100 bg-white p-3">
            <div className="text-xs font-medium text-gray-500">{label}</div>
            <div
                className={`mt-1 text-xl font-semibold tabular-nums ${accent ? 'text-blue-600' : 'text-gray-900'}`}
            >
                {value}
            </div>
        </div>
    );
}
