'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { careersApi, saveCareersSession } from '@/lib/careers-api';
import { routes } from '@/lib/routes';

function CareersLoginForm() {
    const router = useRouter();
    const searchParams = useSearchParams();

    // Only same-origin paths, so `?redirect=` cannot be used to bounce someone
    // off the platform after they authenticate.
    const rawRedirect = searchParams?.get('redirect') ?? '';
    const redirect =
        rawRedirect.startsWith('/') && !rawRedirect.startsWith('//')
            ? rawRedirect
            : routes.careers.portal;

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [pendingUserId, setPendingUserId] = useState<string | null>(null);
    const [code, setCode] = useState('');

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setSubmitting(true);
        try {
            const result = await careersApi.login({ email, password });
            if (result.requires_2fa && result.user_id) {
                setPendingUserId(result.user_id);
                return;
            }
            if (result.access_token && result.applicant) {
                saveCareersSession(result.access_token, result.applicant);
                router.push(redirect);
            }
        } catch (err: any) {
            setError(err?.message || 'Could not sign you in.');
        } finally {
            setSubmitting(false);
        }
    };

    const handleTwoFactor = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!pendingUserId) return;
        setError('');
        setSubmitting(true);
        try {
            const result = await careersApi.verifyTwoFactor({ userId: pendingUserId, code });
            saveCareersSession(result.access_token, result.applicant);
            router.push(redirect);
        } catch (err: any) {
            setError(err?.message || 'That code was not accepted.');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="mx-auto w-full max-w-sm">
            <h1 className="text-lg font-bold tracking-tight text-gray-950">
                {pendingUserId ? 'Enter your authentication code' : 'Sign in to your careers account'}
            </h1>
            <p className="mt-0.5 text-xs text-gray-500">
                {pendingUserId
                    ? 'Your account is protected with two-factor authentication.'
                    : 'One account for every application you send on ERP71.'}
            </p>

            {error ? (
                <p className="mt-3 rounded-lg border border-red-100 bg-red-50 p-2.5 text-xs text-red-700">
                    {error}
                </p>
            ) : null}

            {pendingUserId ? (
                <form onSubmit={handleTwoFactor} className="mt-4 space-y-3">
                    <label className="block">
                        <span className="mb-1 block text-xs font-medium text-gray-500">6-digit code</span>
                        <input
                            value={code}
                            onChange={(e) => setCode(e.target.value)}
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            required
                            className="w-full rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-sm tracking-widest focus:border-blue-400 focus:ring-2 focus:ring-blue-100 max-md:min-h-touch"
                        />
                    </label>
                    <button
                        type="submit"
                        disabled={submitting}
                        className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60 max-md:min-h-touch"
                    >
                        {submitting ? 'Verifying…' : 'Verify and continue'}
                    </button>
                </form>
            ) : (
                <form onSubmit={handleLogin} className="mt-4 space-y-3">
                    <label className="block">
                        <span className="mb-1 block text-xs font-medium text-gray-500">Email</span>
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                            autoComplete="email"
                            className="w-full rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-sm focus:border-blue-400 focus:ring-2 focus:ring-blue-100 max-md:min-h-touch"
                        />
                    </label>

                    <label className="block">
                        <span className="mb-1 block text-xs font-medium text-gray-500">Password</span>
                        <div className="relative">
                            <input
                                type={showPassword ? 'text' : 'password'}
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                                autoComplete="current-password"
                                className="w-full rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 pe-9 text-sm focus:border-blue-400 focus:ring-2 focus:ring-blue-100 max-md:min-h-touch"
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword((v) => !v)}
                                aria-label={showPassword ? 'Hide password' : 'Show password'}
                                className="absolute end-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                            >
                                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </button>
                        </div>
                    </label>

                    <button
                        type="submit"
                        disabled={submitting}
                        className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60 max-md:min-h-touch"
                    >
                        {submitting ? 'Signing in…' : 'Sign in'}
                    </button>
                </form>
            )}

            <p className="mt-4 text-xs text-gray-500">
                No account yet?{' '}
                <Link href={routes.careers.register} className="font-semibold text-blue-600 hover:underline">
                    Create one
                </Link>
            </p>
        </div>
    );
}

export default function CareersLoginPage() {
    // `useSearchParams` needs a Suspense boundary for the static shell.
    return (
        <Suspense fallback={<p className="p-6 text-center text-sm text-gray-500">Loading…</p>}>
            <CareersLoginForm />
        </Suspense>
    );
}
