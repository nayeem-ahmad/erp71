'use client';

import { useEffect, useState } from 'react';
import { Square } from 'lucide-react';
import { ConfirmDialog } from '@/components/ui';
import FloatingPanel from '@/components/FloatingPanel';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import { useProjectTimerStore } from '@/lib/project-timer-store';
import { formatElapsed, type HourLogTag } from './hour-log-day';
import TimeTrackerForm, {
    type CaptureProject,
    type CaptureTask,
    type ManualLogInput,
} from './TimeTrackerForm';
import { useProjectTimerActions } from './use-project-timer';

/** Where the panel's position is remembered. Changing it forgets everybody's. */
const POSITION_KEY = 'time-tracker';

/** A 409 from the overlap guard, as opposed to any other failure. */
const isOverlapConflict = (error: unknown): boolean =>
    error instanceof Error && /overlap/i.test(error.message);

const errorText = (error: unknown, fallback: string): string =>
    error instanceof Error ? error.message : fallback;

/**
 * The time tracker: the form behind the clock.
 *
 * The clock itself lives in the header (`TimerChip`), which is what keeps a
 * running timer visible from page to page — a clock you start and navigate
 * away from used to leave the only screen showing it, and people lost
 * afternoons that way. This panel is what the chip opens: choosing a task,
 * writing a note, attaching tags, and logging time by hand, none of which fits
 * in a header.
 *
 * So it is shown on request and hidden otherwise, running or not. It can still
 * be dragged wherever it is least in the way and collapsed to its header.
 */
export default function TimeTracker() {
    const { t } = useI18n();
    const m = t.projects;
    const hl = m.hourLogs;

    const timer = useProjectTimerStore((state) => state.timer);
    const busy = useProjectTimerStore((state) => state.busy);
    const open = useProjectTimerStore((state) => state.open);
    const setOpen = useProjectTimerStore((state) => state.setOpen);
    const setBusy = useProjectTimerStore((state) => state.setBusy);
    const bumpRevision = useProjectTimerStore((state) => state.bumpRevision);
    const { load, start, stop, discard, patch } = useProjectTimerActions();

    const [collapsed, setCollapsed] = useState(false);
    const [projects, setProjects] = useState<CaptureProject[]>([]);
    const [tags, setTags] = useState<HourLogTag[]>([]);
    const [projectId, setProjectId] = useState('');
    const [tasks, setTasks] = useState<CaptureTask[]>([]);
    const [tasksLoading, setTasksLoading] = useState(false);
    /** The tracker logs *your* hours, so it opens on your tasks. */
    const [onlyMine, setOnlyMine] = useState(true);
    const [userId, setUserId] = useState<string | null>(null);
    /** A manual log the overlap guard refused, held while we ask whether to keep both. */
    const [pendingOverlap, setPendingOverlap] = useState<
        { message: string; retry: () => Promise<void> } | null
    >(null);

    const running = Boolean(timer);
    // Open only. A running clock used to force this panel on screen, because it
    // was the only thing that could keep one visible across pages — the header
    // chip does that now, in a fixed place that covers nothing. So the panel is
    // what you open to write a note, pick tags, switch task or log time by
    // hand, and it stays out of the way the rest of the time.
    const visible = open;

    useEffect(() => {
        load();
    }, [load]);

    // A panel folded away and then closed should not come back folded: the next
    // person to open it asked for the tracker, not for its title bar.
    useEffect(() => {
        if (!visible) setCollapsed(false);
    }, [visible]);

    // Only once the panel is on screen: this component mounts on every page in
    // the app, and nobody needs a project list fetched behind a panel they have
    // not opened.
    useEffect(() => {
        if (!visible || projects.length > 0) return;
        api.getProjects({ limit: 100 })
            .then((res) => setProjects((res?.items ?? []) as CaptureProject[]))
            .catch(() => setProjects([]));
        api.getProjectTimeTags()
            .then((rows: unknown) => setTags(Array.isArray(rows) ? (rows as HourLogTag[]) : []))
            .catch(() => setTags([]));
        // Who "mine" is. Nobody resolving it leaves the list unfiltered rather
        // than empty — see the fetch below.
        api.getMe()
            .then((me: unknown) => setUserId((me as { id?: string })?.id ?? null))
            .catch(() => setUserId(null));
        // `projects.length` is the "have we already" flag, not a trigger.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visible]);

    // The task list: yours by default, across every project unless one is
    // picked. Held until the panel is open for the same reason the project list
    // is — this component is mounted on every page in the app.
    //
    // Deliberately not narrowed to open tasks: `statusCategory` matches one
    // category exactly, so there is no single value for "TODO or IN_PROGRESS",
    // and logging an afternoon against a task somebody already moved to Done is
    // ordinary — the hours came before the move.
    useEffect(() => {
        if (!visible) return;
        // Asking for "my tasks" before we know who that is would send no filter
        // at all and quietly list everyone's, so the fetch waits.
        if (onlyMine && userId === null) return;
        let cancelled = false;
        setTasksLoading(true);
        api.getProjectTasks({
            limit: 200,
            ...(projectId ? { projectId } : {}),
            ...(onlyMine && userId ? { assigneeId: userId } : {}),
        })
            .then((res) => {
                if (!cancelled) setTasks((res?.items ?? []) as CaptureTask[]);
            })
            .catch(() => {
                if (!cancelled) setTasks([]);
            })
            .finally(() => {
                if (!cancelled) setTasksLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [projectId, onlyMine, userId, visible]);

    // Resynced from the server on every refetch rather than counted from a
    // parsed timestamp against the device clock: a phone running two minutes
    // fast should still show the elapsed time that will actually be recorded.
    // Counted here rather than in the form so that collapsing the panel — which
    // unmounts the form — does not restart the count.
    const [elapsed, setElapsed] = useState(0);
    useEffect(() => {
        if (!timer) return;
        setElapsed(timer.elapsed_seconds);
        const handle = setInterval(() => setElapsed((value) => value + 1), 1000);
        return () => clearInterval(handle);
        // Deliberately keyed on the two fields rather than the object: `timer`
        // is a fresh object on every refetch, and depending on it would restart
        // the interval — and the count — several times a minute.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [timer?.id, timer?.elapsed_seconds]);

    /**
     * Runs a log, and when the overlap guard refuses it, holds the retry behind
     * a confirmation instead of failing outright. Keeping both is a decision
     * someone can make; being unable to record a second sitting is not.
     */
    const logManual = async (input: ManualLogInput) => {
        setBusy(true);
        const attempt = async (allowOverlap: boolean) => {
            await api.logProjectTime({
                taskId: input.taskId,
                workDate: input.workDate,
                hours: input.hours,
                startTime: input.startTime,
                endTime: input.endTime,
                note: input.note,
                tagIds: input.tagIds,
                ...(allowOverlap ? { allowOverlap: true } : {}),
            });
            toast.success(m.time.logged);
            bumpRevision();
        };
        try {
            await attempt(false);
        } catch (error) {
            if (isOverlapConflict(error)) {
                setPendingOverlap({
                    message: errorText(error, hl.logFailed),
                    retry: () => attempt(true),
                });
            } else {
                toast.error(errorText(error, hl.logFailed));
            }
        } finally {
            setBusy(false);
        }
    };

    const confirmOverlap = async () => {
        const pending = pendingOverlap;
        setPendingOverlap(null);
        if (!pending) return;
        try {
            await pending.retry();
        } catch (error) {
            toast.error(errorText(error, hl.logFailed));
        }
    };

    if (!visible) return null;

    return (
        <>
            <FloatingPanel
                storageKey={POSITION_KEY}
                title={hl.tracker}
                collapsed={collapsed}
                onToggleCollapse={() => setCollapsed((value) => !value)}
                // Dismissable even while a clock runs: the header chip keeps it
                // visible, so closing this panel no longer risks the lost
                // afternoon that used to make dismissing it dangerous.
                onClose={() => setOpen(false)}
                labels={{
                    move: hl.trackerMove,
                    collapse: hl.trackerCollapse,
                    expand: hl.trackerExpand,
                    close: hl.trackerClose,
                }}
                headerAccessory={
                    collapsed && running ? (
                        <>
                            <span
                                className="text-sm font-semibold tabular-nums text-blue-600"
                                aria-label={hl.running}
                                role="timer"
                            >
                                {formatElapsed(elapsed)}
                            </span>
                            <button
                                type="button"
                                onClick={() => void stop()}
                                disabled={busy}
                                aria-label={hl.stop}
                                title={hl.stop}
                                className="flex min-h-touch min-w-touch items-center justify-center rounded-md text-danger transition-colors hover:bg-red-50 disabled:opacity-60 md:min-h-0 md:min-w-0 md:p-1"
                            >
                                <Square className="h-4 w-4" aria-hidden="true" />
                            </button>
                        </>
                    ) : null
                }
            >
                <TimeTrackerForm
                    labels={{
                        placeholder: hl.capturePlaceholder,
                        // Deliberately not the same names the hour log's filters
                        // carry: two controls called "Project" on one screen, one
                        // choosing what you are reading and one choosing what you
                        // are about to log against, is ambiguous to anyone reading
                        // the labels aloud and to anyone reading them at all.
                        project: hl.captureProject,
                        task: hl.captureTask,
                        selectProject: m.task.selectProject,
                        selectTask: hl.selectTask,
                        allProjects: hl.allProjects,
                        noTasks: hl.trackerNoTasks,
                        noMatches: hl.trackerNoMatches,
                        searchTasks: hl.searchTasks,
                        loadingTasks: hl.loadingTasks,
                        clearTask: hl.clearTask,
                        mine: hl.scopeMine,
                        everyone: hl.scopeEveryone,
                        scope: hl.scope,
                        tags: hl.tags,
                        noTags: hl.noTags,
                        start: hl.start,
                        stop: hl.stop,
                        discard: hl.discardTimer,
                        log: hl.logHours,
                        hours: m.time.hours,
                        date: m.time.workDate,
                        startTime: hl.startTime,
                        endTime: hl.endTime,
                        timerMode: hl.timerMode,
                        manualMode: hl.manualMode,
                        running: hl.running,
                        startedAt: hl.timerStartedAt,
                    }}
                    projects={projects}
                    tasks={tasks}
                    tags={tags}
                    timer={timer}
                    elapsed={elapsed}
                    busy={busy}
                    projectId={projectId}
                    onProjectChange={setProjectId}
                    tasksLoading={tasksLoading}
                    onlyMine={onlyMine}
                    onOnlyMineChange={setOnlyMine}
                    onStart={start}
                    onStop={stop}
                    onDiscard={discard}
                    onUpdateTimer={patch}
                    onLogManual={logManual}
                />
            </FloatingPanel>

            <ConfirmDialog
                open={pendingOverlap !== null}
                title={hl.overlapTitle}
                prompt={`${pendingOverlap?.message ?? ''}\n\n${hl.overlapPrompt}`}
                confirmLabel={hl.overlapKeepBoth}
                cancelLabel={t.common.cancel}
                onConfirm={confirmOverlap}
                onCancel={() => setPendingOverlap(null)}
            />
        </>
    );
}
