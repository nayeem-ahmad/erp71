'use client';

import { Suspense, useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { AlertCircle, CheckCircle } from 'lucide-react';
import { evaluatePassword, type PasswordPolicy } from '@erp71/shared-types';
import { useI18n } from '@/lib/i18n';
import { useHydrated } from '@/hooks/useHydrated';
import { PasswordRequirements } from '@/components/ui';
import { browserApiBase } from '@/lib/api-base';

const API_BASE = browserApiBase();

/** What `GET /auth/reset-token/:token` reports — see `PasswordResetService.inspectToken`. */
type TokenStatus = { valid: boolean; passwordPolicy: PasswordPolicy | null };

function unwrap<T>(body: unknown): Partial<T> | null {
    if (!body || typeof body !== 'object') return null;
    return ('data' in body ? body.data : body) as Partial<T> | null;
}

const inputCls =
    'w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent transition-all';

/**
 * Where a storefront reset email lands. Same token and same backend as the
 * ERP's `/reset-password`, dressed as the shop and returning to its sign-in.
 */
function StorefrontResetPasswordContent() {
    const { t } = useI18n();
    const m = t.storefront.public;
    const a = m.auth;
    const params = useParams();
    const router = useRouter();
    const searchParams = useSearchParams();
    const slug = params?.slug as string;
    const token = searchParams.get('token');
    // Guards against a native form submit before React hydrates — see useHydrated.
    const hydrated = useHydrated();

    const [storeName, setStoreName] = useState('');
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [policy, setPolicy] = useState<PasswordPolicy | null>(null);
    const [invalid, setInvalid] = useState(!token);
    const [submitting, setSubmitting] = useState(false);
    const [success, setSuccess] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!slug) return;
        fetch(`${API_BASE}/storefront/${slug}/meta`)
            .then((r) => r.json())
            .then((json) => setStoreName(('data' in json ? json.data : json)?.name || ''))
            .catch(() => {});
    }, [slug]);

    /**
     * Find out on load whether the link still works, rather than after the
     * shopper has typed a password twice. An unreadable answer is no evidence
     * against the token — submitting is still the real test.
     */
    useEffect(() => {
        if (!token) return;
        let cancelled = false;
        fetch(`${API_BASE}/auth/reset-token/${encodeURIComponent(token)}`)
            .then((res) => (res.ok ? res.json() : null))
            .then((body) => {
                const status = unwrap<TokenStatus>(body);
                if (cancelled || !status) return;
                setPolicy(status.passwordPolicy ?? null);
                if (status.valid === false) setInvalid(true);
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [token]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        if (password !== confirm) {
            setError(a.passwordMismatch);
            return;
        }
        if (!evaluatePassword(password, policy ?? undefined).valid) {
            setError(a.resetPolicyUnmet);
            return;
        }

        setSubmitting(true);
        try {
            const res = await fetch(`${API_BASE}/auth/reset-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, newPassword: password }),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => null);
                throw new Error(body?.error?.message || body?.message || a.resetInvalid);
            }
            setSuccess(true);
            setTimeout(() => router.push(`/store/${slug}/auth/signin`), 3000);
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
                    <h1 className="mt-4 text-xl font-bold text-gray-800">{a.resetTitle}</h1>
                    <p className="mt-1 text-sm text-gray-500">{a.resetSubtitle}</p>
                </div>

                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
                    {success ? (
                        <div role="status" className="flex items-start gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 text-sm text-emerald-700">
                            <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                            <span>{a.resetSuccess}</span>
                        </div>
                    ) : invalid ? (
                        <div className="space-y-5 text-center">
                            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700 text-start">
                                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                                <span>{a.resetInvalid}</span>
                            </div>
                            <Link
                                href={`/store/${slug}/auth/forgot-password`}
                                className="inline-block font-semibold text-black hover:underline text-sm"
                            >
                                {a.requestNewLink}
                            </Link>
                        </div>
                    ) : (
                        <form onSubmit={handleSubmit} className="space-y-5">
                            {error && (
                                <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
                                    <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                                    <span>{error}</span>
                                </div>
                            )}

                            <div className="space-y-2">
                                <label htmlFor="new-password" className="block text-sm font-semibold text-gray-700">
                                    {a.newPassword}
                                </label>
                                <input
                                    id="new-password"
                                    type="password"
                                    required
                                    autoComplete="new-password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    className={inputCls}
                                />
                                <PasswordRequirements password={password} policy={policy} touched={password.length > 0} />
                            </div>

                            <div>
                                <label htmlFor="confirm-password" className="block text-sm font-semibold text-gray-700 mb-1.5">
                                    {a.confirmPassword}
                                </label>
                                <input
                                    id="confirm-password"
                                    type="password"
                                    required
                                    autoComplete="new-password"
                                    value={confirm}
                                    onChange={(e) => setConfirm(e.target.value)}
                                    className={inputCls}
                                />
                            </div>

                            <button
                                type="submit"
                                disabled={!hydrated || submitting}
                                className="w-full bg-black hover:bg-gray-800 text-white font-bold py-3.5 rounded-xl transition-colors disabled:opacity-60"
                            >
                                {submitting ? a.resetting : a.resetButton}
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

export default function StorefrontResetPasswordPage() {
    return (
        <Suspense>
            <StorefrontResetPasswordContent />
        </Suspense>
    );
}
