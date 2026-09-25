'use client';

import { Link2, Maximize2 } from 'lucide-react';
import Link from 'next/link';
import ModalShell, { ModalHeader, ModalFooter } from '@/components/ModalShell';
import { Button } from '@/components/ui';
import { routes } from '@/lib/routes';
import { useI18n } from '@/lib/i18n';
import { copyTaskLink } from './task-link';
import { taskKeyOf } from './task-card/model';
import { TaskCardBody } from './task-card/TaskCardBody';
import TaskCardSkeleton from './task-card/TaskCardSkeleton';
import TaskUnavailable from './task-card/TaskUnavailable';
import { useTaskCard } from './task-card/useTaskCard';
import TitleField from './task-card/TitleField';
import WatchButton from './task-card/WatchButton';

/**
 * A task, as a modal — how every list and board opens a card, because opening
 * one from a board is usually a peek. The page at `/projects/tasks/<id>` is the
 * other presentation of the same body; the sections live in `./task-card/`,
 * and this file is kept at its old path and default export so every caller
 * mounts it unchanged.
 */
export default function TaskDetailPanel({
    taskId,
    onClose,
    onChanged,
}: {
    taskId: string;
    onClose: () => void;
    onChanged?: () => void;
}) {
    const { t } = useI18n();
    const m = t.projects;
    const card = useTaskCard(taskId, { onClose, onChanged });
    const { task, close } = card;
    const taskKey = task ? taskKeyOf(task.reference, task.project) : null;

    return (
        /* `dismissOnBackdrop={false}`: nearly every field on this card saves on
           blur, so a click beside the panel used to close it mid-edit and the
           half-typed description went with it. Escape and the two Close buttons
           are still there for the times closing is what was meant. */
        <ModalShell onBackdropClick={close} dismissOnBackdrop={false} size="2xl">
            <ModalHeader
                title={
                    task ? (
                        <TitleField title={task.title} taskId={taskId} onSaved={card.apply} />
                    ) : (
                        m.task.title
                    )
                }
                subtitle={
                    task?.project
                        ? `${taskKey ?? task.project.code} · ${task.project.name}`
                        : undefined
                }
                onClose={close}
            >
                {task && <WatchButton card={card} iconOnly />}
                <button
                    type="button"
                    onClick={() => void copyTaskLink(taskId, m.task)}
                    aria-label={m.task.copyLink}
                    title={m.task.copyLink}
                    className="rounded-md p-2 text-gray-400 hover:bg-gray-100 hover:text-blue-600"
                >
                    <Link2 className="h-4 w-4" aria-hidden />
                </button>
                {/* A link rather than a button: it navigates, so middle-click
                    and copy-link-address should behave like any other link. */}
                <Link
                    href={routes.projects.taskDetail(taskId)}
                    aria-label={m.task.openFull}
                    title={m.task.openFull}
                    className="rounded-md p-2 text-gray-400 hover:bg-gray-100 hover:text-blue-600"
                >
                    <Maximize2 className="h-4 w-4" aria-hidden />
                </Link>
            </ModalHeader>

            {/* The canvas grey the page has, so the card's sections read as
                cards here too rather than as outlines on white. */}
            <div className="max-h-[70vh] overflow-y-auto bg-canvas p-3 md:p-4">
                {task ? (
                    <TaskCardBody task={task} card={card} presentation="modal" />
                ) : card.loadError ? (
                    <TaskUnavailable kind={card.loadError} onRetry={card.retry} />
                ) : (
                    <TaskCardSkeleton presentation="modal" />
                )}
            </div>

            <ModalFooter>
                <Button type="button" variant="secondary" onClick={close}>
                    {t.common.close}
                </Button>
            </ModalFooter>
        </ModalShell>
    );
}
