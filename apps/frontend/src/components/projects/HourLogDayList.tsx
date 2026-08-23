'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, Pencil, Play, Trash2 } from 'lucide-react';
import { labelClass } from './board-tasks';
import {
    dayHeading,
    formatDuration,
    hoursOf,
    projectDotClass,
    type HourLogDay,
    type HourLogEntry,
    type HourLogRow,
} from './hour-log-day';

export interface DayListLabels {
    today: string;
    yesterday: string;
    locale?: string;
    total: string;
    addDescription: string;
    logAgain: string;
    editEntry: string;
    deleteEntry: string;
    expand: string;
    collapse: string;
    hours: string;
    note: string;
    unattributed: string;
    empty: string;
    /** `{shown} of {total}` — said only when a page shows part of a day. */
    partialDay: string;
}

/** The whole day's figures, from the server's per-day aggregate. */
export interface DayTotal {
    hours: number;
    entries: number;
}

interface Props {
    days: HourLogDay[];
    labels: DayListLabels;
    /**
     * Day totals for the *whole* filtered range, keyed by `YYYY-MM-DD`.
     *
     * Load-bearing rather than an optimisation: the rows on screen are one
     * page, so a day split across a page boundary would otherwise show a
     * header total covering only the half in view — a number that is wrong in
     * the most quietly convincing way, since nothing about it looks partial.
     * When the two disagree the header says how much of the day is showing.
     */
    dayTotals?: Record<string, DayTotal>;
    /** The person column only earns its place when more than one person is on screen. */
    showPerson?: boolean;
    loading?: boolean;
    onLogAgain: (entry: HourLogEntry) => void;
    onEdit: (entry: HourLogEntry) => void;
    onDelete: (entry: HourLogEntry) => void;
    /** An inline save. Rejecting restores what was on screen before. */
    onPatch: (entry: HourLogEntry, patch: { hours?: number; note?: string }) => Promise<void>;
    onOpenTask: (taskId: string) => void;
}

/**
 * The hour log as a day ledger rather than a table.
 *
 * A flat list of dated rows answers "what did I log" and nothing else. Grouping
 * by day with the day's total in its header answers "did I do a full day?" —
 * which is the question somebody actually opens a timesheet with, and it costs
 * one line of chrome per day to answer.
 *
 * Repeats fold: the same task logged in three sittings is one row with a count,
 * expandable. That is the ordinary shape of a worked day, and three near
 * identical rows is the ordinary way a timesheet becomes unreadable.
 */
export default function HourLogDayList({
    days,
    labels,
    dayTotals,
    showPerson = false,
    loading = false,
    onLogAgain,
    onEdit,
    onDelete,
    onPatch,
    onOpenTask,
}: Props) {
    if (loading) {
        return (
            <div className="space-y-2" aria-busy="true">
                {[0, 1, 2].map((index) => (
                    <div key={index} className="h-16 animate-pulse rounded-lg bg-gray-100" />
                ))}
            </div>
        );
    }

    if (days.length === 0) {
        return (
            <div className="rounded-lg border border-gray-100 bg-white p-8 text-center text-sm text-gray-500">
                {labels.empty}
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {days.map((day) => {
                const whole = dayTotals?.[day.key];
                const partial = Boolean(whole && whole.entries > day.entries);
                return (
                <section key={day.key} className="overflow-hidden rounded-lg border border-gray-100 bg-white">
                    <header className="flex items-center justify-between gap-3 border-b border-gray-100 bg-gray-50 px-3 py-2">
                        <h2 className="text-sm font-semibold text-gray-700">
                            {dayHeading(day.key, labels)}
                        </h2>
                        <p className="flex flex-wrap items-baseline justify-end gap-x-1.5 text-xs text-gray-500">
                            {partial ? (
                                <span>
                                    {labels.partialDay
                                        .replace('{shown}', String(day.entries))
                                        .replace('{total}', String(whole!.entries))}
                                </span>
                            ) : null}
                            <span>{labels.total}</span>
                            <span className="text-sm font-semibold tabular-nums text-gray-900">
                                {formatDuration(whole?.hours ?? day.hours)}
                            </span>
                        </p>
                    </header>

                    <ul className="divide-y divide-gray-100">
                        {day.rows.map((row) => (
                            <RowGroup
                                key={row.key}
                                row={row}
                                labels={labels}
                                showPerson={showPerson}
                                onLogAgain={onLogAgain}
                                onEdit={onEdit}
                                onDelete={onDelete}
                                onPatch={onPatch}
                                onOpenTask={onOpenTask}
                            />
                        ))}
                    </ul>
                </section>
                );
            })}
        </div>
    );
}

function RowGroup({
    row,
    labels,
    showPerson,
    onLogAgain,
    onEdit,
    onDelete,
    onPatch,
    onOpenTask,
}: {
    row: HourLogRow;
    labels: DayListLabels;
    showPerson: boolean;
} & Pick<Props, 'onLogAgain' | 'onEdit' | 'onDelete' | 'onPatch' | 'onOpenTask'>) {
    const [expanded, setExpanded] = useState(false);
    const folded = row.entries.length > 1;
    const lead = row.entries[0];

    return (
        <li>
            <EntryRow
                entry={lead}
                labels={labels}
                showPerson={showPerson}
                hours={row.hours}
                startTime={row.startTime}
                endTime={row.endTime}
                count={folded ? row.entries.length : 0}
                expanded={expanded}
                onToggle={folded ? () => setExpanded((value) => !value) : undefined}
                // A folded row's total is the sum of several entries, so there
                // is no single figure to edit in place — expanding first is the
                // only honest way to change one of them.
                editable={!folded}
                onLogAgain={onLogAgain}
                onEdit={onEdit}
                onDelete={onDelete}
                onPatch={onPatch}
                onOpenTask={onOpenTask}
            />

            {folded && expanded ? (
                <ul className="divide-y divide-gray-100 bg-gray-50/60">
                    {row.entries.map((entry) => (
                        <li key={entry.id}>
                            <EntryRow
                                entry={entry}
                                labels={labels}
                                showPerson={showPerson}
                                hours={hoursOf(entry)}
                                startTime={entry.start_time ?? null}
                                endTime={entry.end_time ?? null}
                                count={0}
                                nested
                                editable
                                onLogAgain={onLogAgain}
                                onEdit={onEdit}
                                onDelete={onDelete}
                                onPatch={onPatch}
                                onOpenTask={onOpenTask}
                            />
                        </li>
                    ))}
                </ul>
            ) : null}
        </li>
    );
}

function EntryRow({
    entry,
    labels,
    showPerson,
    hours,
    startTime,
    endTime,
    count,
    expanded,
    nested = false,
    editable,
    onToggle,
    onLogAgain,
    onEdit,
    onDelete,
    onPatch,
    onOpenTask,
}: {
    entry: HourLogEntry;
    labels: DayListLabels;
    showPerson: boolean;
    hours: number;
    startTime: string | null;
    endTime: string | null;
    count: number;
    expanded?: boolean;
    nested?: boolean;
    editable: boolean;
    onToggle?: () => void;
} & Pick<Props, 'onLogAgain' | 'onEdit' | 'onDelete' | 'onPatch' | 'onOpenTask'>) {
    const person = entry.user ? entry.user.name || entry.user.email : labels.unattributed;

    return (
        <div
            className={`flex flex-col gap-2 px-3 py-2 transition-colors hover:bg-gray-50 md:flex-row md:items-center md:gap-3 ${
                nested ? 'md:ps-10' : ''
            }`}
        >
            {count > 0 ? (
                <button
                    type="button"
                    onClick={onToggle}
                    aria-expanded={expanded}
                    aria-label={expanded ? labels.collapse : labels.expand}
                    className="flex h-6 min-w-touch items-center gap-1 self-start rounded-md bg-blue-50 px-1.5 text-xs font-semibold text-blue-700 transition-colors hover:bg-blue-100 md:min-w-0"
                >
                    {expanded ? (
                        <ChevronDown className="h-3 w-3" aria-hidden="true" />
                    ) : (
                        <ChevronRight className="h-3 w-3" aria-hidden="true" />
                    )}
                    {count}
                </button>
            ) : (
                <span className="hidden w-6 flex-shrink-0 md:block" aria-hidden="true" />
            )}

            <InlineNote
                entry={entry}
                labels={labels}
                editable={editable}
                onPatch={onPatch}
            />

            <p className="flex min-w-0 items-center gap-1.5 md:w-64">
                <span
                    className={`h-2 w-2 flex-shrink-0 rounded-full ${projectDotClass(entry.project?.code)}`}
                    aria-hidden="true"
                />
                {entry.task ? (
                    <button
                        type="button"
                        onClick={() => onOpenTask(entry.task!.id)}
                        className="truncate text-start text-sm font-medium text-blue-600 hover:underline"
                    >
                        {entry.task.title}
                    </button>
                ) : (
                    <span className="text-sm text-gray-400">—</span>
                )}
                <span className="flex-shrink-0 text-xs text-gray-400">{entry.project?.code}</span>
            </p>

            {entry.tags?.length ? (
                <ul className="flex flex-wrap items-center gap-1">
                    {entry.tags.map((tag) => (
                        <li
                            key={tag.id}
                            className={`rounded px-1.5 py-0.5 text-xs font-medium ${labelClass(tag.color)}`}
                        >
                            {tag.name}
                        </li>
                    ))}
                </ul>
            ) : null}

            {showPerson ? (
                <p className="hidden truncate text-xs text-gray-500 lg:block lg:w-32">{person}</p>
            ) : null}

            <div className="flex items-center justify-between gap-2 md:ms-auto md:justify-end">
                <span className="w-28 text-xs tabular-nums text-gray-500">
                    {startTime && endTime ? `${startTime} – ${endTime}` : ''}
                </span>

                <InlineHours
                    entry={entry}
                    hours={hours}
                    labels={labels}
                    // A timed entry's duration is its span, and the server
                    // refuses a figure that would contradict it. Offering a box
                    // the save can only reject is worse than not offering one —
                    // the times beside it are what to edit.
                    editable={editable && !entry.started_at}
                    onPatch={onPatch}
                />

                <div className="flex items-center gap-0.5">
                    <button
                        type="button"
                        onClick={() => onLogAgain(entry)}
                        aria-label={labels.logAgain}
                        title={labels.logAgain}
                        className="min-h-touch min-w-touch rounded-md p-1.5 text-gray-400 transition-colors hover:bg-blue-50 hover:text-blue-600"
                    >
                        <Play className="mx-auto h-4 w-4" aria-hidden="true" />
                    </button>
                    <button
                        type="button"
                        onClick={() => onEdit(entry)}
                        aria-label={labels.editEntry}
                        title={labels.editEntry}
                        className="min-h-touch min-w-touch rounded-md p-1.5 text-gray-400 transition-colors hover:bg-blue-50 hover:text-blue-600"
                    >
                        <Pencil className="mx-auto h-4 w-4" aria-hidden="true" />
                    </button>
                    <button
                        type="button"
                        onClick={() => onDelete(entry)}
                        aria-label={labels.deleteEntry}
                        title={labels.deleteEntry}
                        className="min-h-touch min-w-touch rounded-md p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600"
                    >
                        <Trash2 className="mx-auto h-4 w-4" aria-hidden="true" />
                    </button>
                </div>
            </div>
        </div>
    );
}

/**
 * The note, edited where it sits. An empty one reads as an invitation rather
 * than an em dash — a placeholder you can click is the difference between a
 * missing field and a dead cell.
 */
function InlineNote({
    entry,
    labels,
    editable,
    onPatch,
}: {
    entry: HourLogEntry;
    labels: DayListLabels;
    editable: boolean;
    onPatch: Props['onPatch'];
}) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(entry.note ?? '');
    const [saving, setSaving] = useState(false);

    const commit = async () => {
        const next = draft.trim();
        setEditing(false);
        if (next === (entry.note ?? '').trim()) return;
        setSaving(true);
        try {
            await onPatch(entry, { note: next });
        } catch {
            // The page has already said what went wrong; put the stored text
            // back rather than leaving an edit on screen that was not saved.
            setDraft(entry.note ?? '');
        } finally {
            setSaving(false);
        }
    };

    if (!editable || !editing) {
        return (
            <button
                type="button"
                disabled={!editable}
                onClick={() => setEditing(true)}
                className={`min-w-0 flex-1 truncate rounded px-1 py-1 text-start text-sm min-h-touch md:min-h-0 ${
                    entry.note ? 'text-gray-700' : 'text-gray-400'
                } ${editable ? 'hover:bg-gray-100' : 'cursor-default'} ${saving ? 'opacity-60' : ''}`}
                aria-label={labels.note}
            >
                {entry.note || (editable ? labels.addDescription : '—')}
            </button>
        );
    }

    return (
        <input
            autoFocus
            value={draft}
            maxLength={500}
            aria-label={labels.note}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void commit()}
            onKeyDown={(e) => {
                if (e.key === 'Enter') void commit();
                if (e.key === 'Escape') {
                    setDraft(entry.note ?? '');
                    setEditing(false);
                }
            }}
            className="min-w-0 flex-1 rounded-md border border-blue-300 bg-white px-1.5 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
        />
    );
}

/**
 * The duration, edited in place. Saved on Enter or blur rather than on change:
 * a save-on-change number box commits `1` while somebody is still typing `12`.
 */
function InlineHours({
    entry,
    hours,
    labels,
    editable,
    onPatch,
}: {
    entry: HourLogEntry;
    hours: number;
    labels: DayListLabels;
    editable: boolean;
    onPatch: Props['onPatch'];
}) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(String(hours));
    const [saving, setSaving] = useState(false);

    const commit = async () => {
        setEditing(false);
        const next = Number(draft);
        if (!Number.isFinite(next) || next <= 0 || next > 24) {
            setDraft(String(hours));
            return;
        }
        if (next === hours) return;
        setSaving(true);
        try {
            await onPatch(entry, { hours: next });
        } catch {
            setDraft(String(hours));
        } finally {
            setSaving(false);
        }
    };

    if (!editable || !editing) {
        return (
            <button
                type="button"
                disabled={!editable}
                onClick={() => {
                    setDraft(String(hours));
                    setEditing(true);
                }}
                aria-label={labels.hours}
                className={`min-h-touch rounded px-1.5 text-sm font-semibold tabular-nums text-gray-900 md:min-h-0 md:py-1 ${
                    editable ? 'hover:bg-gray-100' : 'cursor-default'
                } ${saving ? 'opacity-60' : ''}`}
            >
                {formatDuration(hours)}
            </button>
        );
    }

    return (
        <input
            autoFocus
            type="number"
            min="0.25"
            max="24"
            step="0.25"
            value={draft}
            aria-label={labels.hours}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void commit()}
            onKeyDown={(e) => {
                if (e.key === 'Enter') void commit();
                if (e.key === 'Escape') {
                    setDraft(String(hours));
                    setEditing(false);
                }
            }}
            className="w-20 rounded-md border border-blue-300 bg-white px-1.5 py-1 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500/20"
        />
    );
}
