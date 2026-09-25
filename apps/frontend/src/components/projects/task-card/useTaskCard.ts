'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProjectLabel } from '@/components/projects/board-tasks';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import {
    EMPTY_TIME_FORM,
    isTask,
    num,
    type ProjectMemberRow,
    type RemainingLog,
    type SprintOption,
    type StoryOption,
    type Task,
} from './model';

/**
 * Everything a task card needs to read and write itself, with no opinion about
 * where it is drawn.
 *
 * Extracted so the modal and the page at `/projects/tasks/<id>` share one copy
 * of "how a card loads and saves". Two copies would drift, and the rules here
 * are the subtle ones — `apply` trusting a PATCH response, the lazy fetches
 * keyed on first touch, and `markChanged` catching a blur-commit that lands
 * after the card is already closed.
 *
 * `onClose` is optional: a page has nothing to close back to, so it omits it
 * and ignores `close`.
 */
export function useTaskCard(
    taskId: string,
    { onClose, onChanged }: { onClose?: () => void; onChanged?: () => void } = {},
) {
    const { t, localeInfo } = useI18n();
    const m = t.projects;


    const [task, setTask] = useState<Task | null>(null);
    const [statuses, setStatuses] = useState<{ id: string; name: string; category: string }[]>([]);
    const [history, setHistory] = useState<RemainingLog[]>([]);
    const [busy, setBusy] = useState(false);

    const [timeForm, setTimeForm] = useState(EMPTY_TIME_FORM);

    const [allLabels, setAllLabels] = useState<ProjectLabel[]>([]);
    const [members, setMembers] = useState<ProjectMemberRow[]>([]);

    /**
     * The card and its remaining-hours log — the two things a write from this
     * panel can move. Everything else the panel shows is reference data loaded
     * once below, because no edit made here can change a tenant's label
     * catalogue or a board's columns.
     */
    const loadTask = useCallback(async () => {
        const [detail, log] = await Promise.all([
            api.getProjectTask(taskId),
            api.getTaskRemainingHistory(taskId),
        ]);
        setTask(detail as Task);
        setHistory(Array.isArray(log) ? log : []);
    }, [taskId]);

    useEffect(() => {
        loadTask().catch(() => setTask(null));
    }, [loadTask]);

    /**
     * The tenant's label catalogue, fetched the first time somebody wants to
     * change a card's labels rather than every time a card is opened. The chips
     * a task already wears come with the task, so the section reads correctly
     * before this has ever run.
     */
    const [labelsWanted, setLabelsWanted] = useState(false);
    useEffect(() => {
        if (!labelsWanted) return;
        api.getProjectLabels()
            .then((labels: unknown) => setAllLabels(Array.isArray(labels) ? labels : []))
            .catch(() => setAllLabels([]));
    }, [labelsWanted]);

    const projectId = task?.project?.id ?? null;

    // The task's own board, not the tenant template. Since Phase 3L those are
    // different sets, and offering the template here would let someone move a
    // card into a column its board does not have.
    useEffect(() => {
        if (!projectId) return;
        let live = true;
        api.getProjectColumns(projectId)
            .then((cols: unknown) => {
                if (live) setStatuses(Array.isArray(cols) ? cols : []);
            })
            .catch(() => {
                if (live) setStatuses([]);
            });
        return () => {
            live = false;
        };
    }, [projectId]);

    /**
     * The roster, fetched when the assignee picker is first touched. The card
     * shows whoever holds it from the task itself, so the field is correct
     * before this runs — it only needs the list to offer somebody else.
     */
    const [membersWanted, setMembersWanted] = useState(false);
    /**
     * The read failed, as opposed to returning a project nobody is on. These
     * were one state until people reported the picker as broken: a private
     * project 404s for a non-member, a missing `VIEW_PROJECTS` 403s, and a
     * member holding two stores with neither selected 400s — all three drew the
     * same empty list as a project with no team.
     */
    const [membersFailed, setMembersFailed] = useState(false);
    useEffect(() => {
        if (!projectId || !membersWanted) return;
        let live = true;
        api.getProject(projectId)
            .then((result: unknown) => {
                const rows = (result as { members?: ProjectMemberRow[] } | null)?.members;
                if (!live) return;
                setMembers(Array.isArray(rows) ? rows : []);
                setMembersFailed(false);
            })
            .catch(() => {
                if (!live) return;
                setMembers([]);
                setMembersFailed(true);
            });
        return () => {
            live = false;
        };
    }, [projectId, membersWanted]);

    /**
     * The project's user stories, fetched when the picker is first touched. Same
     * deal as the roster above: the card knows which story it is under from the
     * task itself, so the field reads correctly before this has ever run.
     */
    const [stories, setStories] = useState<StoryOption[]>([]);
    const [storiesWanted, setStoriesWanted] = useState(false);
    useEffect(() => {
        if (!projectId || !storiesWanted) return;
        let live = true;
        api.getProjectStories({ projectId })
            .then((rows: unknown) => {
                if (live) setStories((Array.isArray(rows) ? rows : []) as StoryOption[]);
            })
            .catch(() => {
                if (live) setStories([]);
            });
        return () => {
            live = false;
        };
    }, [projectId, storiesWanted]);

    /**
     * Every sprint in the tenant, fetched when the picker is first opened.
     *
     * **No `projectId`, on purpose.** `Sprint` has no `project_id` — sprints are
     * tenant-level time-boxes that span projects — and `GET /sprints?projectId=`
     * filters by *participation*, i.e. sprints that already hold a task from
     * that project. Passing it would hide exactly the newly-planned sprint
     * somebody opens this picker to move the task into.
     */
    const [sprints, setSprints] = useState<SprintOption[]>([]);
    const [sprintsWanted, setSprintsWanted] = useState(false);
    useEffect(() => {
        if (!sprintsWanted) return;
        let live = true;
        api.getSprints()
            .then((rows: unknown) => {
                if (live) setSprints((Array.isArray(rows) ? rows : []) as SprintOption[]);
            })
            .catch(() => {
                if (live) setSprints([]);
            });
        return () => {
            live = false;
        };
    }, [sprintsWanted]);

    /**
     * The surface behind the modal is reloaded once, when the card is put down.
     * `onChanged` used to fire on every field save, which on the board meant
     * re-fetching every column because somebody fixed a typo in a title.
     */
    const dirty = useRef(false);
    const closed = useRef(false);

    const markChanged = useCallback(() => {
        dirty.current = true;
        // A blur-commit started by the very click that closed the panel lands
        // after `close` has already run. Without this its change would never
        // reach the list behind it.
        if (closed.current) {
            dirty.current = false;
            onChanged?.();
        }
    }, [onChanged]);

    const close = useCallback(() => {
        closed.current = true;
        if (dirty.current) {
            dirty.current = false;
            onChanged?.();
        }
        onClose();
    }, [onChanged, onClose]);

    /**
     * Puts a write's own response into state instead of re-reading the card.
     * `ProjectTasksService.update` ends in `findOne`, so `PATCH
     * /project-tasks/:id` already answers with the whole task — fetching it
     * again cost four requests and a parent reload per saved field, with the
     * panel disabled for the round trip.
     *
     * Returns false when the response was not a task and the card had to be
     * re-read anyway, which is how `applyWithLog` knows the log is fresh.
     */
    const apply = useCallback(
        async (updated: unknown): Promise<boolean> => {
            markChanged();
            if (!isTask(updated)) {
                await loadTask();
                return false;
            }
            setTask(updated);
            return true;
        },
        [loadTask, markChanged],
    );

    /**
     * For the two writes that can also move the remaining-hours log: a status
     * crossing into or out of DONE, and an explicit re-estimate. One extra
     * request rather than the five the old path cost.
     */
    const applyWithLog = useCallback(
        async (updated: unknown) => {
            if (!(await apply(updated))) return;
            const log = await api.getTaskRemainingHistory(taskId).catch(() => null);
            if (Array.isArray(log)) setHistory(log);
        },
        [apply, taskId],
    );

    /** For the endpoints that answer with something other than the task. */
    const refresh = useCallback(async () => {
        markChanged();
        await loadTask();
    }, [loadTask, markChanged]);

    const hours = Number(timeForm.hours || 0);
    const remaining = timeForm.remaining === '' ? undefined : Number(timeForm.remaining);
    const canSaveWork = hours > 0 || remaining !== undefined;

    /**
     * Hours and the revised remaining figure are one form, not two. They are the
     * same act — "here is where this task now stands" — and splitting them meant
     * logging an afternoon and re-estimating it were two saves with two notes.
     * With no hours to log, what is left is a plain re-estimate.
     */
    const saveWork = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!canSaveWork) return;
        const note = timeForm.note.trim() || undefined;
        setBusy(true);
        try {
            if (hours > 0) {
                await api.logProjectTime({
                    taskId,
                    workDate: timeForm.workDate,
                    hours,
                    note,
                    // Blank means "accept the suggestion" — the backend works out
                    // max(0, remaining - hours) rather than the form guessing.
                    remainingHours: remaining,
                });
                toast.success(m.time.logged);
                setTimeForm(EMPTY_TIME_FORM);
                // The time endpoint answers with the entry it wrote, not the
                // task, so this is the one save on the card that re-reads it.
                await refresh();
            } else {
                const updated = await api.updateProjectTask(taskId, {
                    remainingHours: remaining,
                    remainingNote: note,
                });
                toast.success(m.task.updated);
                setTimeForm(EMPTY_TIME_FORM);
                await applyWithLog(updated);
            }
        } catch (error) {
            toast.error(error instanceof Error ? error.message : m.task.saveFailed);
        } finally {
            setBusy(false);
        }
    };

    const changePriority = async (priority: string) => {
        setBusy(true);
        try {
            // Unlike a status change this cannot move the remaining-hours log,
            // so it takes the plain `apply` rather than `applyWithLog`.
            await apply(await api.updateProjectTask(taskId, { priority }));
        } catch (error) {
            toast.error(error instanceof Error ? error.message : m.task.saveFailed);
        } finally {
            setBusy(false);
        }
    };

    const changeSprint = async (sprintId: string) => {
        setBusy(true);
        try {
            // '' returns the task to the backlog, which is what the domain calls
            // clearing a sprint. The DTO's ValidateIf lets the empty string past.
            await apply(await api.updateProjectTask(taskId, { sprintId }));
        } catch (error) {
            toast.error(error instanceof Error ? error.message : m.task.saveFailed);
        } finally {
            setBusy(false);
        }
    };

    const changeStatus = async (statusId: string) => {
        setBusy(true);
        try {
            // Crossing into or out of DONE writes a remaining-hours row as well
            // as the status, so the log is re-read beside the task.
            await applyWithLog(await api.updateProjectTask(taskId, { statusId }));
        } catch (error) {
            toast.error(error instanceof Error ? error.message : m.task.saveFailed);
        } finally {
            setBusy(false);
        }
    };

    const deleteEntry = async (entryId: string) => {
        setBusy(true);
        try {
            await api.deleteProjectTimeEntry(entryId);
            toast.success(m.time.deleted);
            await refresh();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Could not delete the entry');
        } finally {
            setBusy(false);
        }
    };


    const hoursLeftAfter = Math.max(num(task?.remaining_hours) - hours, 0);

    return {
        task, statuses, history, busy, timeForm, setTimeForm,
        hours, canSaveWork, hoursLeftAfter,
        allLabels, members, membersFailed, stories, sprints, localeInfo,
        apply, refresh, markChanged, close,
        changeStatus, changePriority, changeSprint, saveWork, deleteEntry,
        onLabelsWanted: () => setLabelsWanted(true),
        onMembersWanted: () => setMembersWanted(true),
        onStoriesWanted: () => setStoriesWanted(true),
        onSprintsWanted: () => setSprintsWanted(true),
    };
}
