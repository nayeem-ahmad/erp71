'use client';
import { useI18n, formatMessage } from '@/lib/i18n';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Lock, ArrowLeft, Loader2, CheckCircle, AlertCircle } from 'lucide-react';

const API_BASE = ((process.env.NEXT_PUBLIC_API_BASE || process.env.NEXT_PUBLIC_API_URL)
    || (process.env.NODE_ENV === 'production' ? 'https://erp71-backend.onrender.com' : 'http://localhost:4000')) + '/api/v1';

function ResetPasswordContent() {
    const { t } = useI18n();
    const m = t.auth.resetPassword;
    const searchParams = useSearchParams();
    const router = useRouter();
    const token = searchParams.get('token');

    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);

    useEffect(() => {
        if (!token) {
            setError(m.missingToken);
        }
    }, [token]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (newPassword !== confirmPassword) {
            setError(m.mismatch);
            return;
        }
        if (newPassword.length < 8) {
            setError(m.tooShort);
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            const res = await fetch(`${API_BASE}/auth/reset-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, newPassword }),
            });

            if (!res.ok) {
                const body = await res.json().catch(() => null);
                throw new Error(body?.message || m.defaultError);
            }

            setSuccess(true);
            setTimeout(() => router.push('/login'), 3000);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-[#f9fafb] p-4 font-sans text-[#111827]">
            <div className="w-full max-w-md">
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 md:p-10">
                    {success ? (
                        <div className="flex flex-col items-center text-center">
                            <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center mb-4">
                                <CheckCircle className="text-green-600 w-6 h-6" />
                            </div>
                            <h1 className="text-2xl font-bold tracking-tight">{m.successTitle}</h1>
                            <p className="text-gray-500 mt-3 text-sm">
                                {m.successDescription}
                            </p>
                        </div>
                    ) : (
                        <>
                            <div className="flex flex-col items-center mb-8">
                                <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center mb-4 shadow-lg shadow-blue-200">
                                    <Lock className="text-white w-6 h-6" />
                                </div>
                                <h1 className="text-2xl font-bold tracking-tight">{m.title}</h1>
                                <p className="text-gray-500 mt-2 text-sm text-center">
                                    {m.description}
                                </p>
                            </div>

                            {error && (
                                <div className="mb-6 p-3 bg-red-50 border border-red-100 text-red-600 text-sm rounded-xl flex items-start gap-2">
                                    <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                                    <span>{error}</span>
                                </div>
                            )}

                            {!token ? (
                                <div className="text-center">
                                    <Link
                                        href="/forgot-password"
                                        className="inline-flex items-center gap-2 text-sm font-medium text-blue-600 hover:text-blue-700"
                                    >
                                        {m.requestNewLink}
                                    </Link>
                                </div>
                            ) : (
                                <form onSubmit={handleSubmit} className="space-y-5">
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium text-gray-700 ml-1">{m.newPasswordLabel}</label>
                                        <div className="relative">
                                            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
                                            <input
                                                type="password"
                                                required
                                                minLength={8}
                                                value={newPassword}
                                                onChange={(e) => setNewPassword(e.target.value)}
                                                className="w-full bg-gray-50 border border-gray-200 rounded-xl py-3 pl-10 pr-4 outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all duration-200"
                                                placeholder={m.newPasswordPlaceholder}
                                            />
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <label className="text-sm font-medium text-gray-700 ml-1">{m.confirmPasswordLabel}</label>
                                        <div className="relative">
                                            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
                                            <input
                                                type="password"
                                                required
                                                value={confirmPassword}
                                                onChange={(e) => setConfirmPassword(e.target.value)}
                                                className="w-full bg-gray-50 border border-gray-200 rounded-xl py-3 pl-10 pr-4 outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all duration-200"
                                                placeholder={m.confirmPasswordPlaceholder}
                                            />
                                        </div>
                                    </div>

                                    <button
                                        type="submit"
                                        disabled={isLoading}
                                        className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl shadow-lg shadow-blue-200 active:scale-[0.98] transition-all duration-200 flex items-center justify-center space-x-2 disabled:opacity-70 disabled:cursor-not-allowed"
                                    >
                                        {isLoading ? (
                                            <Loader2 className="w-5 h-5 animate-spin" />
                                        ) : (
                                            <span>{m.submit}</span>
                                        )}
                                    </button>
                                </form>
                            )}

                            <div className="mt-6 text-center">
                                <Link
                                    href="/login"
                                    className="flex items-center justify-center gap-2 text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors"
                                >
                                    <ArrowLeft className="w-4 h-4" />
                                    {m.backToSignIn}
                                </Link>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

export default function ResetPasswordPage() {
    return (
        <Suspense>
            <ResetPasswordContent />
        </Suspense>
    );
}
