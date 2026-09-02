'use client';

import { useState } from 'react';
import { Pencil, Play, Trash2 } from 'lucide-react';
import { formatDuration, type HourLogEntry } from './hour-log-day';

/**
 * The cells both hour-log views share: the two fields you can correct without
 * opening the edit dialog, and the actions at the end of a row.
 *
 * They live here rather than beside either list because the day ledger and the
 * flat list render the same ones, and an inline editor that saves on blur in
 * one view and on change in the other is the kind of difference nobody notices
 * until it loses somebody's typing.
 */
export interface InlineFieldLabels {
    /** The accessible name of the description cell. */
    note: string;
    /** What an empty description invites you to do. */
    addDescription: string;
    /** The accessible name of the duration cell. */
    hours: string;
}

/** An inline save. Rejecting restores what was on screen before. */
export type InlinePatch = (
    entry: HourLogEntry,
    patch: { hours?: number; note?: string },
) => Promise<void>;

/**
 * The note, edited where it sits. An empty one reads as an invitation rather
 * than an em dash — a placeholder you can click is the difference between a
 * missing field and a dead cell.
 */
export function InlineNote({
    entry,
    labels,
    editable,
    onPatch,
    className = 'min-w-0 flex-1',
}: {
    entry: HourLogEntry;
    labels: InlineFieldLabels;
    editable: boolean;
    onPatch: InlinePatch;
    /** Sizing, which differs between a flex row and a table cell. */
    className?: string;
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
                className={`truncate rounded px-1 py-1 text-start text-sm min-h-touch md:min-h-0 ${className} ${
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
            className={`rounded-md border border-blue-300 bg-white px-1.5 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 ${className}`}
        />
    );
}

/**
 * The duration, edited in place. Saved on Enter or blur rather than on change:
 * a save-on-change number box commits `1` while somebody is still typing `12`.
 */
export function InlineHours({
    entry,
    hours,
    labels,
    editable,
    onPatch,
}: {
    entry: HourLogEntry;
    hours: number;
    labels: InlineFieldLabels;
    editable: boolean;
    onPatch: InlinePatch;
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

export interface RowActionLabels {
    logAgain: string;
    editEntry: string;
    deleteEntry: string;
}

/**
 * Restart, edit, delete — the same three, in the same order, in both views.
 * Icon-only with a name on each, because three words per row is most of a
 * column and the icons are the ones this app uses everywhere else.
 */
export function RowActions({
    entry,
    labels,
    onLogAgain,
    onEdit,
    onDelete,
}: {
    entry: HourLogEntry;
    labels: RowActionLabels;
    onLogAgain: (entry: HourLogEntry) => void;
    onEdit: (entry: HourLogEntry) => void;
    onDelete: (entry: HourLogEntry) => void;
}) {
    return (
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
    );
}
