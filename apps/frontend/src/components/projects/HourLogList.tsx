'use client';

import {
    InlineHours,
    InlineNote,
    RowActions,
    type InlineFieldLabels,
    type InlinePatch,
    type RowActionLabels,
} from './HourLogRowCells';
import {
    dayKeyOf,
    hoursOf,
    projectDotClass,
    spanEndDayKey,
    type HourLogEntry,
} from './hour-log-day';

export interface HourLogListLabels extends InlineFieldLabels, RowActionLabels {
    locale?: string;
    /** Column headings. */
    date: string;
    project: string;
    task: string;
    description: string;
    startTime: string;
    endTime: string;
    duration: string;
    actions: string;
    empty: string;
}

interface Props {
    entries: HourLogEntry[];
    labels: HourLogListLabels;
    loading?: boolean;
    onLogAgain: (entry: HourLogEntry) => void;
    onEdit: (entry: HourLogEntry) => void;
    onDelete: (entry: HourLogEntry) => void;
    onPatch: InlinePatch;
    onOpenTask: (taskId: string) => void;
}

/**
 * `3 Aug 2026` and `Mon`, from a `YYYY-MM-DD`.
 *
 * Parsed and formatted in UTC, like every other reading of a day key on these
 * screens: the key is a calendar day rather than an instant, and letting it
 * round-trip through the viewer's zone is how a Dhaka evening ends up labelled
 * with the previous date.
 */
function dateParts(key: string, locale?: string): { date: string; weekday: string } {
    const day = new Date(`${key}T00:00:00.000Z`);
    if (Number.isNaN(day.getTime())) return { date: key, weekday: '' };
    return {
        date: day.toLocaleDateString(locale, {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            timeZone: 'UTC',
        }),
        weekday: day.toLocaleDateString(locale, { weekday: 'short', timeZone: 'UTC' }),
    };
}

/** `3 Aug` — the end date, said only when it differs from the start's. */
function shortDate(key: string, locale?: string): string {
    const day = new Date(`${key}T00:00:00.000Z`);
    if (Number.isNaN(day.getTime())) return key;
    return day.toLocaleDateString(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/**
 * The hour log as a flat table: one row per entry, in the order the server
 * sorted them.
 *
 * The counterpart to the day ledger rather than a replacement for it. The
 * ledger answers "did I do a full day?"; this answers "where did these
 * particular hours go" — nothing folded, nothing grouped, every field on the
 * row it belongs to, which is the shape you want when you are checking a
 * timesheet against something else or reading it as a record.
 */
export default function HourLogList({
    entries,
    labels,
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
                    <div key={index} className="h-12 animate-pulse rounded-lg bg-gray-100" />
                ))}
            </div>
        );
    }

    if (entries.length === 0) {
        return (
            <div className="rounded-lg border border-gray-100 bg-white p-8 text-center text-sm text-gray-500">
                {labels.empty}
            </div>
        );
    }

    return (
        <div className="overflow-x-auto rounded-lg border border-gray-100 bg-white">
            <table className="w-full text-sm">
                <thead>
                    <tr className="border-b border-gray-100 bg-gray-50 text-start text-xs text-gray-500">
                        <th className="px-3 py-2 text-start font-medium">{labels.date}</th>
                        <th className="hidden px-3 py-2 text-start font-medium md:table-cell">
                            {labels.project}
                        </th>
                        <th className="px-3 py-2 text-start font-medium">{labels.task}</th>
                        <th className="px-3 py-2 text-start font-medium">{labels.description}</th>
                        <th className="hidden px-3 py-2 text-start font-medium md:table-cell">
                            {labels.startTime}
                        </th>
                        <th className="hidden px-3 py-2 text-start font-medium md:table-cell">
                            {labels.endTime}
                        </th>
                        <th className="px-3 py-2 text-end font-medium">{labels.duration}</th>
                        <th className="px-3 py-2 text-end font-medium">{labels.actions}</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                    {entries.map((entry) => (
                        <Row
                            key={entry.id}
                            entry={entry}
                            labels={labels}
                            onLogAgain={onLogAgain}
                            onEdit={onEdit}
                            onDelete={onDelete}
                            onPatch={onPatch}
                            onOpenTask={onOpenTask}
                        />
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function Row({
    entry,
    labels,
    onLogAgain,
    onEdit,
    onDelete,
    onPatch,
    onOpenTask,
}: {
    entry: HourLogEntry;
    labels: HourLogListLabels;
} & Pick<Props, 'onLogAgain' | 'onEdit' | 'onDelete' | 'onPatch' | 'onOpenTask'>) {
    const dayKey = dayKeyOf(entry);
    const { date, weekday } = dateParts(dayKey, labels.locale);
    const endDayKey = spanEndDayKey(dayKey, entry.start_time, entry.end_time);

    return (
        <tr className="transition-colors hover:bg-gray-50">
            <td className="whitespace-nowrap px-3 py-2 align-middle">
                <span className="block text-gray-900">{date}</span>
                <span className="block text-xs text-gray-500">{weekday}</span>
            </td>

            <td className="hidden max-w-[14rem] px-3 py-2 align-middle md:table-cell">
                <span className="flex min-w-0 items-center gap-1.5">
                    <span
                        className={`h-2 w-2 flex-shrink-0 rounded-full ${projectDotClass(entry.project?.code)}`}
                        aria-hidden="true"
                    />
                    <span className="truncate text-gray-900">{entry.project?.code ?? '—'}</span>
                    {entry.project?.name ? (
                        <span className="truncate text-xs text-gray-500">{entry.project.name}</span>
                    ) : null}
                </span>
            </td>

            <td className="max-w-[16rem] px-3 py-2 align-middle">
                {entry.task ? (
                    <button
                        type="button"
                        onClick={() => onOpenTask(entry.task!.id)}
                        className="block max-w-full truncate text-start font-medium text-blue-600 hover:underline"
                        title={entry.task.title}
                    >
                        {entry.task.title}
                    </button>
                ) : (
                    <span className="text-gray-400">—</span>
                )}
                {/* The project column is one of the ones a narrow screen drops,
                    so its code rides along here rather than leaving the row
                    unable to say which project these hours belong to. */}
                <span className="block truncate text-xs text-gray-500 md:hidden">
                    {entry.project?.code}
                </span>
            </td>

            <td className="max-w-[20rem] px-3 py-2 align-middle">
                <InlineNote
                    entry={entry}
                    labels={labels}
                    editable
                    onPatch={onPatch}
                    className="block w-full max-w-full"
                />
            </td>

            <td className="hidden whitespace-nowrap px-3 py-2 align-middle tabular-nums text-gray-600 md:table-cell">
                {entry.start_time ?? '—'}
            </td>

            <td className="hidden whitespace-nowrap px-3 py-2 align-middle text-gray-600 md:table-cell">
                {entry.end_time ? (
                    <>
                        <span className="tabular-nums">{entry.end_time}</span>
                        {/* Only when the sitting ran past midnight: repeating the
                            start's date on every row would bury the one case
                            where the date is the point. */}
                        {endDayKey ? (
                            <span className="ms-1 text-xs text-amber-600">
                                {shortDate(endDayKey, labels.locale)}
                            </span>
                        ) : null}
                    </>
                ) : (
                    '—'
                )}
            </td>

            <td className="whitespace-nowrap px-3 py-2 text-end align-middle">
                <InlineHours
                    entry={entry}
                    hours={hoursOf(entry)}
                    labels={labels}
                    // A timed entry's duration is its span, and the server
                    // refuses a figure that would contradict it. Offering a box
                    // the save can only reject is worse than not offering one —
                    // the times beside it are what to edit.
                    editable={!entry.started_at}
                    onPatch={onPatch}
                />
            </td>

            <td className="px-3 py-2 align-middle">
                <div className="flex justify-end">
                    <RowActions
                        entry={entry}
                        labels={labels}
                        onLogAgain={onLogAgain}
                        onEdit={onEdit}
                        onDelete={onDelete}
                    />
                </div>
            </td>
        </tr>
    );
}
