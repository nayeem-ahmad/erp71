'use client';

import { useEffect, useId, useState } from 'react';
import NpsScorePicker from '@/components/kpis/NpsScorePicker';
import { Button, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { toast } from '@/lib/toast';

/**
 * Asks a shop owner how likely they are to recommend ERP71 — the platform's
 * Net Promoter Score. Shown on Home only when the API says to ask (owners, at
 * most every 90 days, not in a workspace's first fortnight). "Not now" is
 * recorded too, so closing it also keeps it away for the same 90 days.
 */
export default function OwnerNpsPrompt() {
    const { t } = useI18n();
    const copy = t.kpis.ownerSurvey;
    const questionId = useId();
    const [ask, setAsk] = useState(false);
    const [score, setScore] = useState<number | null>(null);
    const [comment, setComment] = useState('');
    const [sending, setSending] = useState(false);

    useEffect(() => {
        let cancelled = false;
        // Started inside a promise so even a synchronous failure lands in catch:
        // the question is optional, and a failed check must never take Home down.
        Promise.resolve()
            .then(() => api.getOwnerNpsPrompt())
            .then((result) => { if (!cancelled) setAsk(Boolean(result?.ask)); })
            .catch(() => { /* A failed check simply does not ask. */ });
        return () => { cancelled = true; };
    }, []);

    if (!ask) return null;

    const send = async (body: { score?: number; comment?: string; dismissed?: boolean }) => {
        setSending(true);
        try {
            await api.submitOwnerNps(body);
            setAsk(false);
            if (!body.dismissed) toast.success(copy.thanks);
        } catch {
            toast.error(copy.failed);
        } finally {
            setSending(false);
        }
    };

    return (
        <section className="px-3 pt-3 md:px-4 md:pt-4" aria-labelledby={questionId} data-testid="owner-nps-prompt">
            <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-3 md:p-4">
                <h2 id={questionId} className="text-sm font-semibold text-gray-900">{copy.question}</h2>
                <NpsScorePicker value={score} onChange={setScore} labelledBy={questionId} />
                {score !== null ? (
                    <label className="block">
                        <span className="mb-1 block text-xs font-medium text-gray-700">{copy.commentLabel}</span>
                        <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} maxLength={1000} />
                    </label>
                ) : null}
                <div className="flex justify-end gap-2">
                    <Button variant="ghost" onClick={() => void send({ dismissed: true })} disabled={sending}>
                        {copy.notNow}
                    </Button>
                    <Button
                        onClick={() => score !== null && void send({ score, ...(comment.trim() ? { comment: comment.trim() } : {}) })}
                        disabled={score === null || sending}
                        loading={sending}
                    >
                        {copy.submit}
                    </Button>
                </div>
            </div>
        </section>
    );
}
