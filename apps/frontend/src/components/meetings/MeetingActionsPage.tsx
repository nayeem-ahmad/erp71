'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2 } from 'lucide-react';
import { PageShell, PageHeader, Button, StatusBadge } from '@/components/ui';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';
import { formatDate } from '@/lib/format';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { notifyMeetingActionsChanged } from '@/hooks/useOverdueMeetingActionsCount';
import type { MeetingActionRow } from '@/components/meetings/types';

function startOfToday() {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    return date;
}

function addDays(date: Date, days: number) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
}

export function MeetingActionsPage({ scope }: { scope: 'mine' | 'all' }) {
    const { t, locale } = useI18n();
    const m = t.meetings;
    const [rows, setRows] = useState<MeetingActionRow[]>([]);

    const load = async () => {
        try {
            const data = await api.getMeetingActions({ scope });
            setRows(Array.isArray(data) ? data : []);
        } catch (error: unknown) {
            toast.error(error instanceof Error ? error.message : m.loadFailed);
        }
    };

    useEffect(() => {
        void load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scope]);

    const groups = useMemo(() => {
        const today = startOfToday();
        const weekEnd = addDays(today, 7);
        const open = rows.filter((row) => row.status === 'OPEN' || row.status === 'IN_PROGRESS');
        const responsible = scope === 'mine' ? open.filter((row) => row.involved_as === 'responsible') : open;
        const involved = scope === 'mine' ? open.filter((row) => row.involved_as === 'other') : [];
        const due = (row: MeetingActionRow) => new Date(row.due_date);
        return {
            overdue: responsible.filter((row) => due(row) < today),
            thisWeek: responsible.filter((row) => due(row) >= today && due(row) < weekEnd),
            later: responsible.filter((row) => due(row) >= weekEnd),
            done: rows.filter((row) => row.status === 'DONE' || row.status === 'CANCELLED'),
            involved,
        };
    }, [rows, scope]);

    const markDone = async (id: string) => {
        try {
            await api.updateMeetingAction(id, { status: 'DONE' });
            toast.success(m.statusUpdated);
            notifyMeetingActionsChanged();
            await load();
        } catch (error: unknown) {
            toast.error(error instanceof Error ? error.message : m.statusFailed);
        }
    };

    const title = scope === 'all' ? m.allActions : m.myActions;

    const renderGroup = (label: string, items: MeetingActionRow[]) => (
        <section className="space-y-2">
            <h2 className="text-sm font-semibold text-gray-900">{label}</h2>
            {items.length === 0 ? <p className="text-sm text-gray-500">{m.emptyActions}</p> : null}
            <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
                {items.map((row) => (
                    <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                        <div>
                            <p className="font-medium text-gray-900">{row.description}</p>
                            <p className="text-xs text-gray-500">
                                <Link href={routes.meetings.detail(row.meeting.id)} className="text-blue-600 hover:underline">
                                    {row.meeting.meeting_number}
                                </Link>
                                {' · '}{row.discussion.title} · {formatDate(row.due_date, locale)}
                                {scope === 'all' ? ` · ${row.assignee_name}` : ''}
                            </p>
                        </div>
                        <div className="flex items-center gap-2">
                            <StatusBadge tone={row.is_overdue ? 'danger' : row.status === 'DONE' ? 'success' : 'warning'}>
                                {m.actionStatuses[row.status]}
                            </StatusBadge>
                            {row.status !== 'DONE' && row.status !== 'CANCELLED' ? (
                                <Button variant="secondary" onClick={() => row.id && void markDone(row.id)}>
                                    <CheckCircle2 className="h-4 w-4" /> {m.markDone}
                                </Button>
                            ) : null}
                        </div>
                    </li>
                ))}
            </ul>
        </section>
    );

    return (
        <PageShell>
            <PageHeader
                title={title}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.meetings,
                    title,
                    'meetings',
                )}
            />
            <div className="space-y-6">
                {groups.overdue.length ? renderGroup(m.overdue, groups.overdue) : null}
                {groups.thisWeek.length ? renderGroup(m.thisWeek, groups.thisWeek) : null}
                {groups.later.length ? renderGroup(m.later, groups.later) : null}
                {scope === 'mine' && groups.involved.length ? renderGroup(m.alsoInvolved, groups.involved) : null}
                {groups.done.length ? renderGroup(m.done, groups.done) : null}
                {!groups.overdue.length && !groups.thisWeek.length && !groups.later.length && !groups.involved.length && !groups.done.length ? (
                    <p className="text-sm text-gray-500">{m.emptyActions}</p>
                ) : null}
            </div>
        </PageShell>
    );
}
