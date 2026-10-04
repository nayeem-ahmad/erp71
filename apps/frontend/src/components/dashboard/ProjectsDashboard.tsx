'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useMe } from '@/hooks/use-me';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';
import PageShell from '@/components/ui/compact/PageShell';
import { DashboardSection, KpiTileGrid, type KpiTileSpec } from './ModuleDashboard';
import type { DashboardIdentity } from './dashboard-identity';
import { dashboardQueryKey } from './dashboard-query';

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
 *
 * The member's id comes from the shared `/auth/me` cache — the dashboard page
 * has just read the same answer to pick this variant, so this no longer costs a
 * third request before any tile can start. Each tile then owns its request and
 * fills in on its own: one slow endpoint holds back one tile, not four.
 */
export default function ProjectsDashboard({ greeting, tenantName }: Readonly<DashboardIdentity>) {
    const { t } = useI18n();
    const copy = t.dashboardHome.projects;

    const { data: me, isPending: mePending } = useMe();
    const userId: string | undefined = me?.id ?? undefined;
    const { today, weekStart } = windows();
    // No id — `/auth/me` failed or came back without one — means there is no one
    // to fetch the personal tiles for. They show their empty state rather than
    // pulse forever with no error and no retry.
    const hasUser = Boolean(userId);
    const personalLoading = (pending: boolean) => (hasUser ? pending : mePending);

    // Each tile fails on its own: one dead endpoint must not blank the page.
    const tasksQuery = useQuery({
        queryKey: dashboardQueryKey('projects', 'open-tasks', userId),
        queryFn: () => api.getProjectTasks({ assigneeId: userId, limit: 20 }) as Promise<{ items?: OpenTask[] } | null>,
        enabled: hasUser,
    });
    const todayQuery = useQuery({
        queryKey: dashboardQueryKey('projects', 'hours', userId, today, today),
        queryFn: () => api.getProjectTimeReport({ from: today, to: today, groupBy: 'date', userId }),
        enabled: hasUser,
    });
    const weekQuery = useQuery({
        queryKey: dashboardQueryKey('projects', 'hours', userId, weekStart, today),
        queryFn: () => api.getProjectTimeReport({ from: weekStart, to: today, groupBy: 'date', userId }),
        enabled: hasUser,
    });
    const projectsQuery = useQuery({
        queryKey: dashboardQueryKey('projects', 'active-projects'),
        queryFn: () => api.getProjects({ status: 'ACTIVE', limit: 1 }),
        enabled: hasUser,
    });
    const timerQuery = useQuery({
        queryKey: dashboardQueryKey('projects', 'timer'),
        queryFn: () => api.getProjectTimer(),
        enabled: hasUser,
        // Started and stopped from the tracker on any page, so a return visit
        // re-checks it rather than trusting a half-minute-old answer.
        staleTime: 0,
    });

    const openTasks = openTasksFrom(tasksQuery.data);
    const tasks = openTasks.tasks.slice(0, 5);
    const tasksLoading = personalLoading(tasksQuery.isPending);
    const timerRunning = Boolean(timerQuery.data);

    const tiles: KpiTileSpec[] = [
        {
            key: 'tasks',
            title: copy.myOpenTasks,
            value: String(openTasks.total),
            delta: { label: '—', positive: true },
            loading: tasksLoading,
        },
        {
            key: 'today',
            title: copy.hoursToday,
            value: (todayQuery.data?.summary?.totalHours ?? 0).toFixed(1),
            delta: { label: '—', positive: true },
            loading: personalLoading(todayQuery.isPending),
        },
        {
            key: 'week',
            title: copy.hoursThisWeek,
            value: (weekQuery.data?.summary?.totalHours ?? 0).toFixed(1),
            delta: { label: '—', positive: true },
            loading: personalLoading(weekQuery.isPending),
        },
        {
            key: 'projects',
            title: copy.activeProjects,
            value: String(projectsQuery.data?.total ?? 0),
            delta: { label: '—', positive: true },
            loading: personalLoading(projectsQuery.isPending),
        },
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

                <KpiTileGrid tiles={tiles} loading={false} deltaContext="" />

                {/*
                    Not labelled `copy.myOpenTasks` here too: that string is
                    also the tasks tile's title, and the tile only carries it
                    once `loading` clears. A second, unconditional copy on this
                    section would let a text query resolve on it and read a
                    still-loading tile grid as done. `copy.title` ("My Work")
                    is unique to this heading.
                */}
                <DashboardSection label={copy.title}>
                    {tasksLoading ? (
                        <div data-testid="open-tasks-skeleton" className="animate-pulse space-y-2">
                            {Array.from({ length: 3 }).map((_, index) => (
                                <div key={index} className="h-11 rounded-lg bg-gray-100" />
                            ))}
                        </div>
                    ) : tasks.length === 0 ? (
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
