'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { CheckCircle2, XCircle, Loader2, ArrowRight } from 'lucide-react';

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE
    || (process.env.NODE_ENV === 'production' ? 'https://retail-saas-backend.onrender.com' : 'http://localhost:4000')) + '/api/v1';

type Status = 'loading' | 'success' | 'error';

export default function VerifyEmailPage() {
    const searchParams = useSearchParams();
    const token = searchParams.get('token');
    const [status, setStatus] = useState<Status>('loading');

    useEffect(() => {
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
                        <span className="text-xl font-black tracking-tight text-blue-600">RetailSaaS</span>
                    </div>

                    {status === 'loading' && (
                        <div className="flex flex-col items-center gap-5 py-6">
                            <Loader2 className="w-12 h-12 text-blue-500 animate-spin" />
                            <div className="text-center">
                                <p className="font-semibold text-gray-800 text-lg">Verifying your email…</p>
                                <p className="text-sm text-gray-400 mt-1">This will only take a moment.</p>
                            </div>
                        </div>
                    )}

                    {status === 'success' && (
                        <div className="flex flex-col items-center gap-5 py-6 text-center">
                            <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center">
                                <CheckCircle2 className="w-9 h-9 text-green-500" />
                            </div>
                            <div>
                                <h1 className="text-2xl font-bold tracking-tight text-gray-900">Email verified!</h1>
                                <p className="text-gray-500 mt-2 text-sm leading-relaxed">
                                    Your account is now active. You can sign in and start using RetailSaaS.
                                </p>
                            </div>
                            <Link
                                href="/dashboard"
                                className="mt-2 inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-8 rounded-xl shadow-lg shadow-blue-200 transition-all group"
                            >
                                Go to dashboard
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
                                <h1 className="text-2xl font-bold tracking-tight text-gray-900">Verification failed</h1>
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
                                Back to sign in
                            </Link>
                        </div>
                    )}
                </div>

                <p className="mt-8 text-center text-xs text-gray-400 uppercase tracking-widest font-semibold">
                    Retail SaaS Platform v0.1
                </p>
            </div>
        </div>
    );
}
