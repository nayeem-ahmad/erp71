'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CircleDashed, Clock, FolderKanban, Users } from 'lucide-react';
import { Button, Field, PageHeader, PageShell, Select } from '@/components/ui';
import { ListStats, type ListStat } from '@/components/data-table';
import StaffingLoadChart from '@/components/projects/StaffingLoadChart';
import StaffingMatrix, {
    type StaffingPerson,
    type StaffingProject,
} from '@/components/projects/StaffingMatrix';
import { useIsMdUp } from '@/hooks/useMediaQuery';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { toast } from '@/lib/toast';

type StatusFilter = 'active' | 'all';

interface StaffingSummary {
    people: number;
    projects: number;
    remainingHours: number;
    unassignedRemainingHours: number;
    unassignedOpenTasks: number;
    overloaded: number;
}

interface StaffingPayload {
    projects: StaffingProject[];
    people: StaffingPerson[];
    summary: StaffingSummary;
}

const EMPTY_SUMMARY: StaffingSummary = {
    people: 0,
    projects: 0,
    remainingHours: 0,
    unassignedRemainingHours: 0,
    unassignedOpenTasks: 0,
    overloaded: 0,
};

export default function StaffingPage() {
    const { t } = useI18n();
    const m = t.projects;
    const s = m.staffing;
    const isMdUp = useIsMdUp();

    const [status, setStatus] = useState<StatusFilter>('active');
    const [hideIdle, setHideIdle] = useState(false);
    const [loading, setLoading] = useState(true);
    const [payload, setPayload] = useState<StaffingPayload | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const data = (await api.getProjectStaffing(
                status === 'all' ? { status: 'ALL' } : undefined,
            )) as StaffingPayload | null;
            setPayload(data ?? null);
        } catch {
            toast.error(s.loadFailed);
            setPayload(null);
        } finally {
            setLoading(false);
        }
    }, [status, s.loadFailed]);

    useEffect(() => {
        void load();
    }, [load]);

    const projects = payload?.projects ?? [];
    const people = useMemo(() => {
        const rows = payload?.people ?? [];
        if (!hideIdle) return rows;
        return rows.filter((person) => person.totals.remainingHours !== 0 || person.key === 'unassigned');
    }, [payload, hideIdle]);
    const summary = payload?.summary ?? EMPTY_SUMMARY;
    const empty = !loading && projects.length === 0;

    const stats = useMemo<ListStat[]>(
        () => [
            {
                id: 'people',
                icon: <Users aria-hidden />,
                label: s.listUi.stats.people,
                value: String(summary.people),
            },
            {
                id: 'projects',
                icon: <FolderKanban aria-hidden />,
                label: s.listUi.stats.projects,
                value: String(summary.projects),
            },
            {
                id: 'remaining',
                icon: <Clock aria-hidden />,
                label: s.listUi.stats.remaining,
                value: String(summary.remainingHours),
            },
            {
                id: 'unassigned',
                icon: <CircleDashed aria-hidden />,
                label: s.listUi.stats.unassigned,
                value: String(summary.unassignedRemainingHours),
            },
            {
                id: 'overloaded',
                icon: <Users aria-hidden />,
                label: s.listUi.stats.overloaded,
                value: String(summary.overloaded),
            },
        ],
        [s.listUi.stats, summary],
    );

    return (
        <PageShell>
            <PageHeader
                title={s.title}
                subtitle={s.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.projects,
                    s.title,
                    'projects',
                )}
            />

            <div className="flex flex-wrap items-end gap-2">
                <Field label={t.common.status} htmlFor="staffing-status" className="w-44">
                    <Select
                        id="staffing-status"
                        value={status}
                        onChange={(event) => setStatus(event.target.value as StatusFilter)}
                    >
                        <option value="active">{s.statusActive}</option>
                        <option value="all">{s.statusAll}</option>
                    </Select>
                </Field>
                <Button
                    variant={hideIdle ? 'tinted' : 'secondary'}
                    aria-pressed={hideIdle}
                    onClick={() => setHideIdle((on) => !on)}
                >
                    {s.hideIdle}
                </Button>
            </div>

            <ListStats stats={stats} loading={loading} label={s.listUi.statsLabel} />

            {empty ? (
                <p className="text-sm text-gray-500">{s.empty}</p>
            ) : payload ? (
                <>
                    {isMdUp ? <StaffingMatrix people={people} projects={projects} /> : null}
                    <StaffingLoadChart people={people} projects={projects} expandable={!isMdUp} />
                </>
            ) : null}
        </PageShell>
    );
}
