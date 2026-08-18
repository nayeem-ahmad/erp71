'use client';

import { useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Button, Field, Input, Textarea } from '@/components/ui';

export type KnockCategory = 'support' | 'bug' | 'feature' | 'general';

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
    onCreated: (threadId: string) => void;
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
    const [status, setStatus] = useState<'idle' | 'submitting' | 'error'>('idle');
    const [errorMsg, setErrorMsg] = useState('');

    const activeCategory = categories.includes(category) ? category : categories[0];
    const placeholder = activeCategory === 'support' ? m.placeholderSupport : m.placeholderFeedback;

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!activeCategory || body.trim().length < 3) return;
        setStatus('submitting');
        setErrorMsg('');
        try {
            const res = await api.createSupportThread({
                category: activeCategory,
                subject: subject.trim() || undefined,
                body: body.trim(),
                page: capturePage && typeof window !== 'undefined' ? window.location.pathname : undefined,
            }) as { id: string };
            onCreated(res.id);
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
                    disabled={body.trim().length < 3 || status === 'submitting'}
                >
                    {status === 'submitting' ? m.submitting : m.submit}
                </Button>
            </div>
        </form>
    );
}
