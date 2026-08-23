'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ListPlus, Play, Square, Tag, Timer, Trash2 } from 'lucide-react';
import { Button, Input, Select } from '@/components/ui';
import { useDismissOnClickOutside } from '@/lib/click-outside';
import { formatElapsed, projectDotClass, type HourLogTag } from './hour-log-day';
import { labelClass } from './board-tasks';

export interface CaptureProject {
    id: string;
    code: string;
    name: string;
}

export interface CaptureTask {
    id: string;
    title: string;
}

export interface RunningTimer {
    id: string;
    started_at: string;
    elapsed_seconds: number;
    note?: string | null;
    tags?: HourLogTag[];
    task?: { id: string; title: string } | null;
    project?: { id: string; code: string; name: string } | null;
}

export interface CaptureLabels {
    placeholder: string;
    project: string;
    task: string;
    selectProject: string;
    selectTask: string;
    selectProjectFirst: string;
    noTasks: string;
    tags: string;
    noTags: string;
    start: string;
    stop: string;
    discard: string;
    log: string;
    hours: string;
    date: string;
    startTime: string;
    endTime: string;
    timerMode: string;
    manualMode: string;
    running: string;
}

export interface ManualLogInput {
    taskId: string;
    workDate: string;
    hours: number;
    startTime?: string;
    endTime?: string;
    note?: string;
    tagIds: string[];
}

interface Props {
    labels: CaptureLabels;
    projects: CaptureProject[];
    tasks: CaptureTask[];
    tags: HourLogTag[];
    timer: RunningTimer | null;
    /** Disabled while a start/stop/log is in flight, so a double press cannot double-write. */
    busy?: boolean;
    /** Which project's tasks `tasks` currently holds; the parent loads them. */
    projectId: string;
    onProjectChange: (projectId: string) => void;
    onStart: (input: { taskId: string; note?: string; tagIds: string[] }) => void | Promise<void>;
    onStop: () => void | Promise<void>;
    onDiscard: () => void | Promise<void>;
    onUpdateTimer: (patch: { note?: string; tagIds?: string[] }) => void | Promise<void>;
    onLogManual: (input: ManualLogInput) => void | Promise<void>;
}

/** `YYYY-MM-DD` for today, from local parts — a Dhaka evening is already tomorrow in UTC. */
function todayKey(): string {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * The permanent capture bar at the top of the hour log.
 *
 * The point of it is that logging an hour costs no navigation: it is on screen
 * before you decide to, in both the shapes people actually log time in — a
 * clock you start and forget, and a figure you type after the fact. It replaces
 * a "Log hours" button that opened a six-field modal, which is five
 * interactions for the single most repeated action in the module.
 *
 * It lives in the page header rather than floating, so it never covers a row.
 */
export default function HourLogCaptureBar({
    labels,
    projects,
    tasks,
    tags,
    timer,
    busy = false,
    projectId,
    onProjectChange,
    onStart,
    onStop,
    onDiscard,
    onUpdateTimer,
    onLogManual,
}: Props) {
    const [mode, setMode] = useState<'timer' | 'manual'>('timer');
    const [note, setNote] = useState('');
    const [taskId, setTaskId] = useState('');
    const [tagIds, setTagIds] = useState<string[]>([]);
    const [hours, setHours] = useState('');
    const [workDate, setWorkDate] = useState(todayKey);
    const [startTime, setStartTime] = useState('');
    const [endTime, setEndTime] = useState('');
    const [tagsOpen, setTagsOpen] = useState(false);
    const tagBoxRef = useRef<HTMLDivElement>(null);

    const running = Boolean(timer);

    // Resynced from the server on every refetch rather than counted from a
    // parsed timestamp against the device clock: a phone running two minutes
    // fast should still show the elapsed time that will actually be recorded.
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

    // The running timer's own note and tags are what the bar shows while it
    // runs, so a reload mid-afternoon does not present an empty box over a
    // clock that has a description.
    useEffect(() => {
        if (!timer) return;
        setNote(timer.note ?? '');
        setTagIds((timer.tags ?? []).map((tag) => tag.id));
        // Only when a *different* timer appears. Depending on `timer` itself
        // would overwrite a half-typed description every time the page refetched
        // the running clock.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [timer?.id]);

    useDismissOnClickOutside(
        tagsOpen,
        useCallback((target: Node) => Boolean(tagBoxRef.current?.contains(target)), []),
        useCallback(() => setTagsOpen(false), []),
    );

    const selectedTags = tags.filter((tag) => tagIds.includes(tag.id));

    const toggleTag = (id: string) => {
        const next = tagIds.includes(id) ? tagIds.filter((value) => value !== id) : [...tagIds, id];
        setTagIds(next);
        if (running) void onUpdateTimer({ tagIds: next });
    };

    const clearDraft = () => {
        setNote('');
        setTaskId('');
        setTagIds([]);
        setHours('');
        setStartTime('');
        setEndTime('');
    };

    const start = async () => {
        if (!taskId) return;
        await onStart({ taskId, note: note.trim() || undefined, tagIds });
        setHours('');
    };

    const log = async () => {
        const parsed = Number(hours);
        const timed = Boolean(startTime && endTime);
        // With a span the server derives the hours, so the box may stay empty;
        // without one it is the entry and has to be a real number.
        if (!taskId || (!timed && !(parsed > 0))) return;
        await onLogManual({
            taskId,
            workDate,
            hours: timed ? (parsed > 0 ? parsed : 0.01) : parsed,
            startTime: timed ? startTime : undefined,
            endTime: timed ? endTime : undefined,
            note: note.trim() || undefined,
            tagIds,
        });
        clearDraft();
    };

    const canLog = Boolean(taskId) && (Boolean(startTime && endTime) || Number(hours) > 0);

    return (
        <div className="rounded-lg border border-gray-100 bg-white p-3 md:p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                <Input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    onBlur={() => {
                        if (running && note.trim() !== (timer?.note ?? '')) {
                            void onUpdateTimer({ note: note.trim() });
                        }
                    }}
                    placeholder={labels.placeholder}
                    maxLength={500}
                    className="lg:flex-1"
                    aria-label={labels.placeholder}
                />

                {running ? (
                    <p className="flex min-w-0 items-center gap-2 text-sm text-gray-700 lg:w-64">
                        <span
                            className={`h-2 w-2 flex-shrink-0 rounded-full ${projectDotClass(timer?.project?.code)}`}
                            aria-hidden="true"
                        />
                        <span className="truncate font-medium">{timer?.task?.title}</span>
                        <span className="flex-shrink-0 text-xs text-gray-400">
                            {timer?.project?.code}
                        </span>
                    </p>
                ) : (
                    <div className="flex flex-col gap-2 sm:flex-row lg:w-[26rem]">
                        <Select
                            value={projectId}
                            onChange={(e) => {
                                onProjectChange(e.target.value);
                                setTaskId('');
                            }}
                            aria-label={labels.project}
                            className="sm:flex-1"
                        >
                            <option value="">{labels.selectProject}</option>
                            {projects.map((project) => (
                                <option key={project.id} value={project.id}>
                                    {project.code} · {project.name}
                                </option>
                            ))}
                        </Select>
                        <Select
                            value={taskId}
                            onChange={(e) => setTaskId(e.target.value)}
                            disabled={!projectId || tasks.length === 0}
                            aria-label={labels.task}
                            className="sm:flex-1"
                        >
                            <option value="">
                                {!projectId
                                    ? labels.selectProjectFirst
                                    : tasks.length === 0
                                      ? labels.noTasks
                                      : labels.selectTask}
                            </option>
                            {tasks.map((task) => (
                                <option key={task.id} value={task.id}>
                                    {task.title}
                                </option>
                            ))}
                        </Select>
                    </div>
                )}

                <div className="relative" ref={tagBoxRef}>
                    <button
                        type="button"
                        onClick={() => setTagsOpen((open) => !open)}
                        aria-label={labels.tags}
                        title={labels.tags}
                        aria-expanded={tagsOpen}
                        className="flex min-h-touch min-w-touch items-center gap-1.5 rounded-md px-2 text-gray-500 transition-colors hover:bg-gray-100"
                    >
                        <Tag className="h-4 w-4" aria-hidden="true" />
                        {selectedTags.length > 0 ? (
                            <span className="text-xs font-medium text-gray-700">
                                {selectedTags.length}
                            </span>
                        ) : null}
                    </button>
                    {tagsOpen ? (
                        <div className="absolute end-0 z-20 mt-1 max-h-64 w-56 overflow-y-auto rounded-lg border border-gray-200 bg-white p-2 shadow-lg">
                            {tags.length === 0 ? (
                                <p className="px-1 py-2 text-xs text-gray-500">{labels.noTags}</p>
                            ) : (
                                tags.map((tag) => (
                                    <label
                                        key={tag.id}
                                        className="flex min-h-touch cursor-pointer items-center gap-2 rounded-md px-1.5 hover:bg-gray-50"
                                    >
                                        <input
                                            type="checkbox"
                                            checked={tagIds.includes(tag.id)}
                                            onChange={() => toggleTag(tag.id)}
                                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                        />
                                        <span
                                            className={`rounded px-1.5 py-0.5 text-xs font-medium ${labelClass(tag.color)}`}
                                        >
                                            {tag.name}
                                        </span>
                                    </label>
                                ))
                            )}
                        </div>
                    ) : null}
                </div>

                {mode === 'manual' && !running ? (
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <Input
                            type="date"
                            value={workDate}
                            onChange={(e) => setWorkDate(e.target.value)}
                            aria-label={labels.date}
                            className="sm:w-36"
                        />
                        <div className="flex items-center gap-1">
                            <Input
                                type="time"
                                value={startTime}
                                onChange={(e) => setStartTime(e.target.value)}
                                aria-label={labels.startTime}
                                className="w-28"
                            />
                            <span className="text-gray-400" aria-hidden="true">
                                –
                            </span>
                            <Input
                                type="time"
                                value={endTime}
                                onChange={(e) => setEndTime(e.target.value)}
                                aria-label={labels.endTime}
                                className="w-28"
                            />
                        </div>
                        <Input
                            type="number"
                            min="0.25"
                            max="24"
                            step="0.25"
                            value={hours}
                            onChange={(e) => setHours(e.target.value)}
                            placeholder={labels.hours}
                            aria-label={labels.hours}
                            className="sm:w-24"
                        />
                    </div>
                ) : null}

                <div className="flex items-center justify-between gap-2 lg:justify-end">
                    <span
                        className={`text-lg font-semibold tabular-nums ${running ? 'text-blue-600' : 'text-gray-400'}`}
                        aria-label={running ? labels.running : undefined}
                        role={running ? 'timer' : undefined}
                    >
                        {running ? formatElapsed(elapsed) : '0:00'}
                    </span>

                    {running ? (
                        <>
                            <Button
                                variant="danger"
                                size="md"
                                loading={busy}
                                icon={<Square className="h-4 w-4" />}
                                onClick={() => void onStop()}
                            >
                                {labels.stop}
                            </Button>
                            <button
                                type="button"
                                onClick={() => void onDiscard()}
                                aria-label={labels.discard}
                                title={labels.discard}
                                className="min-h-touch min-w-touch rounded-md p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600"
                            >
                                <Trash2 className="mx-auto h-4 w-4" aria-hidden="true" />
                            </button>
                        </>
                    ) : mode === 'timer' ? (
                        <Button
                            size="md"
                            loading={busy}
                            disabled={!taskId}
                            icon={<Play className="h-4 w-4" />}
                            onClick={() => void start()}
                        >
                            {labels.start}
                        </Button>
                    ) : (
                        <Button
                            size="md"
                            loading={busy}
                            disabled={!canLog}
                            icon={<ListPlus className="h-4 w-4" />}
                            onClick={() => void log()}
                        >
                            {labels.log}
                        </Button>
                    )}

                    {/* Labelled, unlike the icon cluster this borrows from: an
                        unnamed pair of glyphs is the least discoverable control
                        on a screen. */}
                    {!running ? (
                        <div className="flex flex-shrink-0 items-center rounded-md border border-gray-200">
                            <ModeButton
                                active={mode === 'timer'}
                                label={labels.timerMode}
                                onClick={() => setMode('timer')}
                            >
                                <Timer className="h-4 w-4" aria-hidden="true" />
                            </ModeButton>
                            <ModeButton
                                active={mode === 'manual'}
                                label={labels.manualMode}
                                onClick={() => setMode('manual')}
                            >
                                <ListPlus className="h-4 w-4" aria-hidden="true" />
                            </ModeButton>
                        </div>
                    ) : null}
                </div>
            </div>
        </div>
    );
}

function ModeButton({
    active,
    label,
    onClick,
    children,
}: {
    active: boolean;
    label: string;
    onClick: () => void;
    children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label={label}
            title={label}
            aria-pressed={active}
            className={`flex min-h-touch min-w-touch items-center justify-center px-2 transition-colors first:rounded-s-md last:rounded-e-md ${
                active ? 'bg-blue-50 text-blue-600' : 'text-gray-400 hover:bg-gray-50'
            }`}
        >
            {children}
        </button>
    );
}
