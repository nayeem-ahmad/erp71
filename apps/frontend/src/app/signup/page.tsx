'use client';

import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowRight, Building2, Loader2, Lock, Mail, Store } from 'lucide-react';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { syncLocalePreferenceFromSession } from '@/lib/localization/preference';

type Plan = {
    code: 'FREE' | 'BASIC' | 'STANDARD' | 'PREMIUM';
    name: string;
    description?: string | null;
    monthly_price: number;
};

type FormSubmitEvent = Parameters<NonNullable<React.ComponentProps<'form'>['onSubmit']>>[0];

export default function SignupPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
            </div>
        }>
            <SignupPageContent />
        </Suspense>
    );
}

function SignupPageContent() {
    const { t } = useI18n();
    const router = useRouter();
    const searchParams = useSearchParams();
    const postAuthPath = (() => {
        const redirect = searchParams.get('redirect');
        if (redirect && redirect.startsWith('/')) return redirect;
        return '/dashboard/onboarding';
    })();
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

    const submitSignup = async (e: FormSubmitEvent) => {
        e.preventDefault();
        setIsLoading(true);
        setError(null);

        try {
            const signupRes = await api.signup(form);
            localStorage.setItem('access_token', signupRes.access_token);
            syncLocalePreferenceFromSession(signupRes, { overwrite: true });

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

            if (signupRes.requires_email_verification) {
                router.push(`/verify-email?pending=1&email=${encodeURIComponent(form.email)}`);
                return;
            }

            router.push(postAuthPath);
        } catch (err: any) {
            setError(err.message || t.auth.signup.defaultError);
        } finally {
            setIsLoading(false);
        }
    };

    const handleSubmit: React.ComponentProps<'form'>['onSubmit'] = (e) => {
        void submitSignup(e);
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-[#f9fafb] p-4 font-sans text-[#111827]">
            <div className="w-full max-w-2xl">
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 md:p-10">
                    <div className="flex flex-col items-center mb-8">
                        <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center mb-4 shadow-lg shadow-blue-200">
                            <Building2 className="text-white w-6 h-6" />
                        </div>
                        <h1 className="text-2xl font-bold tracking-tight">{t.auth.signup.title}</h1>
                        <p className="text-gray-500 mt-2 text-sm">{t.auth.signup.description}</p>
                    </div>

                    {error && (
                        <div className="mb-6 p-3 bg-red-50 border border-red-100 text-red-600 text-sm rounded-xl text-center">
                            {error}
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-5">
                        <div className="space-y-2">
                            <label htmlFor="signup-name" className="text-sm font-medium text-gray-700 ml-1">{t.auth.signup.nameLabel}</label>
                            <div className="relative">
                                <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
                                <input id="signup-name" value={form.name} onChange={(e) => handleChange('name', e.target.value)} required className="w-full bg-gray-50 border border-gray-200 rounded-xl py-3 pl-10 pr-4 outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" placeholder="Nayeem Ahmed" />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label htmlFor="signup-email" className="text-sm font-medium text-gray-700 ml-1">{t.auth.signup.emailLabel}</label>
                            <div className="relative">
                                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
                                <input id="signup-email" type="email" value={form.email} onChange={(e) => handleChange('email', e.target.value)} required className="w-full bg-gray-50 border border-gray-200 rounded-xl py-3 pl-10 pr-4 outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" placeholder="owner@company.com" />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label htmlFor="signup-password" className="text-sm font-medium text-gray-700 ml-1">{t.auth.signup.passwordLabel}</label>
                            <div className="relative">
                                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
                                <input id="signup-password" type="password" value={form.password} onChange={(e) => handleChange('password', e.target.value)} required minLength={8} className="w-full bg-gray-50 border border-gray-200 rounded-xl py-3 pl-10 pr-4 outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" placeholder="At least 8 characters" />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label htmlFor="signup-organization" className="text-sm font-medium text-gray-700 ml-1">{t.auth.signup.organizationLabel}</label>
                            <div className="relative">
                                <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
                                <input id="signup-organization" value={form.tenantName} onChange={(e) => handleChange('tenantName', e.target.value)} required className="w-full bg-gray-50 border border-gray-200 rounded-xl py-3 pl-10 pr-4 outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" placeholder="Dhaka Retail Co." />
                            </div>
                        </div>

                        <div className="space-y-2 md:col-span-2">
                            <label htmlFor="signup-store" className="text-sm font-medium text-gray-700 ml-1">{t.auth.signup.storeLabel}</label>
                            <div className="relative">
                                <Store className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
                                <input id="signup-store" value={form.storeName} onChange={(e) => handleChange('storeName', e.target.value)} required className="w-full bg-gray-50 border border-gray-200 rounded-xl py-3 pl-10 pr-4 outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" placeholder="Gulshan Branch" />
                            </div>
                        </div>

                        <div className="md:col-span-2 space-y-3">
                            <label className="text-sm font-medium text-gray-700 ml-1">{t.auth.signup.planLabel}</label>
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
                                            <p className="mt-3 text-lg font-black text-gray-900">{formatBDT(plan.monthly_price)}<span className="text-xs font-bold text-gray-400 ml-1">{t.auth.signup.monthSuffix}</span></p>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        <p className="md:col-span-2 text-xs text-gray-400 text-center leading-relaxed">
                            {t.auth.signup.termsPrefix}{' '}
                            <Link href="/terms" className="text-blue-600 hover:underline font-medium">{t.auth.signup.termsLink}</Link>
                            {' '}{t.auth.signup.and}{' '}
                            <Link href="/privacy" className="text-blue-600 hover:underline font-medium">{t.auth.signup.privacyLink}</Link>.
                        </p>

                        <div className="md:col-span-2">
                            <button type="submit" disabled={isLoading} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl shadow-lg shadow-blue-200 active:scale-[0.98] transition-all duration-200 flex items-center justify-center space-x-2 disabled:opacity-70 disabled:cursor-not-allowed group">
                                {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <><span>{t.auth.signup.submit}</span><ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" /></>}
                            </button>
                        </div>
                    </form>

                    <div className="mt-8 text-center text-sm text-gray-500">
                        {t.auth.signup.alreadyHaveAccount} <Link href="/login" className="font-medium text-blue-600 hover:text-blue-700 transition-colors">{t.auth.signup.signIn}</Link>
                    </div>
                </div>
            </div>
        </div>
    );
}