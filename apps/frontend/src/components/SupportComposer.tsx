'use client';

import { useMemo, useRef, useState } from 'react';
import { Mic, Paperclip, Square } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n, formatMessage } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { Button, Field, Input, Textarea } from '@/components/ui';
import {
    MAX_SUPPORT_ATTACHMENTS,
    PendingAttachmentList,
    SUPPORT_ATTACHMENT_ACCEPT,
    checkSupportFile,
} from '@/components/SupportAttachments';
import { formatRecordingTime, useVoiceRecorder } from '@/hooks/useVoiceRecorder';

export type KnockCategory = 'support' | 'bug' | 'feature' | 'general';

/** The thread a submission opened, as its ticket. */
export type CreatedKnock = { id: string; ticketNumber: number };

export function availableKnockCategories(
    supportEnabled: boolean,
    feedbackEnabled: boolean,
): KnockCategory[] {
    const categories: KnockCategory[] = [];
    if (supportEnabled) categories.push('support');
    if (feedbackEnabled) categories.push('bug', 'feature', 'general');
    return categories;
}

export function defaultKnockCategory(
    supportEnabled: boolean,
    feedbackEnabled: boolean,
): KnockCategory {
    return supportEnabled ? 'support' : 'general';
}

export default function SupportComposer({
    supportEnabled,
    feedbackEnabled,
    capturePage,
    onCreated,
    onCancel,
}: {
    supportEnabled: boolean;
    feedbackEnabled: boolean;
    capturePage?: boolean;
    onCreated: (created: CreatedKnock) => void;
    onCancel: () => void;
}) {
    const { t } = useI18n();
    const m = t.components.feedbackWidget;
    const categories = useMemo(
        () => availableKnockCategories(supportEnabled, feedbackEnabled),
        [supportEnabled, feedbackEnabled],
    );
    const [category, setCategory] = useState<KnockCategory>(
        () => defaultKnockCategory(supportEnabled, feedbackEnabled),
    );
    const [subject, setSubject] = useState('');
    const [body, setBody] = useState('');
    const [attachments, setAttachments] = useState<File[]>([]);
    const [attachmentError, setAttachmentError] = useState('');
    const [status, setStatus] = useState<'idle' | 'submitting' | 'error'>('idle');
    const [errorMsg, setErrorMsg] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);
    const a = m.attachments;

    /** Adds what fits and says, inline, why the rest did not. */
    function addFiles(incoming: File[]) {
        setAttachmentError('');
        const accepted: File[] = [];
        let problem = '';
        for (const file of incoming) {
            const issue = checkSupportFile(file);
            if (issue === 'type') problem = a.unsupported;
            else if (issue === 'size') problem = formatMessage(a.tooLarge, { name: file.name });
            else accepted.push(file);
        }
        const room = Math.max(0, MAX_SUPPORT_ATTACHMENTS - attachments.length);
        if (accepted.length > room) problem = formatMessage(a.tooMany, { max: MAX_SUPPORT_ATTACHMENTS });
        if (accepted.length && room) setAttachments([...attachments, ...accepted.slice(0, room)]);
        if (problem) setAttachmentError(problem);
    }

    const recorder = useVoiceRecorder({ onRecorded: (file) => addFiles([file]) });
    const recorderError =
        recorder.error === 'denied' ? a.micDenied
        : recorder.error === 'unsupported' ? a.micUnsupported
        : recorder.error === 'failed' ? a.micFailed
        : '';
    const full = attachments.length >= MAX_SUPPORT_ATTACHMENTS;

    const activeCategory = categories.includes(category) ? category : categories[0];
    const placeholder = activeCategory === 'support' ? m.placeholderSupport : m.placeholderFeedback;
    // A voice note or a screenshot can stand in for the written message.
    const canSubmit =
        (body.trim().length >= 3 || attachments.length > 0)
        && !recorder.recording
        && status !== 'submitting';

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!activeCategory || !canSubmit) return;
        setStatus('submitting');
        setErrorMsg('');
        try {
            const res = await api.createSupportThread({
                category: activeCategory,
                subject: subject.trim() || undefined,
                body: body.trim(),
                page: capturePage && typeof window !== 'undefined' ? window.location.pathname : undefined,
                attachments: attachments.length ? attachments : undefined,
            }) as CreatedKnock;
            // The number is the one thing worth carrying away from this form,
            // and one of the two places it is submitted from navigates away
            // immediately — so it is said here rather than in either caller.
            if (res.ticketNumber) {
                toast.success(formatMessage(m.createdToast, { number: res.ticketNumber }));
            }
            onCreated(res);
        } catch (err: any) {
            setStatus('error');
            setErrorMsg(err?.message || m.defaultError);
        }
    }

    if (categories.length === 0) return null;

    return (
        <form onSubmit={handleSubmit} className="space-y-3">
            {categories.length > 1 && (
                <div className="flex flex-wrap gap-2">
                    {categories.map((opt) => (
                        <button
                            key={opt}
                            type="button"
                            onClick={() => setCategory(opt)}
                            className={`min-h-touch px-3 py-1.5 rounded-md text-xs font-semibold border transition-colors ${
                                activeCategory === opt
                                    ? 'bg-blue-50 border-blue-400 text-blue-700'
                                    : 'bg-gray-50 border-gray-200 text-gray-500 hover:border-gray-300'
                            }`}
                        >
                            {m.types[opt]}
                        </button>
                    ))}
                </div>
            )}

            <Field label={m.subjectLabel}>
                <Input
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder={m.subjectPlaceholder}
                />
            </Field>

            <Field label={t.admin.support.messageLabel}>
                <Textarea
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder={placeholder}
                    rows={4}
                    className="resize-none"
                    autoFocus
                />
            </Field>

            <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                    <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={full || status === 'submitting'}
                        icon={<Paperclip className="h-4 w-4" aria-hidden />}
                    >
                        {a.attach}
                    </Button>
                    <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        className="sr-only"
                        tabIndex={-1}
                        aria-label={a.attach}
                        accept={SUPPORT_ATTACHMENT_ACCEPT}
                        onChange={(e) => {
                            addFiles(Array.from(e.target.files ?? []));
                            // Cleared, or picking the same file again fires nothing.
                            e.target.value = '';
                        }}
                    />
                    {recorder.recording ? (
                        <Button
                            type="button"
                            variant="danger"
                            size="sm"
                            onClick={recorder.stop}
                            icon={<Square className="h-3.5 w-3.5" aria-hidden />}
                        >
                            {a.stopRecording}
                        </Button>
                    ) : (
                        recorder.supported && (
                            <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                onClick={() => {
                                    setAttachmentError('');
                                    void recorder.start();
                                }}
                                disabled={full || status === 'submitting'}
                                icon={<Mic className="h-4 w-4" aria-hidden />}
                            >
                                {a.record}
                            </Button>
                        )
                    )}
                    {recorder.recording ? (
                        <span className="flex items-center gap-1.5 text-xs font-medium text-red-600" role="status">
                            <span className="h-2 w-2 animate-pulse rounded-full bg-red-600" aria-hidden />
                            {formatMessage(a.recording, { time: formatRecordingTime(recorder.elapsedMs) })}
                        </span>
                    ) : (
                        <span className="text-xs text-gray-400">{a.hint}</span>
                    )}
                </div>
                {(attachmentError || recorderError) && (
                    <p role="alert" className="text-xs text-danger">{attachmentError || recorderError}</p>
                )}
                <PendingAttachmentList
                    files={attachments}
                    disabled={status === 'submitting'}
                    onRemove={(index) => {
                        setAttachmentError('');
                        setAttachments((current) => current.filter((_, i) => i !== index));
                    }}
                />
            </div>

            {status === 'error' && (
                <p className="text-xs text-danger">{errorMsg}</p>
            )}

            <div className="flex items-center justify-end gap-2">
                <Button type="button" variant="secondary" onClick={onCancel}>
                    {m.cancel}
                </Button>
                <Button
                    type="submit"
                    variant="primary"
                    loading={status === 'submitting'}
                    disabled={!canSubmit}
                >
                    {status === 'submitting' ? m.submitting : m.submit}
                </Button>
            </div>
        </form>
    );
}
