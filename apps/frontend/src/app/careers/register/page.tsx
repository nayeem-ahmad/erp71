'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { careersApi, saveCareersSession } from '@/lib/careers-api';
import { routes } from '@/lib/routes';

export default function CareersRegisterPage() {
    const router = useRouter();

    const [fullName, setFullName] = useState('');
    const [email, setEmail] = useState('');
    const [phone, setPhone] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [pendingUserId, setPendingUserId] = useState<string | null>(null);
    const [code, setCode] = useState('');

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setSubmitting(true);
        try {
            const result = await careersApi.register({
                full_name: fullName,
                email,
                password,
                phone,
            });
            // Registering against an existing ERP71 account only proves the
            // password; if that account carries 2FA, the code is still required.
            if (result.requires_2fa && result.user_id) {
                setPendingUserId(result.user_id);
                return;
            }
            if (result.access_token && result.applicant) {
                saveCareersSession(result.access_token, result.applicant);
                router.push(routes.careers.profile);
            }
        } catch (err: any) {
            setError(err?.message || 'Could not create your account.');
        } finally {
            setSubmitting(false);
        }
    };

    const verify = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!pendingUserId) return;
        setError('');
        setSubmitting(true);
        try {
            const result = await careersApi.verifyTwoFactor({ userId: pendingUserId, code });
            saveCareersSession(result.access_token, result.applicant);
            router.push(routes.careers.profile);
        } catch (err: any) {
            setError(err?.message || 'That code was not accepted.');
        } finally {
            setSubmitting(false);
        }
    };

    const inputClass =
        'w-full rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-sm focus:border-blue-400 focus:ring-2 focus:ring-blue-100 max-md:min-h-touch';

    return (
        <div className="mx-auto w-full max-w-sm">
            <h1 className="text-lg font-bold tracking-tight text-gray-950">
                {pendingUserId ? 'Enter your authentication code' : 'Create your careers account'}
            </h1>
            <p className="mt-0.5 text-xs text-gray-500">
                {pendingUserId
                    ? 'This email already has an ERP71 account protected with two-factor authentication.'
                    : 'One profile, then apply to any company hiring on ERP71.'}
            </p>

            {error ? (
                <p className="mt-3 rounded-lg border border-red-100 bg-red-50 p-2.5 text-xs text-red-700">
                    {error}
                </p>
            ) : null}

            {pendingUserId ? (
                <form onSubmit={verify} className="mt-4 space-y-3">
                    <label className="block">
                        <span className="mb-1 block text-xs font-medium text-gray-500">6-digit code</span>
                        <input
                            value={code}
                            onChange={(e) => setCode(e.target.value)}
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            required
                            className={`${inputClass} tracking-widest`}
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
                <form onSubmit={submit} className="mt-4 space-y-3">
                    <label className="block">
                        <span className="mb-1 block text-xs font-medium text-gray-500">Full name</span>
                        <input
                            value={fullName}
                            onChange={(e) => setFullName(e.target.value)}
                            required
                            minLength={2}
                            autoComplete="name"
                            className={inputClass}
                        />
                    </label>

                    <label className="block">
                        <span className="mb-1 block text-xs font-medium text-gray-500">Email</span>
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                            autoComplete="email"
                            className={inputClass}
                        />
                    </label>

                    <label className="block">
                        <span className="mb-1 block text-xs font-medium text-gray-500">Mobile</span>
                        <input
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                            required
                            minLength={6}
                            autoComplete="tel"
                            placeholder="01XXXXXXXXX"
                            className={inputClass}
                        />
                        <span className="mt-1 block text-xs text-gray-400">
                            Employers match candidates on their number, so it is required.
                        </span>
                    </label>

                    <label className="block">
                        <span className="mb-1 block text-xs font-medium text-gray-500">Password</span>
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                            minLength={8}
                            autoComplete="new-password"
                            className={inputClass}
                        />
                        <span className="mt-1 block text-xs text-gray-400">At least 8 characters.</span>
                    </label>

                    <button
                        type="submit"
                        disabled={submitting}
                        className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60 max-md:min-h-touch"
                    >
                        {submitting ? 'Creating account…' : 'Create account'}
                    </button>
                </form>
            )}

            <p className="mt-4 text-xs text-gray-500">
                Already have an account?{' '}
                <Link href={routes.careers.login} className="font-semibold text-blue-600 hover:underline">
                    Sign in
                </Link>
            </p>
        </div>
    );
}
