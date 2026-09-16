'use client';

import { useParams, useRouter } from 'next/navigation';
import { PageShell, PageHeader, Button } from '@/components/ui';
import { TaskCardBody, useTaskCard } from '@/components/projects/TaskDetailPanel';
import { useI18n } from '@/lib/i18n';
import { projectChildBreadcrumbs } from '@/lib/page-breadcrumbs';
import { routes } from '@/lib/routes';

/**
 * One task, as a page.
 *
 * The same card the board and the task list open as a modal — the modal is
 * still the default, because opening a card from a board is usually a peek and
 * navigating away from one loses the scroll position, the filters and the column
 * you were reading. This exists for the times a peek is not what is wanted: a
 * link somebody pastes into a chat, a card kept open in its own tab, and a
 * screen where ten sections do not have to live inside a modal's scroller
 * nested in the shell's own.
 *
 * Everything it knows comes from `useTaskCard`, which the modal uses too, so
 * there is one copy of how a card loads and saves rather than two that drift.
 */
export default function TaskDetailPage() {
    const params = useParams<{ id: string }>();
    const taskId = params.id;
    const router = useRouter();
    const { t } = useI18n();
    const m = t.projects;

    // No `onClose`: a page has nothing to close back to. `onChanged` is left out
    // for the same reason — there is no list behind this to reload, and the card
    // already puts every write's response into its own state.
    const card = useTaskCard(taskId);
    const { task } = card;

    const project = task?.project ?? null;

    return (
        <PageShell>
            <PageHeader
                title={task?.title ?? m.task.title}
                subtitle={project ? `${project.code} · ${project.name}` : undefined}
                breadcrumbs={projectChildBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    m.title,
                    project,
                    m.task.title,
                )}
                actions={
                    /* Back to the project, not `router.back()`: this page is
                       reached as often from a pasted link with no history as
                       from a board, and a Back that does nothing is worse than
                       no Back at all. The project is always a real destination —
                       a task has no board of its own, since a board is a
                       hand-picked cross-project wall a task may not be on. */
                    project ? (
                        <Button
                            variant="secondary"
                            onClick={() => router.push(routes.projects.detail(project.id))}
                        >
                            {t.common.back}
                        </Button>
                    ) : undefined
                }
            />

            {!task ? (
                <p className="text-sm text-gray-500">{t.common.loading}</p>
            ) : (
                <TaskCardBody
                    task={task}
                    taskId={taskId}
                    statuses={card.statuses}
                    history={card.history}
                    busy={card.busy}
                    timeForm={card.timeForm}
                    setTimeForm={card.setTimeForm}
                    hours={card.hours}
                    canSaveWork={card.canSaveWork}
                    allLabels={card.allLabels}
                    members={card.members}
                    membersFailed={card.membersFailed}
                    stories={card.stories}
                    localeInfo={card.localeInfo}
                    apply={card.apply}
                    refresh={card.refresh}
                    markChanged={card.markChanged}
                    changeStatus={card.changeStatus}
                    changePriority={card.changePriority}
                    saveWork={card.saveWork}
                    deleteEntry={card.deleteEntry}
                    onLabelsWanted={card.onLabelsWanted}
                    onMembersWanted={card.onMembersWanted}
                    onStoriesWanted={card.onStoriesWanted}
                    onSprintsWanted={card.onSprintsWanted}
                    sprints={card.sprints}
                    changeSprint={card.changeSprint}
                />
            )}
        </PageShell>
    );
}
