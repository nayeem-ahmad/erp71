'use client';

import { useI18n, formatMessage } from '@/lib/i18n';
import { useEffect, useRef, useState } from 'react';
import { MessageSquare } from 'lucide-react';
import { fetchWithAuth } from '@/lib/api';

type FeedbackType = 'bug' | 'feature' | 'general';

const TYPE_EMOJI: Record<FeedbackType, string> = { bug: '🐛', feature: '✨', general: '💬' };

export default function FeedbackWidget() {
    const { t } = useI18n();
    const m = t.components.feedbackWidget;
    const TYPE_OPTIONS: { value: FeedbackType; label: string; emoji: string }[] = [
        { value: 'bug', label: m.types.bug, emoji: TYPE_EMOJI.bug },
        { value: 'feature', label: m.types.feature, emoji: TYPE_EMOJI.feature },
        { value: 'general', label: m.types.general, emoji: TYPE_EMOJI.general },
    ];
    const [open, setOpen] = useState(false);
    const [type, setType] = useState<FeedbackType>('general');
    const [message, setMessage] = useState('');
    const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
    const [errorMsg, setErrorMsg] = useState('');
    const cardRef = useRef<HTMLDivElement>(null);

    // Close on Escape
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') closeWidget();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open]);

    // Close on click outside
    useEffect(() => {
        if (!open) return;
        const onPointer = (e: MouseEvent) => {
            if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
                closeWidget();
            }
        };
        // Use setTimeout to avoid immediately closing when the button click opens the card
        const id = setTimeout(() => document.addEventListener('mousedown', onPointer), 0);
        return () => {
            clearTimeout(id);
            document.removeEventListener('mousedown', onPointer);
        };
    }, [open]);

    function closeWidget() {
        setOpen(false);
        // Reset form state after animation
        setTimeout(() => {
            setType('general');
            setMessage('');
            setStatus('idle');
            setErrorMsg('');
        }, 200);
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (message.trim().length < 3) return;
        setStatus('submitting');
        setErrorMsg('');
        try {
            await fetchWithAuth('/feedback', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type,
                    message: message.trim(),
                    page: typeof window !== 'undefined' ? window.location.pathname : undefined,
                }),
            });
            setStatus('success');
            setTimeout(() => closeWidget(), 2000);
        } catch (err: any) {
            setStatus('error');
            setErrorMsg(err?.message || m.defaultError);
        }
    }

    return (
        <div className="flex flex-col items-end gap-2">
            {/* Slide-up card */}
            {open && (
                <div
                    ref={cardRef}
                    className="w-80 rounded-2xl bg-white shadow-2xl border border-gray-200 overflow-hidden animate-slide-up"
                    style={{ animation: 'slideUp 0.18s ease-out' }}
                >
                    <style>{`
                        @keyframes slideUp {
                            from { opacity: 0; transform: translateY(12px); }
                            to   { opacity: 1; transform: translateY(0); }
                        }
                    `}</style>

                    {status === 'success' ? (
                        <div className="flex flex-col items-center justify-center py-10 px-6 text-center gap-3">
                            <span className="text-3xl">🎉</span>
                            <p className="text-sm font-semibold text-gray-800">{m.successTitle}</p>
                            <p className="text-xs text-gray-400">{m.successDescription}</p>
                        </div>
                    ) : (
                        <form onSubmit={handleSubmit}>
                            {/* Header */}
                            <div className="px-4 pt-4 pb-3 border-b border-gray-100 flex items-center justify-between">
                                <p className="text-sm font-bold text-gray-800">{m.title}</p>
                                <button
                                    type="button"
                                    onClick={closeWidget}
                                    className="text-gray-400 hover:text-gray-600 transition-colors text-lg leading-none"
                                    aria-label={m.closeAria}
                                >
                                    ×
                                </button>
                            </div>

                            <div className="px-4 py-3 flex flex-col gap-3">
                                {/* Type selector */}
                                <div className="flex gap-2">
                                    {TYPE_OPTIONS.map((opt) => (
                                        <button
                                            key={opt.value}
                                            type="button"
                                            onClick={() => setType(opt.value)}
                                            className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                                                type === opt.value
                                                    ? 'bg-blue-50 border-blue-400 text-blue-700'
                                                    : 'bg-gray-50 border-gray-200 text-gray-500 hover:border-gray-300'
                                            }`}
                                        >
                                            <span>{opt.emoji}</span>
                                            <span>{opt.label}</span>
                                        </button>
                                    ))}
                                </div>

                                {/* Textarea */}
                                <textarea
                                    value={message}
                                    onChange={(e) => setMessage(e.target.value)}
                                    placeholder={m.placeholder}
                                    rows={4}
                                    className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-800 placeholder-gray-400 outline-none focus:border-blue-400 focus:bg-white transition resize-none"
                                    autoFocus
                                />

                                {/* Error */}
                                {status === 'error' && (
                                    <p className="text-xs text-red-500">{errorMsg}</p>
                                )}

                                {/* Actions */}
                                <div className="flex items-center justify-end gap-2">
                                    <button
                                        type="button"
                                        onClick={closeWidget}
                                        className="text-xs font-semibold text-gray-500 hover:text-gray-700 px-3 py-1.5 rounded-lg transition-colors"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={message.trim().length < 3 || status === 'submitting'}
                                        className="text-xs font-bold bg-blue-600 text-white px-4 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                    >
                                        {status === 'submitting' ? m.submitting : m.submit}
                                    </button>
                                </div>
                            </div>
                        </form>
                    )}
                </div>
            )}

            {/* Floating pill button */}
            <button
                onClick={() => setOpen((v) => !v)}
                className="flex items-center gap-1.5 bg-white text-gray-700 border border-gray-200 shadow-md hover:shadow-lg hover:border-gray-300 px-3.5 py-2 rounded-full text-xs font-semibold transition-all hover:scale-105 active:scale-95"
                aria-label={m.openAria}
            >
                <MessageSquare className="w-3.5 h-3.5 text-blue-500" />
                {m.button}
            </button>
        </div>
    );
}
