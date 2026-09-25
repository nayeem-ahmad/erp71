'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Copy, Link2 } from 'lucide-react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { PageShell, PageHeader, Button, ConfirmDialog } from '@/components/ui';
import { taskKeyOf, type RecordTab } from '@/components/projects/task-card/model';
import { TaskCardBody } from '@/components/projects/task-card/TaskCardBody';
import TaskActionsMenu from '@/components/projects/task-card/TaskActionsMenu';
import TaskCardSkeleton from '@/components/projects/task-card/TaskCardSkeleton';
import TaskUnavailable from '@/components/projects/task-card/TaskUnavailable';
import TitleField from '@/components/projects/task-card/TitleField';
import { useTaskCard } from '@/components/projects/task-card/useTaskCard';
import WatchButton from '@/components/projects/task-card/WatchButton';
import { copyTaskLink } from '@/components/projects/task-link';
import { api } from '@/lib/api';
import { formatMessage, useI18n } from '@/lib/i18n';
import { projectChildBreadcrumbs } from '@/lib/page-breadcrumbs';
import { routes } from '@/lib/routes';
import { toast } from '@/lib/toast';

const RECORD_TABS: readonly RecordTab[] = ['comments', 'activity', 'time', 'remaining', 'attachments'];
const isRecordTab = (value: string | null): value is RecordTab =>
    RECORD_TABS.includes(value as RecordTab);

/**
 * One task, as a page.
 *
 * The same card the board and the task list open as a modal — the modal is
 * still the default, because opening a card from a board is usually a peek.
 * This is for the times a peek is not what is wanted: a link somebody pastes
 * into a chat, a card kept open in its own tab, a screen with room for all of
 * it. Everything it knows comes from `useTaskCard`, which the modal uses too,
 * so there is one copy of how a card loads and saves.
 *
 * The page adds what a modal has no use for: the task's key and project under
 * its title, a page-sized title that can still be renamed in place, the record
 * tab in the URL, the browser tab's title, and the ⋯ menu — copy the key, open
 * the project, delete.
 */
function TaskDetailPage() {
    const params = useParams<{ id: string }>();
    const taskId = params.id;
    const router = useRouter();
    const searchParams = useSearchParams();
    const { t } = useI18n();
    const m = t.projects;

    // No `onClose`: a page has nothing to close back to. `onChanged` is left out
    // for the same reason — there is no list behind this to reload.
    const card = useTaskCard(taskId);
    const { task } = card;
    const project = task?.project ?? null;
    const taskKey = task ? taskKeyOf(task.reference, task.project) : null;

    /* The open record tab lives in the URL, so a link can land on a task's
       hour log or its comments and a reload keeps the place. Comments is the
       default and carries no parameter, which keeps a copied link clean. */
    const param = searchParams.get('tab');
    const recordTab: RecordTab = isRecordTab(param) ? param : 'comments';
    const selectTab = useCallback(
        (next: RecordTab | null) => {
            // The strip toggles closed on a second click, which suits the modal.
            // A page has no closed state for its record, so that click is a no-op.
            if (!next) return;
            const path = routes.projects.taskDetail(taskId);
            router.replace(next === 'comments' ? path : `${path}?tab=${next}`, { scroll: false });
        },
        [router, taskId],
    );

    /* The browser tab says which task it holds — the page exists partly to be
       kept open in one — and is put back when the page is left. */
    const originalTitle = useRef<string | null>(null);
    useEffect(() => {
        originalTitle.current = document.title;
        return () => {
            if (originalTitle.current != null) document.title = originalTitle.current;
        };
    }, []);
    const title = task?.title;
    useEffect(() => {
        if (!title) return;
        document.title = [taskKey, title].filter(Boolean).join(' · ');
    }, [taskKey, title]);

    const copyKey = async () => {
        if (!taskKey) return;
        try {
            await navigator.clipboard.writeText(taskKey);
            toast.success(m.task.keyCopied);
        } catch {
            // Undefined in an insecure context, or refused outright: said
            // rather than left looking like it worked.
            toast.error(m.task.copyKeyFailed);
        }
    };

    const [confirmingDelete, setConfirmingDelete] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const deleteTask = async () => {
        if (!task) return;
        setDeleting(true);
        try {
            await api.deleteProjectTask(task.id);
            toast.success(m.task.deleted);
            // To the project, not back through history: this page is reached
            // from a pasted link as often as from a board.
            router.push(project ? routes.projects.detail(project.id) : routes.projects.tasks);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : m.task.deleteFailed);
            setDeleting(false);
            setConfirmingDelete(false);
        }
    };

    return (
        /* Capped at 1200px. At full width on a 1920px screen the description
           ran to ~1,050px lines and the sidebar's captions sat three hundred
           pixels from their values. */
        <PageShell maxWidth="wide">
            <PageHeader
                title={
                    task ? (
                        <TitleField variant="page" title={task.title} taskId={taskId} onSaved={card.apply} />
                    ) : (
                        m.task.title
                    )
                }
                subtitle={
                    task ? (
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            {taskKey && (
                                /* The touch floor is on the button and the chip
                                   is drawn inside it: a 44px-tall bordered box
                                   around a 12px key read as a text field. */
                                <button
                                    type="button"
                                    onClick={() => void copyKey()}
                                    title={m.task.copyKey}
                                    className="group inline-flex items-center rounded-md max-md:min-h-touch"
                                >
                                    <span className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-gray-50 px-1.5 py-0.5 font-semibold tabular-nums text-gray-700 transition-colors group-hover:border-gray-300 group-hover:bg-white">
                                        {taskKey}
                                        <Copy className="h-3 w-3 text-gray-400" aria-hidden />
                                    </span>
                                </button>
                            )}
                            {project && (
                                <>
                                    {taskKey && <span aria-hidden>·</span>}
                                    <Link
                                        href={routes.projects.detail(project.id)}
                                        className="font-medium text-blue-600 hover:underline"
                                    >
                                        {project.name}
                                    </Link>
                                </>
                            )}
                        </span>
                    ) : undefined
                }
                breadcrumbs={projectChildBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    m.title,
                    project,
                    taskKey ?? m.task.title,
                )}
                actions={
                    task ? (
                        /* No Back: the project crumb above goes where it went,
                           and so does ⋯ → Open project. */
                        <>
                            <WatchButton card={card} />
                            <Button
                                variant="secondary"
                                className="max-md:hidden"
                                icon={<Link2 className="h-4 w-4" aria-hidden />}
                                onClick={() => void copyTaskLink(taskId, m.task)}
                            >
                                {m.task.copyLink}
                            </Button>
                            <TaskActionsMenu
                                taskKey={taskKey}
                                onCopyKey={() => void copyKey()}
                                onCopyLink={() => void copyTaskLink(taskId, m.task)}
                                onOpenProject={
                                    project ? () => router.push(routes.projects.detail(project.id)) : undefined
                                }
                                onDelete={() => setConfirmingDelete(true)}
                            />
                        </>
                    ) : undefined
                }
            />

            {task ? (
                <TaskCardBody
                    task={task}
                    card={card}
                    presentation="page"
                    recordTab={recordTab}
                    onRecordTabChange={selectTab}
                />
            ) : card.loadError ? (
                <TaskUnavailable
                    kind={card.loadError}
                    onRetry={card.retry}
                    action={
                        <Button type="button" onClick={() => router.push(routes.projects.tasks)}>
                            {m.task.goToTasks}
                        </Button>
                    }
                />
            ) : (
                <TaskCardSkeleton presentation="page" />
            )}

            <ConfirmDialog
                open={confirmingDelete}
                title={m.task.deleteTask}
                prompt={formatMessage(m.task.deletePrompt, { title: task?.title ?? '' })}
                confirmLabel={t.common.delete}
                cancelLabel={t.common.cancel}
                danger
                loading={deleting}
                onCancel={() => setConfirmingDelete(false)}
                onConfirm={() => void deleteTask()}
            />
        </PageShell>
    );
}

export default function TaskDetailPageWrapper() {
    // useSearchParams needs a Suspense boundary to keep the route renderable
    // under the app router — the same wrapper crm/setup uses.
    return (
        <Suspense fallback={null}>
            <TaskDetailPage />
        </Suspense>
    );
}
