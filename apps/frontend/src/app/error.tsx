'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useI18n, formatMessage } from '@/lib/i18n';

export default function Error({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    const { t } = useI18n();
    const m = t.marketing.error;

    useEffect(() => {
        console.error(error);
    }, [error]);

    return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-canvas font-sans text-gray-900 px-4">
            <div className="text-center space-y-6 max-w-lg">
                <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-red-50 border border-red-100">
                    <AlertTriangle className="w-10 h-10 text-red-500" />
                </div>

                <div className="space-y-2">
                    <p className="text-xs font-black uppercase tracking-[0.24em] text-red-500">{m.badge}</p>
                    <h1 className="text-4xl font-black tracking-tight text-gray-950">{m.title}</h1>
                    <p className="text-gray-500 text-base leading-relaxed">{m.description}</p>
                    {error.digest && (
                        <p className="text-xs font-mono text-gray-400 mt-2">{formatMessage(m.errorId, { id: error.digest })}</p>
                    )}
                    {error.message && !error.digest && (
                        <p className="text-xs font-mono text-gray-400 mt-2 max-w-sm break-all">{error.message}</p>
                    )}
                </div>

                <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
                    <button
                        onClick={reset}
                        className="inline-flex items-center gap-2 rounded-2xl bg-gray-900 px-6 py-3 text-sm font-black text-white shadow-lg transition hover:-translate-y-0.5 hover:shadow-xl"
                    >
                        <RefreshCw className="w-4 h-4" />
                        {m.tryAgain}
                    </button>
                    <Link
                        href="/dashboard"
                        className="inline-flex items-center rounded-2xl border border-gray-200 bg-white px-6 py-3 text-sm font-bold text-gray-700 transition hover:bg-gray-50"
                    >
                        {m.backToDashboard}
                    </Link>
                </div>
            </div>
        </div>
    );
}