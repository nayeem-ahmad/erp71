'use client';

import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { labelClass } from './board-tasks';
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
    person: string;
    tags: string;
    description: string;
    startTime: string;
    endTime: string;
    duration: string;
    actions: string;
}

export interface HourLogRowHandlers {
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

const columnHelper = createColumnHelper<HourLogEntry>();

/**
 * The hour log as a flat table, for `DataTable`: one row per entry, in the
 * order the server sorted them. Column ids are the server's sort keys.
 *
 * The counterpart to the day ledger rather than a replacement for it. The
 * ledger answers "did I do a full day?"; this answers "where did these
 * particular hours go" — nothing folded, nothing grouped, every field on the
 * row it belongs to, which is the shape you want when you are checking a
 * timesheet against something else or reading it as a record.
 *
 * `handlers` is read when a row acts, not when the columns are built, so the
 * page can hand over a ref and keep the columns stable across its renders.
 */
export function hourLogColumns({
    labels,
    showPerson,
    showTags,
    handlers,
}: {
    labels: HourLogListLabels;
    /** Only worth a column when more than one person is on screen. */
    showPerson: boolean;
    /** Only once the workspace has tags to put on an entry. */
    showTags: boolean;
    handlers: { readonly current: HourLogRowHandlers };
}): ColumnDef<HourLogEntry, any>[] {
    const columns: ColumnDef<HourLogEntry, any>[] = [
        columnHelper.accessor((entry) => entry.work_date.slice(0, 10), {
            id: 'work_date',
            header: labels.date,
            cell: (info) => {
                const { date, weekday } = dateParts(dayKeyOf(info.row.original), labels.locale);
                return (
                    <>
                        <span className="block whitespace-nowrap">{date}</span>
                        <span className="block text-gray-500">{weekday}</span>
                    </>
                );
            },
            size: 120,
        }),
        columnHelper.accessor((entry) => entry.project?.code ?? '', {
            id: 'project',
            header: labels.project,
            cell: (info) => {
                const project = info.row.original.project;
                return (
                    <span className="flex min-w-0 items-center gap-1.5">
                        <span
                            className={`h-2 w-2 flex-shrink-0 rounded-full ${projectDotClass(project?.code)}`}
                            aria-hidden="true"
                        />
                        <span className="truncate">{project?.code ?? '—'}</span>
                        {project?.name ? <span className="truncate text-gray-500">{project.name}</span> : null}
                    </span>
                );
            },
            size: 180,
            meta: { hideOnMobile: true },
        }),
        columnHelper.accessor((entry) => entry.task?.title ?? '', {
            id: 'task',
            header: labels.task,
            cell: (info) => {
                const entry = info.row.original;
                return (
                    <>
                        {entry.task ? (
                            <button
                                type="button"
                                onClick={() => handlers.current.onOpenTask(entry.task!.id)}
                                className="block max-w-full truncate text-start text-blue-600 hover:underline"
                                title={entry.task.title}
                            >
                                {entry.task.title}
                            </button>
                        ) : (
                            <span className="text-gray-400">—</span>
                        )}
                        {/* The project column is one of the ones a narrow screen
                            drops, so its code rides along here rather than leaving
                            the row unable to say which project these hours belong to. */}
                        <span className="block truncate text-gray-500 md:hidden">{entry.project?.code}</span>
                    </>
                );
            },
            size: 200,
        }),
    ];

    if (showPerson) {
        columns.push(
            columnHelper.accessor((entry) => entry.user?.name || entry.user?.email || '', {
                id: 'person',
                header: labels.person,
                cell: (info) => info.getValue() || '—',
                size: 130,
                meta: { hideOnMobile: true },
            }),
        );
    }

    columns.push(
        columnHelper.accessor((entry) => entry.note ?? '', {
            id: 'note',
            header: labels.description,
            cell: (info) => (
                <InlineNote
                    entry={info.row.original}
                    labels={labels}
                    editable
                    onPatch={(entry, patch) => handlers.current.onPatch(entry, patch)}
                    className="block w-full max-w-full"
                />
            ),
            size: 240,
        }),
    );

    if (showTags) {
        columns.push(
            columnHelper.accessor((entry) => (entry.tags ?? []).map((tag) => tag.name).join(', '), {
                id: 'tags',
                header: labels.tags,
                cell: (info) => {
                    const tags = info.row.original.tags ?? [];
                    if (tags.length === 0) return <span className="text-gray-400">—</span>;
                    return (
                        <span className="flex flex-wrap gap-1">
                            {tags.map((tag) => (
                                <span key={tag.id} className={`rounded px-1.5 text-xs font-medium ${labelClass(tag.color)}`}>
                                    {tag.name}
                                </span>
                            ))}
                        </span>
                    );
                },
                enableSorting: false,
                size: 140,
                meta: { hideOnMobile: true },
            }),
        );
    }

    columns.push(
        columnHelper.accessor((entry) => entry.start_time ?? '', {
            id: 'start_time',
            header: labels.startTime,
            cell: (info) => <span className="tabular-nums">{info.getValue() || '—'}</span>,
            enableSorting: false,
            size: 90,
            meta: { hideOnMobile: true },
        }),
        columnHelper.accessor((entry) => entry.end_time ?? '', {
            id: 'end_time',
            header: labels.endTime,
            cell: (info) => {
                const entry = info.row.original;
                if (!entry.end_time) return '—';
                const endDayKey = spanEndDayKey(dayKeyOf(entry), entry.start_time, entry.end_time);
                return (
                    <>
                        <span className="tabular-nums">{entry.end_time}</span>
                        {/* Only when the sitting ran past midnight: repeating the
                            start's date on every row would bury the one case
                            where the date is the point. */}
                        {endDayKey ? (
                            <span className="ms-1 text-amber-600">{shortDate(endDayKey, labels.locale)}</span>
                        ) : null}
                    </>
                );
            },
            enableSorting: false,
            size: 100,
            meta: { hideOnMobile: true },
        }),
        columnHelper.accessor((entry) => Number(hoursOf(entry).toFixed(2)), {
            id: 'hours',
            header: labels.duration,
            cell: (info) => {
                const entry = info.row.original;
                return (
                    <InlineHours
                        entry={entry}
                        hours={hoursOf(entry)}
                        labels={labels}
                        // A timed entry's duration is its span, and the server
                        // refuses a figure that would contradict it. Offering a
                        // box the save can only reject is worse than not offering
                        // one — the times beside it are what to edit.
                        editable={!entry.started_at}
                        onPatch={(row, patch) => handlers.current.onPatch(row, patch)}
                    />
                );
            },
            size: 110,
            meta: { align: 'end' },
        }),
        columnHelper.display({
            id: 'actions',
            header: labels.actions,
            cell: (info) => (
                <div className="flex justify-center">
                    <RowActions
                        entry={info.row.original}
                        labels={labels}
                        onLogAgain={(entry) => handlers.current.onLogAgain(entry)}
                        onEdit={(entry) => handlers.current.onEdit(entry)}
                        onDelete={(entry) => handlers.current.onDelete(entry)}
                    />
                </div>
            ),
            enableSorting: false,
            enableResizing: false,
            size: 120,
        }),
    );

    return columns;
}
