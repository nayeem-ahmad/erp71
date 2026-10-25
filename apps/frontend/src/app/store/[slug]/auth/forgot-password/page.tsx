'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { AlertCircle, CheckCircle } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { useHydrated } from '@/hooks/useHydrated';
import { browserApiBase } from '@/lib/api-base';

const API_BASE = browserApiBase();

/**
 * "Forgot password?" for a shop's customers. The link it emails comes back to
 * this shop's own reset page, not the ERP's — see `customerForgotPassword`.
 */
export default function StorefrontForgotPasswordPage() {
    const { t } = useI18n();
    const m = t.storefront.public;
    const a = m.auth;
    const params = useParams();
    const slug = params?.slug as string;
    // Guards against a native form submit before React hydrates — see useHydrated.
    const hydrated = useHydrated();

    const [storeName, setStoreName] = useState('');
    const [email, setEmail] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [sent, setSent] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!slug) return;
        fetch(`${API_BASE}/storefront/${slug}/meta`)
            .then((r) => r.json())
            .then((json) => setStoreName(('data' in json ? json.data : json)?.name || ''))
            .catch(() => {});
    }, [slug]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setSubmitting(true);
        try {
            const res = await fetch(`${API_BASE}/storefront/${slug}/auth/forgot-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: email.trim() }),
            });
            if (!res.ok) {
                const json = await res.json().catch(() => null);
                throw new Error(json?.error?.message || json?.message || a.defaultError);
            }
            setSent(true);
        } catch (err: any) {
            setError(err.message || a.defaultError);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4">
            <div className="w-full max-w-md">
                <div className="mb-8 text-center">
                    <Link href={`/store/${slug}`} className="text-2xl font-bold tracking-tight text-gray-900">
                        {storeName || m.storeFallback}
                    </Link>
                    <h1 className="mt-4 text-xl font-bold text-gray-800">{a.forgotTitle}</h1>
                    <p className="mt-1 text-sm text-gray-500">{a.forgotSubtitle}</p>
                </div>

                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
                    {sent ? (
                        <div role="status" className="flex items-start gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 text-sm text-emerald-700">
                            <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                            <span>{a.resetLinkSent}</span>
                        </div>
                    ) : (
                        <form onSubmit={handleSubmit} className="space-y-5">
                            {error && (
                                <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
                                    <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                                    <span>{error}</span>
                                </div>
                            )}

                            <div>
                                <label htmlFor="email" className="block text-sm font-semibold text-gray-700 mb-1.5">
                                    {a.email}
                                </label>
                                <input
                                    id="email"
                                    type="email"
                                    required
                                    autoComplete="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder={m.placeholders.emailGeneric}
                                    className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent transition-all"
                                />
                            </div>

                            <button
                                type="submit"
                                disabled={!hydrated || submitting}
                                className="w-full bg-black hover:bg-gray-800 text-white font-bold py-3.5 rounded-xl transition-colors disabled:opacity-60"
                            >
                                {submitting ? a.sendingResetLink : a.sendResetLink}
                            </button>
                        </form>
                    )}

                    <p className="mt-6 text-center text-sm">
                        <Link href={`/store/${slug}/auth/signin`} className="font-semibold text-black hover:underline">
                            {a.backToSignIn}
                        </Link>
                    </p>
                </div>
            </div>
        </div>
    );
}
