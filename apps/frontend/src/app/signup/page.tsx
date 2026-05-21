'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Building2, Loader2, Lock, Mail, Store } from 'lucide-react';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';

type Plan = {
    code: 'FREE' | 'BASIC' | 'STANDARD' | 'PREMIUM';
    name: string;
    description?: string | null;
    monthly_price: number;
};

export default function SignupPage() {
    const router = useRouter();
    const [plans, setPlans] = useState<Plan[]>([]);
    const [form, setForm] = useState({
        name: '',
        email: '',
        password: '',
        tenantName: '',
        storeName: '',
        planCode: 'FREE' as 'FREE' | 'BASIC' | 'STANDARD' | 'PREMIUM',
    });
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        api.getSubscriptionPlans().then(setPlans).catch(() => null);
    }, []);

    const handleChange = (field: keyof typeof form, value: string) => {
        setForm((current) => ({ ...current, [field]: value }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        setError(null);

        try {
            const signupRes = await api.signup(form);
            localStorage.setItem('access_token', signupRes.access_token);

            const primaryTenant = signupRes.tenants?.[0];
            if (primaryTenant) {
                localStorage.setItem('tenant_id', primaryTenant.id);
                if (primaryTenant.stores?.[0]?.id) {
                    localStorage.setItem('store_id', primaryTenant.stores[0].id);
                }
                if (primaryTenant.subscription?.plan?.code) {
                    localStorage.setItem('subscription_plan_code', primaryTenant.subscription.plan.code);
                }
            }

            router.push('/dashboard');
        } catch (err: any) {
            setError(err.message || 'Signup failed.');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-[#f9fafb] p-4 font-sans text-[#111827]">
            <div className="w-full max-w-2xl">
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 md:p-10">
                    <div className="flex flex-col items-center mb-8">
                        <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center mb-4 shadow-lg shadow-blue-200">
                            <Building2 className="text-white w-6 h-6" />
                        </div>
                        <h1 className="text-2xl font-bold tracking-tight">Create your Retail SaaS workspace</h1>
                        <p className="text-gray-500 mt-2 text-sm">Set up your organization, first store, and plan in one flow</p>
                    </div>

                    {error && (
                        <div className="mb-6 p-3 bg-red-50 border border-red-100 text-red-600 text-sm rounded-xl text-center">
                            {error}
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-5">
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-gray-700 ml-1">Your name</label>
                            <div className="relative">
                                <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
                                <input value={form.name} onChange={(e) => handleChange('name', e.target.value)} required className="w-full bg-gray-50 border border-gray-200 rounded-xl py-3 pl-10 pr-4 outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" placeholder="Nayeem Ahmed" />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium text-gray-700 ml-1">Email address</label>
                            <div className="relative">
                                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
                                <input type="email" value={form.email} onChange={(e) => handleChange('email', e.target.value)} required className="w-full bg-gray-50 border border-gray-200 rounded-xl py-3 pl-10 pr-4 outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" placeholder="owner@company.com" />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium text-gray-700 ml-1">Password</label>
                            <div className="relative">
                                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
                                <input type="password" value={form.password} onChange={(e) => handleChange('password', e.target.value)} required minLength={8} className="w-full bg-gray-50 border border-gray-200 rounded-xl py-3 pl-10 pr-4 outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" placeholder="At least 8 characters" />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium text-gray-700 ml-1">Organization name</label>
                            <div className="relative">
                                <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
                                <input value={form.tenantName} onChange={(e) => handleChange('tenantName', e.target.value)} required className="w-full bg-gray-50 border border-gray-200 rounded-xl py-3 pl-10 pr-4 outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" placeholder="Dhaka Retail Co." />
                            </div>
                        </div>

                        <div className="space-y-2 md:col-span-2">
                            <label className="text-sm font-medium text-gray-700 ml-1">Primary store name</label>
                            <div className="relative">
                                <Store className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
                                <input value={form.storeName} onChange={(e) => handleChange('storeName', e.target.value)} required className="w-full bg-gray-50 border border-gray-200 rounded-xl py-3 pl-10 pr-4 outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" placeholder="Gulshan Branch" />
                            </div>
                        </div>

                        <div className="md:col-span-2 space-y-3">
                            <label className="text-sm font-medium text-gray-700 ml-1">Plan</label>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {(plans.length > 0 ? plans : [
                                    { code: 'FREE', name: 'Free', description: 'Starter plan for single-store onboarding', monthly_price: 0 },
                                    { code: 'BASIC', name: 'Basic', description: 'Core operations for small teams', monthly_price: 499 },
                                    { code: 'STANDARD', name: 'Standard', description: 'Multi-branch operations with analytics', monthly_price: 999 },
                                    { code: 'PREMIUM', name: 'Premium', description: 'Full suite with advanced controls', monthly_price: 1499 },
                                ]).map((plan) => {
                                    const selected = form.planCode === plan.code;
                                    return (
                                        <button
                                            type="button"
                                            key={plan.code}
                                            onClick={() => handleChange('planCode', plan.code)}
                                            className={`rounded-2xl border p-4 text-left transition-all ${selected ? 'border-blue-600 bg-blue-50 shadow-blue-100 shadow-lg' : 'border-gray-200 bg-white hover:border-gray-300'}`}
                                        >
                                            <div className="flex items-center justify-between">
                                                <p className="font-bold text-gray-900">{plan.name}</p>
                                                <span className="text-xs font-bold uppercase tracking-widest text-gray-500">{plan.code}</span>
                                            </div>
                                            <p className="mt-2 text-sm text-gray-500">{plan.description}</p>
                                            <p className="mt-3 text-lg font-black text-gray-900">{formatBDT(plan.monthly_price)}<span className="text-xs font-bold text-gray-400 ml-1">/ month</span></p>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        <div className="md:col-span-2">
                            <button type="submit" disabled={isLoading} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl shadow-lg shadow-blue-200 active:scale-[0.98] transition-all duration-200 flex items-center justify-center space-x-2 disabled:opacity-70 disabled:cursor-not-allowed group">
                                {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <><span>Create workspace</span><ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" /></>}
                            </button>
                        </div>
                    </form>

                    <div className="mt-8 text-center text-sm text-gray-500">
                        Already have an account? <Link href="/login" className="font-medium text-blue-600 hover:text-blue-700 transition-colors">Sign in</Link>
                    </div>
                </div>
            </div>
        </div>
    );
}