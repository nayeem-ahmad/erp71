'use client';

import { Link2, Maximize2 } from 'lucide-react';
import Link from 'next/link';
import ModalShell, { ModalHeader, ModalFooter } from '@/components/ModalShell';
import { Button } from '@/components/ui';
import { routes } from '@/lib/routes';
import { useI18n } from '@/lib/i18n';
import { copyTaskLink } from './task-link';
import { TaskCardBody } from './task-card/TaskCardBody';
import { useTaskCard } from './task-card/useTaskCard';
import TitleField from './task-card/TitleField';

/*
 * The card's sections live in `./task-card/`, one file each. This file is the
 * modal shell around them, kept at its old path and default export so every
 * caller — the board, the task list, the project page — mounts it unchanged.
 * The page at `/projects/tasks/<id>` imports the body and the hook from here
 * too, for the same reason.
 */
export { TaskCardBody, useTaskCard };

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
    const {
        task,
        close,
        statuses,
        history,
        busy,
        timeForm,
        setTimeForm,
        hours,
        canSaveWork,
        allLabels,
        members,
        membersFailed,
        stories,
        localeInfo,
        apply,
        refresh,
        markChanged,
        changeStatus,
        changePriority,
        saveWork,
        deleteEntry,
        onLabelsWanted,
        onMembersWanted,
        onStoriesWanted,
        onSprintsWanted,
        sprints,
        changeSprint,
    } = card;
    return (
        /* `dismissOnBackdrop={false}`: nearly every field on this card saves on
           blur, so a click beside the panel used to close it mid-edit and the
           half-typed description went with it. Escape and the two Close buttons
           are still there for the times closing is what was meant. */
        <ModalShell onBackdropClick={close} dismissOnBackdrop={false} size="2xl">
            <ModalHeader
                title={
                    task ? (
                        <TitleField title={task.title} taskId={taskId} onSaved={apply} />
                    ) : (
                        m.task.title
                    )
                }
                subtitle={task?.project ? `${task.project.code} · ${task.project.name}` : undefined}
                onClose={close}
            >
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

            <div className="max-h-[70vh] overflow-y-auto p-3 md:p-4">
                {!task ? (
                    <p className="text-sm text-gray-500">{t.common.loading}</p>
                ) : (
                    <TaskCardBody
                        task={task}
                        taskId={taskId}
                        statuses={statuses}
                        history={history}
                        busy={busy}
                        timeForm={timeForm}
                        setTimeForm={setTimeForm}
                        hours={hours}
                        canSaveWork={canSaveWork}
                        allLabels={allLabels}
                        members={members}
                        membersFailed={membersFailed}
                        stories={stories}
                        localeInfo={localeInfo}
                        apply={apply}
                        refresh={refresh}
                        markChanged={markChanged}
                        changeStatus={changeStatus}
                        changePriority={changePriority}
                        saveWork={saveWork}
                        deleteEntry={deleteEntry}
                        onLabelsWanted={onLabelsWanted}
                        onMembersWanted={onMembersWanted}
                        onStoriesWanted={onStoriesWanted}
                        onSprintsWanted={onSprintsWanted}
                        sprints={sprints}
                        changeSprint={changeSprint}
                    />
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
