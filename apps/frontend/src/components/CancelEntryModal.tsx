'use client';

import { useEffect, useRef, useState } from 'react';
import { Ban } from 'lucide-react';
import ModalShell, { ModalFooter, ModalHeader } from '@/components/ModalShell';
import { Alert, Button, Field, Textarea } from '@/components/ui';
import { useI18n, formatMessage } from '@/lib/i18n';

/**
 * Minimum note length. Mirrors `CANCELLATION_NOTE_MIN_LENGTH` in
 * `apps/backend/src/common/cancel-entry.dto.ts` — checked here so the operator
 * is told before the round trip, and there so it holds for every caller.
 */
export const CANCELLATION_NOTE_MIN_LENGTH = 5;
export const CANCELLATION_NOTE_MAX_LENGTH = 500;

export type CancelEntryModalProps = {
    /** Document number shown in the header, e.g. `INV-00042` or `PUR-00007`. */
    entryLabel: string;
    /** Formatted money for that document. Optional — a draft may have none. */
    entryAmount?: string;
    /** Resolves when the entry is cancelled; rejects with a message to show. */
    onConfirm: (note: string) => Promise<void>;
    onClose: () => void;
};

/**
 * The one dialog behind every "Cancel entry" action.
 *
 * Deliberately not `ConfirmDialog`: cancelling is not a yes/no. The note is the
 * feature — it is what a tenant reads six months later to find out why a posted
 * invoice was unwound — so the reason is collected in the same step that
 * confirms. Validation is inline per field rather than an `alert()`, per the UI
 * rules, and the error stays in the dialog on a server refusal so the typed
 * note survives.
 */
export function CancelEntryModal({
    entryLabel,
    entryAmount,
    onConfirm,
    onClose,
}: CancelEntryModalProps) {
    const { t } = useI18n();
    const copy = t.entryCancellation;

    const [note, setNote] = useState('');
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const noteRef = useRef<HTMLTextAreaElement>(null);

    // The note is the only thing to fill in, so land the caret in it.
    useEffect(() => {
        noteRef.current?.focus();
    }, []);

    const trimmed = note.trim();

    const handleConfirm = async () => {
        if (trimmed.length === 0) {
            setError(copy.noteRequired);
            noteRef.current?.focus();
            return;
        }
        if (trimmed.length < CANCELLATION_NOTE_MIN_LENGTH) {
            setError(formatMessage(copy.noteTooShort, { min: CANCELLATION_NOTE_MIN_LENGTH }));
            noteRef.current?.focus();
            return;
        }

        setError('');
        setSubmitting(true);
        try {
            await onConfirm(trimmed);
        } catch (err: any) {
            // Kept in the dialog rather than closing behind a toast: the note is
            // still typed, and the usual failure ("this sale has returns against
            // it") is something the operator can act on without retyping.
            setError(err?.message || copy.failed);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <ModalShell size="sm" onBackdropClick={submitting ? undefined : onClose}>
            <ModalHeader
                title={copy.title}
                subtitle={
                    entryAmount
                        ? formatMessage(copy.subtitle, { number: entryLabel, amount: entryAmount })
                        : entryLabel
                }
                onClose={submitting ? undefined : onClose}
                closeLabel={t.common.close}
            />

            <div className="space-y-4 overflow-y-auto p-4">
                <Alert tone="warning">{copy.warning}</Alert>

                <Field
                    label={copy.noteLabel}
                    required
                    error={error || undefined}
                    htmlFor="cancel-entry-note"
                >
                    <Textarea
                        id="cancel-entry-note"
                        ref={noteRef}
                        rows={3}
                        value={note}
                        maxLength={CANCELLATION_NOTE_MAX_LENGTH}
                        onChange={(event) => {
                            setNote(event.target.value);
                            if (error) setError('');
                        }}
                        placeholder={copy.notePlaceholder}
                        error={Boolean(error)}
                        disabled={submitting}
                    />
                </Field>
            </div>

            <ModalFooter>
                <Button variant="secondary" size="md" onClick={onClose} disabled={submitting}>
                    {copy.keep}
                </Button>
                <Button
                    variant="danger"
                    size="md"
                    icon={<Ban className="h-4 w-4" />}
                    onClick={handleConfirm}
                    loading={submitting}
                    // Not disabled on an empty note: a disabled button explains
                    // nothing, and pressing it is what surfaces the inline error.
                >
                    {submitting ? copy.cancelling : copy.confirm}
                </Button>
            </ModalFooter>
        </ModalShell>
    );
}

export default CancelEntryModal;
