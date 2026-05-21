'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Lock, Mail, ArrowRight, Loader2, PlayCircle } from 'lucide-react';
import { api } from '@/lib/api';

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE
    || (process.env.NODE_ENV === 'production' ? 'https://retail-saas-backend.onrender.com' : 'http://localhost:4000')) + '/api/v1';

async function storeAuthResponse(res: any) {
    localStorage.setItem('access_token', res.access_token);
    const meRes = res.tenants ? res : await api.getMe();
    if (meRes.tenants && meRes.tenants.length > 0) {
        const primaryTenant = meRes.tenants[0];
        localStorage.setItem('tenant_id', primaryTenant.id);
        if (primaryTenant.stores && primaryTenant.stores.length > 0) {
            localStorage.setItem('store_id', primaryTenant.stores[0].id);
        }
        if (primaryTenant.subscription?.plan?.code) {
            localStorage.setItem('subscription_plan_code', primaryTenant.subscription.plan.code);
        }
    }
}

export default function LoginPage() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isDemoLoading, setIsDemoLoading] = useState(false);
    const router = useRouter();
    const searchParams = useSearchParams();

    // Auto-trigger demo login when ?demo=1 is present in the URL
    useEffect(() => {
        if (searchParams.get('demo') === '1') {
            handleDemoLogin();
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        setError(null);

        try {
            const loginRes = await api.login({ email, password });
            await storeAuthResponse(loginRes);
            router.push('/dashboard');
        } catch (err: any) {
            setError(err.message || 'Login failed. Please check your credentials.');
        } finally {
            setIsLoading(false);
        }
    };

    const handleDemoLogin = async () => {
        setIsDemoLoading(true);
        setError(null);

        try {
            const res = await fetch(`${API_BASE}/auth/demo`, { method: 'POST' });
            if (!res.ok) {
                const body = await res.json().catch(() => null);
                throw new Error(body?.message || 'Demo account not available. Please try again later.');
            }
            const data = await res.json();
            await storeAuthResponse(data);
            router.push('/dashboard');
        } catch (err: any) {
            setError(err.message || 'Demo login failed. Please try again.');
        } finally {
            setIsDemoLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-[#f9fafb] p-4 font-sans text-[#111827]">
            <div className="w-full max-w-md">
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 md:p-10">
                    <div className="flex flex-col items-center mb-8">
                        <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center mb-4 shadow-lg shadow-blue-200">
                            <Lock className="text-white w-6 h-6" />
                        </div>
                        <h1 className="text-2xl font-bold tracking-tight">Welcome back</h1>
                        <p className="text-gray-500 mt-2 text-sm">Please enter your details to sign in</p>
                    </div>

                    {error && (
                        <div className="mb-6 p-3 bg-red-50 border border-red-100 text-red-600 text-sm rounded-xl text-center animate-in fade-in slide-in-from-top-1">
                            {error}
                        </div>
                    )}

                    <form onSubmit={handleLogin} className="space-y-6">
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-gray-700 ml-1">Email address</label>
                            <div className="relative">
                                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
                                <input
                                    type="email"
                                    required
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    className="w-full bg-gray-50 border border-gray-200 rounded-xl py-3 pl-10 pr-4 outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all duration-200"
                                    placeholder="name@company.com"
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium text-gray-700 ml-1">Password</label>
                            <div className="relative">
                                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
                                <input
                                    type="password"
                                    required
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    className="w-full bg-gray-50 border border-gray-200 rounded-xl py-3 pl-10 pr-4 outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all duration-200"
                                    placeholder="••••••••"
                                />
                            </div>
                        </div>

                        <div className="flex items-center justify-between text-sm">
                            <label className="flex items-center space-x-2 cursor-pointer group">
                                <input type="checkbox" className="w-4 h-4 rounded-sm border-gray-300 text-blue-600 focus:ring-blue-500" />
                                <span className="text-gray-600 group-hover:text-gray-900 transition-colors">Remember me</span>
                            </label>
                            <a href="#" className="font-medium text-blue-600 hover:text-blue-700 transition-colors">Forgot password?</a>
                        </div>

                        <button
                            type="submit"
                            disabled={isLoading || isDemoLoading}
                            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl shadow-lg shadow-blue-200 active:scale-[0.98] transition-all duration-200 flex items-center justify-center space-x-2 disabled:opacity-70 disabled:cursor-not-allowed group"
                        >
                            {isLoading ? (
                                <Loader2 className="w-5 h-5 animate-spin" />
                            ) : (
                                <>
                                    <span>Sign in</span>
                                    <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                                </>
                            )}
                        </button>
                    </form>

                    {/* Divider */}
                    <div className="my-6 flex items-center gap-3">
                        <div className="flex-1 h-px bg-gray-200" />
                        <span className="text-xs text-gray-400 font-medium uppercase tracking-wider">or</span>
                        <div className="flex-1 h-px bg-gray-200" />
                    </div>

                    {/* Try Demo button */}
                    <button
                        type="button"
                        onClick={handleDemoLogin}
                        disabled={isLoading || isDemoLoading}
                        className="w-full bg-white hover:bg-gray-50 text-gray-700 font-semibold py-3 rounded-xl border border-gray-200 active:scale-[0.98] transition-all duration-200 flex items-center justify-center space-x-2 disabled:opacity-70 disabled:cursor-not-allowed"
                    >
                        {isDemoLoading ? (
                            <Loader2 className="w-5 h-5 animate-spin" />
                        ) : (
                            <>
                                <PlayCircle className="w-5 h-5 text-blue-500" />
                                <span>Try Demo</span>
                            </>
                        )}
                    </button>
                    <p className="mt-2 text-center text-xs text-gray-400">
                        Explore with sample Bangladeshi retail data — no signup needed
                    </p>

                    <div className="mt-6 text-center text-sm text-gray-500">
                        Don&apos;t have an account? <Link href="/signup" className="font-medium text-blue-600 hover:text-blue-700 transition-colors">Sign up for free</Link>
                    </div>
                </div>

                <p className="mt-8 text-center text-xs text-gray-400 uppercase tracking-widest font-semibold">
                    Retail SaaS Platform v0.1
                </p>
            </div>
        </div>
    );
}
