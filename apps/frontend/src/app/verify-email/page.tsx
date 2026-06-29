'use client';
import { useI18n, formatMessage } from '@/lib/i18n';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { CheckCircle2, XCircle, Loader2, ArrowRight } from 'lucide-react';

const API_BASE = ((process.env.NEXT_PUBLIC_API_BASE || process.env.NEXT_PUBLIC_API_URL)
    || (process.env.NODE_ENV === 'production' ? 'https://erp71-backend.onrender.com' : 'http://localhost:4000')) + '/api/v1';

type Status = 'loading' | 'success' | 'pending' | 'error';

export default function VerifyEmailPage() {
    return (
        <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-blue-500" /></div>}>
            <VerifyEmailContent />
        </Suspense>
    );
}

function VerifyEmailContent() {
    const { t } = useI18n();
    const m = t.auth.verifyEmail;
    const searchParams = useSearchParams();
    const token = searchParams.get('token');
    const pending = searchParams.get('pending') === '1';
    const email = searchParams.get('email');
    const [status, setStatus] = useState<Status>(pending ? 'pending' : 'loading');

    useEffect(() => {
        if (pending) {
            return;
        }
        if (!token) {
            setStatus('error');
            return;
        }

        fetch(`${API_BASE}/auth/verify-email?token=${encodeURIComponent(token)}`)
            .then(async (res) => {
                if (!res.ok) {
                    throw new Error('Verification failed');
                }
                setStatus('success');
            })
            .catch(() => {
                setStatus('error');
            });
    }, [token]);

    return (
        <div className="min-h-screen flex items-center justify-center bg-[#f9fafb] p-4 font-sans text-[#111827]">
            <div className="w-full max-w-md">
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 md:p-10">

                    {/* Header logo */}
                    <div className="text-center mb-8">
                        <span className="text-xl font-black tracking-tight text-blue-600">{m.brand}</span>
                    </div>

                    {status === 'loading' && (
                        <div className="flex flex-col items-center gap-5 py-6">
                            <Loader2 className="w-12 h-12 text-blue-500 animate-spin" />
                            <div className="text-center">
                                <p className="font-semibold text-gray-800 text-lg">{m.loadingTitle}</p>
                                <p className="text-sm text-gray-400 mt-1">{m.loadingDescription}</p>
                            </div>
                        </div>
                    )}

                    {status === 'pending' && (
                        <div className="flex flex-col items-center gap-5 py-6 text-center">
                            <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center">
                                <CheckCircle2 className="w-9 h-9 text-blue-500" />
                            </div>
                            <div>
                                <h1 className="text-2xl font-bold tracking-tight text-gray-900">{m.pendingTitle}</h1>
                                <p className="text-gray-500 mt-2 text-sm leading-relaxed">
                                    We sent a verification link{email ? ` to ${email}` : ''}. Open it to activate your account, then continue to the dashboard.
                                </p>
                            </div>
                            <Link
                                href="/dashboard/onboarding"
                                className="mt-2 inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-8 rounded-xl shadow-lg shadow-blue-200 transition-all group"
                            >
                                {m.continueSetup}
                                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                            </Link>
                        </div>
                    )}

                    {status === 'success' && (
                        <div className="flex flex-col items-center gap-5 py-6 text-center">
                            <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center">
                                <CheckCircle2 className="w-9 h-9 text-green-500" />
                            </div>
                            <div>
                                <h1 className="text-2xl font-bold tracking-tight text-gray-900">{m.successTitle}</h1>
                                <p className="text-gray-500 mt-2 text-sm leading-relaxed">
                                    Your account is now active. You can sign in and start using {m.brand}.
                                </p>
                            </div>
                            <Link
                                href="/dashboard/onboarding"
                                className="mt-2 inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-8 rounded-xl shadow-lg shadow-blue-200 transition-all group"
                            >
                                {m.continueSetup}
                                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                            </Link>
                        </div>
                    )}

                    {status === 'error' && (
                        <div className="flex flex-col items-center gap-5 py-6 text-center">
                            <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center">
                                <XCircle className="w-9 h-9 text-red-500" />
                            </div>
                            <div>
                                <h1 className="text-2xl font-bold tracking-tight text-gray-900">{m.errorTitle}</h1>
                                <p className="text-gray-500 mt-2 text-sm leading-relaxed">
                                    This verification link is invalid or has expired.
                                    <br />
                                    Please sign in and request a new verification email from your account settings.
                                </p>
                            </div>
                            <Link
                                href="/login"
                                className="mt-2 inline-flex items-center gap-2 bg-gray-900 hover:bg-gray-700 text-white font-semibold py-3 px-8 rounded-xl transition-colors"
                            >
                                {m.backToSignIn}
                            </Link>
                        </div>
                    )}
                </div>

                <p className="mt-8 text-center text-xs text-gray-400 uppercase tracking-widest font-semibold">
                    {m.version}
                </p>
            </div>
        </div>
    );
}
