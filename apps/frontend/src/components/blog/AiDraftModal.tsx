'use client';

import { Sparkles } from 'lucide-react';
import ModalShell from '@/components/ModalShell';
import { Button, Field, Textarea } from '@/components/ui';

type AiDraftModalProps = {
    open: boolean;
    prompt: string;
    loading: boolean;
    labels: {
        modalTitle: string;
        promptLabel: string;
        promptPlaceholder: string;
        generate: string;
        cancel: string;
    };
    onPromptChange: (value: string) => void;
    onClose: () => void;
    onGenerate: () => void;
};

/**
 * Collects the one-line brief behind the editors' AI Assistant button.
 *
 * Deliberately knows nothing about posts: the prompt lives in the parent's
 * state and the parent makes its own call, which is what lets the platform
 * editor and the tenant editor — different endpoints, different field sets —
 * share one modal. It also means the prompt survives a locale-tab switch, so
 * re-running for Bangla is one click rather than retyping.
 */
export default function AiDraftModal({
    open,
    prompt,
    loading,
    labels,
    onPromptChange,
    onClose,
    onGenerate,
}: AiDraftModalProps) {
    if (!open) return null;

    const canGenerate = prompt.trim().length > 0 && !loading;

    return (
        <ModalShell size="md" onBackdropClick={loading ? undefined : onClose}>
            <div className="flex items-center gap-2 border-b border-gray-100 p-3 md:p-4">
                <Sparkles className="h-4 w-4 text-blue-600" />
                <h2 className="text-sm font-semibold text-gray-900">{labels.modalTitle}</h2>
            </div>

            <div className="flex-1 overflow-y-auto p-3 md:p-4">
                <Field label={labels.promptLabel}>
                    <Textarea
                        rows={4}
                        autoFocus
                        disabled={loading}
                        value={prompt}
                        placeholder={labels.promptPlaceholder}
                        onChange={(event) => onPromptChange(event.target.value)}
                    />
                </Field>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-gray-100 p-3 md:p-4">
                <Button variant="ghost" onClick={onClose} disabled={loading}>
                    {labels.cancel}
                </Button>
                <Button onClick={onGenerate} disabled={!canGenerate} loading={loading}>
                    {labels.generate}
                </Button>
            </div>
        </ModalShell>
    );
}
