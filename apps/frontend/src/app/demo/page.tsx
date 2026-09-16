'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Loader2, PlayCircle, ArrowRight } from 'lucide-react';
import { api } from '@/lib/api';
import { storeAuthResponse } from '@/lib/auth-session';
import { useI18n } from '@/lib/i18n';

function DemoPageContent() {
    const { t } = useI18n();
    const router = useRouter();
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;

        const startDemo = async () => {
            try {
                const auth = await api.demoLogin();
                if (cancelled) return;
                await storeAuthResponse(auth);
                localStorage.removeItem('onboarding_complete');
                router.replace('/dashboard/onboarding');
            } catch (err: any) {
                if (!cancelled) {
                    setError(err.message || t.auth.login.demoFailed);
                    setLoading(false);
                }
            }
        };

        void startDemo();

        return () => {
            cancelled = true;
        };
    }, [router, t.auth.login.demoFailed]);

    if (loading && !error) {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center bg-[#f9fafb] p-6 text-center gap-4">
                <Loader2 className="w-10 h-10 animate-spin text-violet-600" />
                <div>
                    <h1 className="text-xl font-black text-gray-900">{t.demo.loadingTitle}</h1>
                    <p className="text-sm text-gray-500 mt-1">{t.demo.loadingDescription}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-[#f9fafb] p-6">
            <div className="w-full max-w-md bg-white rounded-2xl border border-gray-100 shadow-sm p-8 text-center space-y-5">
                <div className="w-14 h-14 bg-violet-100 rounded-2xl flex items-center justify-center mx-auto">
                    <PlayCircle className="w-7 h-7 text-violet-600" />
                </div>
                <div>
                    <h1 className="text-2xl font-black text-gray-900">{t.demo.unavailableTitle}</h1>
                    <p className="text-sm text-gray-500 mt-2">{error}</p>
                </div>
                <div className="flex flex-col gap-3">
                    <Link
                        href="/signup"
                        className="inline-flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-xl transition-colors"
                    >
                        {t.demo.startFreeTrial} <ArrowRight className="w-4 h-4" />
                    </Link>
                    <Link href="/login" className="text-sm font-semibold text-gray-500 hover:text-gray-800">
                        {t.demo.backToLogin}
                    </Link>
                </div>
            </div>
        </div>
    );
}

export default function DemoPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-violet-600" />
            </div>
        }>
            <DemoPageContent />
        </Suspense>
    );
}