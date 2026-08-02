'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { PageShell, PageHeader, StatusBadge } from '@/components/ui';
import TaskDetailPanel from '@/components/projects/TaskDetailPanel';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';

interface Task {
    id: string;
    title: string;
    due_date?: string | null;
    remaining_hours?: string | null;
    status?: { id: string; name: string; category: string };
    project?: { id: string; code: string; name: string };
}

const num = (value: unknown): number => (value == null ? 0 : Number(value));

export default function MyTasksPage() {
    const { t } = useI18n();
    const m = t.projects;

    const [tasks, setTasks] = useState<Task[]>([]);
    const [openTaskId, setOpenTaskId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const me = await api.getMe();
            const userId = (me as { id?: string })?.id;
            if (!userId) {
                setTasks([]);
                return;
            }
            const page = await api.getProjectTasks({ assigneeId: userId, limit: 200 });
            setTasks(((page as { items?: Task[] })?.items ?? []) as Task[]);
        } catch {
            setTasks([]);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    return (
        <PageShell>
            <PageHeader title={m.myTasks.title} subtitle={m.myTasks.subtitle} />

            {loading ? (
                <p className="text-sm text-gray-500">{t.common.loading}</p>
            ) : tasks.length === 0 ? (
                <p className="text-sm text-gray-500">{m.myTasks.empty}</p>
            ) : (
                <ul className="divide-y divide-gray-200 rounded-md border border-gray-200 bg-white">
                    {tasks.map((task) => (
                        <li key={task.id} className="flex min-h-touch items-center gap-2 px-3 py-2">
                            <button
                                type="button"
                                onClick={() => setOpenTaskId(task.id)}
                                className="flex-1 truncate text-left text-sm"
                            >
                                {task.title}
                            </button>
                            {task.project && (
                                <Link
                                    href={routes.projects.detail(task.project.id)}
                                    className="hidden shrink-0 text-xs text-blue-600 hover:underline md:inline"
                                >
                                    {task.project.code}
                                </Link>
                            )}
                            {task.status && (
                                <StatusBadge tone={task.status.category === 'DONE' ? 'success' : 'neutral'}>
                                    {task.status.name}
                                </StatusBadge>
                            )}
                            <span className="w-14 shrink-0 text-right text-xs text-gray-500">
                                {num(task.remaining_hours)}h
                            </span>
                        </li>
                    ))}
                </ul>
            )}

            {openTaskId && (
                <TaskDetailPanel taskId={openTaskId} onClose={() => setOpenTaskId(null)} onChanged={load} />
            )}
        </PageShell>
    );
}
