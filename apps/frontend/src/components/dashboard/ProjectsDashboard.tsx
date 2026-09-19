'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';
import PageShell from '@/components/ui/compact/PageShell';
import { DashboardSection, KpiTileGrid, type KpiTileSpec } from './ModuleDashboard';
import type { DashboardIdentity } from './dashboard-identity';

type OpenTask = {
    id: string;
    title: string;
    project?: { id: string; name: string } | null;
    status?: { category?: string | null } | null;
};

/** Today and the last seven days, as the ISO dates the time report wants. */
function windows() {
    const today = new Date();
    const iso = (date: Date) => date.toISOString().slice(0, 10);
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 6);
    return { today: iso(today), weekStart: iso(weekAgo) };
}

/**
 * `getProjectTasks`/`getProjects` resolve `Paginated<T>` — `{ items, total, … }`,
 * per `fetchPaginated` in `@/lib/api` and every existing caller (e.g.
 * `TimeTracker.tsx`'s `res?.items`).
 */
function rows<T>(page: { items?: T[] } | null | undefined): T[] {
    return page?.items ?? [];
}

/**
 * "My Open Tasks" — the caller's tasks, excluding the ones marked Done.
 *
 * Filtered client-side rather than with `statusCategory`: that param matches
 * one category exactly (`ProjectTaskStatusCategory` is closed to
 * TODO / IN_PROGRESS / DONE), so there is no single value meaning "not done" —
 * the same reason `TimeTracker`'s task list does not narrow by status either.
 * `total` therefore also comes from what the page actually holds once Done is
 * dropped, not from the server's unfiltered count.
 */
function openTasksFrom(page: { items?: OpenTask[] } | null | undefined) {
    const tasks = rows<OpenTask>(page).filter((task) => task.status?.category !== 'DONE');
    return { tasks, total: tasks.length };
}

/**
 * The landing page for a member who reads only Projects — their tasks, their
 * hours, the projects they are on.
 *
 * `userId` is sent explicitly on both hour queries rather than left to the
 * viewer's record scope. A *wide* Project User (scope ALL) would otherwise see
 * the team's hours under a tile that says "my hours"; a narrow one is filtered
 * server-side anyway, so the two simply agree.
 *
 * The running timer is reflected, never started here: the FloatingPanel tracker
 * is already mounted shell-wide for this member, and a second control would be
 * two ways to reach one feature (UI spec §2.8).
 */
export default function ProjectsDashboard({ greeting, tenantName }: Readonly<DashboardIdentity>) {
    const { t } = useI18n();
    const copy = t.dashboardHome.projects;

    const [tasks, setTasks] = useState<OpenTask[]>([]);
    const [openCount, setOpenCount] = useState(0);
    const [hoursToday, setHoursToday] = useState(0);
    const [hoursWeek, setHoursWeek] = useState(0);
    const [activeProjects, setActiveProjects] = useState(0);
    const [timerRunning, setTimerRunning] = useState(false);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        const { today, weekStart } = windows();

        (async () => {
            const me = await api.getMe().catch(() => null);
            const userId = me?.id;
            if (cancelled) return;
            if (!userId) {
                // getMe() failed or came back without an id: there is no one to
                // fetch tiles for, but the skeleton must still clear — otherwise
                // the member stares at four pulsing tiles forever with no error
                // and no retry.
                setLoading(false);
                return;
            }

            // Each tile fails on its own: one dead endpoint must not blank the page.
            const [taskPage, todayReport, weekReport, projectPage, timer] = await Promise.all([
                api.getProjectTasks({ assigneeId: userId, limit: 20 }).catch(() => null),
                api.getProjectTimeReport({ from: today, to: today, groupBy: 'date', userId }).catch(() => null),
                api.getProjectTimeReport({ from: weekStart, to: today, groupBy: 'date', userId }).catch(() => null),
                api.getProjects({ status: 'ACTIVE', limit: 1 }).catch(() => null),
                api.getProjectTimer().catch(() => null),
            ]);
            if (cancelled) return;

            const openTasks = openTasksFrom(taskPage);
            setTasks(openTasks.tasks.slice(0, 5));
            setOpenCount(openTasks.total);
            setHoursToday(todayReport?.summary?.totalHours ?? 0);
            setHoursWeek(weekReport?.summary?.totalHours ?? 0);
            setActiveProjects(projectPage?.total ?? 0);
            setTimerRunning(Boolean(timer));
            setLoading(false);
        })();

        return () => { cancelled = true; };
    }, []);

    const tiles: KpiTileSpec[] = [
        { key: 'tasks', title: copy.myOpenTasks, value: String(openCount), delta: { label: '—', positive: true } },
        { key: 'today', title: copy.hoursToday, value: hoursToday.toFixed(1), delta: { label: '—', positive: true } },
        { key: 'week', title: copy.hoursThisWeek, value: hoursWeek.toFixed(1), delta: { label: '—', positive: true } },
        { key: 'projects', title: copy.activeProjects, value: String(activeProjects), delta: { label: '—', positive: true } },
    ];

    return (
        <PageShell maxWidth="full">
            <div className="space-y-4">
                <div>
                    <h1 className="text-lg font-semibold text-gray-900">{greeting}</h1>
                    <p className="text-xs text-gray-500">{tenantName} • {copy.subtitle}</p>
                </div>

                {timerRunning && (
                    <p className="text-xs font-medium text-emerald-600">{copy.timerRunning}</p>
                )}

                <KpiTileGrid tiles={tiles} loading={loading} deltaContext="" />

                {/*
                    Not labelled `copy.myOpenTasks` here too: that string is
                    also the tasks tile's title, and the tile only carries it
                    once `loading` clears. A second, unconditional copy on this
                    section would let a text query resolve on it and read a
                    still-loading tile grid as done. `copy.title` ("My Work")
                    is unique to this heading.
                */}
                <DashboardSection label={copy.title}>
                    {tasks.length === 0 ? (
                        <p className="text-sm text-gray-500">{copy.nothingAssigned}</p>
                    ) : (
                        <ul className="space-y-2">
                            {tasks.map((task) => (
                                <li key={task.id}>
                                    <Link
                                        href={routes.projects.taskDetail(task.id)}
                                        className="flex min-h-touch items-center justify-between rounded-lg border border-gray-200 p-3 text-sm text-gray-900 hover:border-blue-600"
                                    >
                                        <span>{task.title}</span>
                                        {task.project && (
                                            <span className="text-xs text-gray-500">{task.project.name}</span>
                                        )}
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    )}
                </DashboardSection>
            </div>
        </PageShell>
    );
}
