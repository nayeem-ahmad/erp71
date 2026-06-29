'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { AlertCircle, Eye, EyeOff } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

const API_BASE =
    ((process.env.NEXT_PUBLIC_API_BASE || process.env.NEXT_PUBLIC_API_URL) ||
        (process.env.NODE_ENV === 'production'
            ? 'https://erp71-backend.onrender.com'
            : 'http://localhost:4000')) + '/api/v1';

export default function StorefrontSignUpPage() {
    const { t } = useI18n();
    const m = t.storefront.public;
    const a = m.auth;
    const p = m.placeholders;
    const params = useParams();
    const router = useRouter();
    const slug = params?.slug as string;

    const [storeName, setStoreName] = useState('');
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [phone, setPhone] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (!slug) return;
        fetch(`${API_BASE}/storefront/${slug}`)
            .then((r) => r.json())
            .then((json) => {
                const data = 'data' in json ? json.data : json;
                setStoreName(data?.tenant?.name || '');
            })
            .catch(() => {});
    }, [slug]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setSubmitting(true);

        try {
            const res = await fetch(`${API_BASE}/storefront/${slug}/auth/signup`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, email, password, phone }),
            });

            const json = await res.json();

            if (!res.ok) {
                throw new Error(json.message || a.signUpFailed);
            }

            const payload = 'data' in json ? json.data : json;
            localStorage.setItem(
                `storefront_customer_${slug}`,
                JSON.stringify({ access_token: payload.access_token, customer: payload.customer }),
            );

            router.push(`/store/${slug}`);
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
                    <Link href={`/store/${slug}`} className="text-2xl font-black tracking-tighter text-gray-900">
                        {storeName || m.storeFallback}
                    </Link>
                    <h1 className="mt-4 text-xl font-bold text-gray-800">{a.signUpPageTitle}</h1>
                    <p className="mt-1 text-sm text-gray-500">{a.signUpPageSubtitle}</p>
                </div>

                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
                    <form onSubmit={handleSubmit} className="space-y-5">
                        {error && (
                            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
                                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                                <span>{error}</span>
                            </div>
                        )}

                        <div>
                            <label htmlFor="name" className="block text-sm font-semibold text-gray-700 mb-1.5">
                                {m.fullName} <span className="text-red-500">*</span>
                            </label>
                            <input
                                id="name"
                                type="text"
                                required
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder={p.name}
                                className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent transition-all"
                            />
                        </div>

                        <div>
                            <label htmlFor="email" className="block text-sm font-semibold text-gray-700 mb-1.5">
                                {m.email} <span className="text-red-500">*</span>
                            </label>
                            <input
                                id="email"
                                type="email"
                                required
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder={p.emailGeneric}
                                className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent transition-all"
                            />
                        </div>

                        <div>
                            <label htmlFor="phone" className="block text-sm font-semibold text-gray-700 mb-1.5">
                                {m.phone} <span className="text-red-500">*</span>
                            </label>
                            <input
                                id="phone"
                                type="tel"
                                required
                                value={phone}
                                onChange={(e) => setPhone(e.target.value)}
                                placeholder={p.phoneSignup}
                                className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent transition-all"
                            />
                        </div>

                        <div>
                            <label htmlFor="password" className="block text-sm font-semibold text-gray-700 mb-1.5">
                                {a.password} <span className="text-red-500">*</span>
                            </label>
                            <div className="relative">
                                <input
                                    id="password"
                                    type={showPassword ? 'text' : 'password'}
                                    required
                                    minLength={8}
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder={p.passwordMin}
                                    className="w-full border border-gray-300 rounded-xl px-4 py-3 pr-12 text-sm focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent transition-all"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword((v) => !v)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                                    tabIndex={-1}
                                >
                                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                                </button>
                            </div>
                        </div>

                        <button
                            type="submit"
                            disabled={submitting}
                            className="w-full bg-black hover:bg-gray-800 text-white font-bold py-3.5 rounded-xl transition-colors disabled:opacity-60 mt-2"
                        >
                            {submitting ? a.signingUp : a.createAccountButton}
                        </button>
                    </form>

                    <p className="mt-6 text-center text-sm text-gray-500">
                        {a.hasAccount}{' '}
                        <Link href={`/store/${slug}/auth/signin`} className="font-semibold text-black hover:underline">
                            {m.signIn}
                        </Link>
                    </p>
                </div>

                <p className="mt-6 text-center text-sm text-gray-400">
                    <Link href={`/store/${slug}`} className="hover:text-gray-600 transition-colors">
                        {a.backToStore}
                    </Link>
                </p>
            </div>
        </div>
    );
}
