'use client';

import { useState, type FormEvent } from 'react';
import NpsScorePicker from '@/components/kpis/NpsScorePicker';
import { Button, Textarea } from '@/components/ui';
import { publicApiBase } from '@/lib/api-base';
import { useI18n } from '@/lib/i18n';

export interface PublicSurvey {
    shopName: string;
    logoUrl: string | null;
    answered: boolean;
}

function Card({ children }: { children: React.ReactNode }) {
    return (
        <main className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
            <div className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-4 shadow-sm md:p-6">{children}</div>
        </main>
    );
}

export default function PublicNpsSurvey({ code, survey }: { code: string; survey: PublicSurvey | null }) {
    const { t, fmt } = useI18n();
    const copy = t.kpis.survey;
    const [score, setScore] = useState<number | null>(null);
    const [comment, setComment] = useState('');
    const [state, setState] = useState<'open' | 'sending' | 'done' | 'answered'>(survey?.answered ? 'answered' : 'open');
    const [error, setError] = useState('');

    if (!survey) {
        return <Card><p className="text-center text-sm text-gray-700">{copy.invalid}</p></Card>;
    }
    const shop = survey.shopName;

    if (state === 'answered') {
        return <Card><p className="text-center text-sm text-gray-700">{copy.alreadyAnswered}</p></Card>;
    }
    if (state === 'done') {
        return <Card><p className="text-center text-sm text-gray-700" role="status">{fmt(copy.thanks, { shop })}</p></Card>;
    }

    const submit = async (event: FormEvent) => {
        event.preventDefault();
        if (score === null) {
            setError(copy.pickScore);
            return;
        }
        setState('sending');
        setError('');
        try {
            const response = await fetch(`${publicApiBase()}/public/nps/${encodeURIComponent(code)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ score, ...(comment.trim() ? { comment: comment.trim() } : {}) }),
            });
            if (response.status === 400) {
                setState('answered');
                return;
            }
            if (!response.ok) throw new Error(String(response.status));
            setState('done');
        } catch {
            setState('open');
            setError(copy.failed);
        }
    };

    return (
        <Card>
            <form onSubmit={submit} className="space-y-4">
                {survey.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={survey.logoUrl} alt={shop} className="mx-auto h-12 w-auto object-contain" />
                ) : null}
                <h1 id="nps-question" className="text-center text-base font-semibold text-gray-900">
                    {fmt(copy.title, { shop })}
                </h1>
                <NpsScorePicker value={score} onChange={(next) => { setScore(next); setError(''); }} labelledBy="nps-question" />
                {error ? <p className="text-xs text-red-700" role="alert">{error}</p> : null}
                <label className="block">
                    <span className="mb-1 block text-xs font-medium text-gray-700">{copy.commentLabel}</span>
                    <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} maxLength={1000} />
                </label>
                <Button type="submit" className="w-full" loading={state === 'sending'} disabled={state === 'sending'}>
                    {copy.submit}
                </Button>
            </form>
        </Card>
    );
}
