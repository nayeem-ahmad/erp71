'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import ModalShell, { ModalFooter, ModalHeader } from '../ModalShell';
import { Button } from './compact';
import { Input } from './Input';

export interface ConfirmDialogProps {
    open: boolean;
    /** Modal header title. */
    title: string;
    /** Body copy. The last blank-line-separated paragraph is emphasised. */
    prompt: string;
    /**
     * When set, requires the user to type this string to enable the confirm
     * button (type-to-confirm). When omitted, it's a plain confirm dialog.
     */
    expected?: string;
    /** Placeholder for the type-to-confirm input; `{value}` → expected. */
    typePromptTemplate?: string;
    confirmLabel: string;
    cancelLabel: string;
    /** Confirm button label while the action is running. */
    workingLabel?: string;
    loading?: boolean;
    danger?: boolean;
    onConfirm: () => void;
    onCancel: () => void;
}

/**
 * Shared confirmation dialog. Supports both a plain confirm (no `expected`) and
 * type-to-confirm (pass `expected`). All labels are provided by the caller so the
 * component carries no hardcoded copy — it stays i18n-neutral.
 */
export function ConfirmDialog({
    open,
    title,
    prompt,
    expected,
    typePromptTemplate,
    confirmLabel,
    cancelLabel,
    workingLabel,
    loading = false,
    danger,
    onConfirm,
    onCancel,
}: ConfirmDialogProps) {
    const [value, setValue] = useState('');

    useEffect(() => {
        if (open) setValue('');
    }, [open]);

    if (!open) return null;

    const paragraphs = prompt.split('\n\n');
    const body = paragraphs.slice(0, -1).join('\n\n');
    const emphasis = paragraphs[paragraphs.length - 1];

    const close = () => { setValue(''); onCancel(); };
    const requiresInput = expected !== undefined;
    const confirmDisabled = loading || (requiresInput && value.trim().toLowerCase() !== expected);

    return (
        <ModalShell size="sm" onBackdropClick={close}>
            <ModalHeader title={title} onClose={close} />
            <div className="p-6 space-y-4">
                <div className="flex items-start gap-3">
                    <div className={`mt-0.5 p-2 rounded-md ${danger ? 'bg-red-100' : 'bg-amber-100'}`}>
                        <AlertTriangle className={`w-5 h-5 ${danger ? 'text-red-600' : 'text-amber-600'}`} />
                    </div>
                    <div className="space-y-2 flex-1">
                        {body && <p className="text-sm text-gray-700 whitespace-pre-line">{body}</p>}
                        <p className="text-sm font-semibold text-gray-800">{emphasis}</p>
                        {requiresInput && (
                            <Input
                                type="text"
                                value={value}
                                onChange={(e) => setValue(e.target.value)}
                                placeholder={(typePromptTemplate ?? 'Type "{value}"').replace('{value}', expected ?? '')}
                                className="font-mono"
                                autoFocus
                            />
                        )}
                    </div>
                </div>
            </div>
            <ModalFooter>
                <Button variant="ghost" onClick={close} disabled={loading}>
                    {cancelLabel}
                </Button>
                <Button
                    variant={danger ? 'danger' : 'primary'}
                    onClick={onConfirm}
                    disabled={confirmDisabled}
                    loading={loading}
                    className={!danger ? '!bg-amber-600 hover:!bg-amber-700' : undefined}
                >
                    {loading && workingLabel ? workingLabel : confirmLabel}
                </Button>
            </ModalFooter>
        </ModalShell>
    );
}

export default ConfirmDialog;
