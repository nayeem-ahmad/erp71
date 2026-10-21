'use client';

import { X } from 'lucide-react';
import { formatMessage, useI18n } from '@/lib/i18n';

export interface BulkAction<T> {
    label: string;
    onClick: (selectedRows: T[]) => void;
    tone?: 'default' | 'danger';
    icon?: React.ReactNode;
}

export interface BulkActionBarProps<T> {
    /** Number of currently selected rows */
    count: number;
    /** The selected row data, passed through to each action's onClick */
    selectedRows: T[];
    /** Action buttons rendered before the clear-selection button */
    actions: BulkAction<T>[];
    /** Called when the clear-selection button is clicked */
    onClear: () => void;
    /** Disables all action buttons and the clear button (e.g. while a bulk action is in flight) */
    disabled?: boolean;
    /** Extra custom content rendered between the count and the action buttons (e.g. bulk status/assign selects) */
    extra?: React.ReactNode;
}

export default function BulkActionBar<T>({
    count,
    selectedRows,
    actions,
    onClear,
    disabled = false,
    extra,
}: BulkActionBarProps<T>) {
    const { t } = useI18n();
    if (count === 0) return null;

    // On a phone the count and the clear button share the first line and the
    // actions wrap underneath; on a desktop it is all one line, clear last.
    return (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary-border bg-primary-light px-3 py-2 text-sm">
            <span className="font-semibold text-gray-700">{formatMessage(t.common.dataTable.selectedCount, { count })}</span>
            <button
                type="button"
                disabled={disabled}
                onClick={onClear}
                aria-label={t.common.dataTable.clearSelection}
                title={t.common.dataTable.clearSelection}
                className="ms-auto inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-gray-600 hover:bg-white disabled:opacity-50 max-md:min-h-touch max-md:min-w-touch md:order-last md:ms-0"
            >
                <X className="w-4 h-4" />
            </button>
            <div className="basis-full md:hidden" aria-hidden />
            {extra}
            <div className="hidden flex-1 md:block" />
            {actions.map((action) => (
                <button
                    key={action.label}
                    type="button"
                    disabled={disabled}
                    onClick={() => action.onClick(selectedRows)}
                    className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold transition-colors disabled:opacity-50 ${
                        action.tone === 'danger'
                            ? 'bg-danger text-white hover:bg-red-700'
                            : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                    }`}
                >
                    {action.icon}
                    {action.label}
                </button>
            ))}
        </div>
    );
}
