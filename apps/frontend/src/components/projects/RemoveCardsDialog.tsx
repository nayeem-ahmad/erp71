'use client';

import { useEffect, useState } from 'react';
import ModalShell, { ModalFooter, ModalHeader } from '../ModalShell';
import { Button } from '@/components/ui';
import { useI18n } from '@/lib/i18n';

export type RemoveCardsMode = 'board' | 'delete';

/**
 * The confirmation behind a card's bin, and behind the selection bar's.
 *
 * "Remove" on a board has two meanings. Taking a card off this board leaves the
 * task alone. Deleting the task removes it from its project and from every
 * board it is on. The two used to share one button that did the first without
 * asking, so the reader chooses here. Taking the card off the board is picked
 * by default because it is the one that can be undone: add the task back.
 */
export default function RemoveCardsDialog({
    open,
    count,
    title,
    busy,
    onCancel,
    onConfirm,
}: {
    open: boolean;
    count: number;
    /** The card's title when there is exactly one, so the dialog can name it. */
    title?: string;
    busy: boolean;
    onCancel: () => void;
    onConfirm: (mode: RemoveCardsMode) => void;
}) {
    const { t } = useI18n();
    const m = t.projects.boards;
    const [mode, setMode] = useState<RemoveCardsMode>('board');

    // Every opening starts on the safe choice, whatever was picked last time.
    useEffect(() => {
        if (open) setMode('board');
    }, [open]);

    if (!open) return null;

    const heading = count === 1 ? m.removeTitle : m.removeTitleMany.replace('{count}', String(count));

    const options: { value: RemoveCardsMode; label: string; hint: string }[] = [
        { value: 'board', label: m.removeCard, hint: m.removeFromBoardHint },
        { value: 'delete', label: m.deleteTasks, hint: m.deleteTasksHint },
    ];

    return (
        <ModalShell size="sm" onBackdropClick={busy ? undefined : onCancel}>
            <ModalHeader
                title={heading}
                onClose={busy ? undefined : onCancel}
            />
            <div className="space-y-3 p-4">
                {count === 1 && title && (
                    <p className="line-clamp-2 text-sm font-medium text-gray-800">{title}</p>
                )}
                <div className="space-y-2">
                    {options.map((option) => (
                        <label
                            key={option.value}
                            className={`flex min-h-touch cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors ${
                                mode === option.value
                                    ? option.value === 'delete'
                                        ? 'border-red-300 bg-red-50'
                                        : 'border-blue-300 bg-blue-50'
                                    : 'border-gray-200 hover:bg-gray-50'
                            }`}
                        >
                            <input
                                type="radio"
                                name="remove-cards-mode"
                                value={option.value}
                                checked={mode === option.value}
                                onChange={() => setMode(option.value)}
                                disabled={busy}
                                className={`mt-0.5 h-4 w-4 ${
                                    option.value === 'delete' ? 'accent-red-600' : 'accent-blue-600'
                                }`}
                            />
                            <span className="space-y-0.5">
                                <span className="block text-sm font-medium text-gray-900">
                                    {option.label}
                                </span>
                                <span className="block text-xs text-gray-500">{option.hint}</span>
                            </span>
                        </label>
                    ))}
                </div>
            </div>
            <ModalFooter>
                <Button variant="ghost" onClick={onCancel} disabled={busy}>
                    {t.common.cancel}
                </Button>
                <Button
                    variant={mode === 'delete' ? 'danger' : 'primary'}
                    onClick={() => onConfirm(mode)}
                    loading={busy}
                    disabled={busy}
                >
                    {mode === 'delete' ? m.deleteTasks : m.removeCard}
                </Button>
            </ModalFooter>
        </ModalShell>
    );
}
