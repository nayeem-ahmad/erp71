'use client';

import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowRight, Building2, Gift, Loader2, Lock, Mail } from 'lucide-react';
import { api } from '@/lib/api';
import { recallReferralCode, rememberReferralCode, clearReferralCode } from '@/lib/referral-attribution';
import { formatBDT } from '@/lib/format';
import { formatMessage, useI18n } from '@/lib/i18n';
import { syncLocalePreferenceFromSession } from '@/lib/localization/preference';
import {
    DEFAULT_MOBILE_COUNTRY_CODE,
    isComingSoonSubscriptionPlan,
    isSelfServeSubscriptionPlan,
    normalizeMobileToE164,
} from '@erp71/shared-types';
import BrandLogo from '@/components/BrandLogo';
import PhoneNumberField from '@/components/PhoneNumberField';
import GoogleSignInButton from '@/components/GoogleSignInButton';
import MobileSignInPanel from '@/components/MobileSignInPanel';
import { storeAuthResponse } from '@/lib/auth-session';
import { routes } from '@/lib/routes';
import { useHydrated } from '@/hooks/useHydrated';
import { setCredentials, setLastTenantId, setWorkspaceItem } from '@/lib/session-store';
import { ACCOUNTING_EDITION, MARKETING_PLANS } from '@/lib/marketing/plans';

/**
 * Both the plan codes and the marketing slugs, because the pricing page links by
 * slug and the ladder was renamed. The old slugs stay mapped indefinitely: they
 * are in ad campaigns, bookmarks and anything already linking to us, and a stale
 * `?plan=basic` should still land on the right plan rather than silently
 * defaulting.
 */
const PLAN_QUERY_TO_CODE: Record<string, Plan['code']> = {
    basic: 'BASIC',
    starter: 'BASIC',
    accounting: 'ACCOUNTING',
    standard: 'STANDARD',
    growth: 'STANDARD',
    premium: 'PREMIUM',
    business: 'PREMIUM',
};

/**
 * Shown only when `GET /auth/plans` is unreachable. Derived from the marketing
 * constants rather than retyped, because this used to be a second hardcoded
 * price table that had already drifted from the first.
 */
const FALLBACK_PLANS: Plan[] = [
    ...MARKETING_PLANS.filter((plan) => plan.code && !plan.contactSales).map((plan) => ({
        code: plan.code as Plan['code'],
        name: plan.name,
        description: plan.tagline,
        monthly_price: plan.monthlyPrice,
    })),
    {
        code: 'ACCOUNTING' as const,
        name: ACCOUNTING_EDITION.name,
        description: ACCOUNTING_EDITION.tagline,
        monthly_price: ACCOUNTING_EDITION.monthlyPrice,
    },
];

type Plan = {
    code: 'FREE' | 'BASIC' | 'ACCOUNTING' | 'STANDARD' | 'PREMIUM';
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
        email: '',
        password: '',
        mobile: '',
        mobile_country_code: DEFAULT_MOBILE_COUNTRY_CODE,
        tenantName: '',
        planCode: 'STANDARD' as Plan['code'],
        referralCode: '',
    });
    const [isLoading, setIsLoading] = useState(false);
    const [isGoogleLoading, setIsGoogleLoading] = useState(false);
    const [googleAvailable, setGoogleAvailable] = useState(false);
    const [mobileAvailable, setMobileAvailable] = useState(false);
    // Guards against a native form submit before React hydrates — see useHydrated.
    const hydrated = useHydrated();
    const [error, setError] = useState<string | null>(null);
    const [referralStatus, setReferralStatus] = useState<'idle' | 'checking' | 'valid' | 'invalid'>('idle');
    const [referralDiscount, setReferralDiscount] = useState<number | null>(null);
    const [referralName, setReferralName] = useState('');

    useEffect(() => {
        api.getSubscriptionPlans()
            .then((loadedPlans) => {
                const paidPlans = (Array.isArray(loadedPlans) ? loadedPlans : [])
                    .filter((plan: Plan) => isSelfServeSubscriptionPlan(plan.code, plan.monthly_price));
                setPlans(paidPlans);
            })
            .catch(() => null);
    }, []);

    useEffect(() => {
        api.getSignupDefaults()
            .then((defaults: { defaultPlanCode?: Plan['code'] }) => {
                const requested = searchParams.get('plan');
                const requestedCode = requested ? PLAN_QUERY_TO_CODE[requested.toLowerCase()] : undefined;
                const hasValidQueryPlan = !!requestedCode
                    && isSelfServeSubscriptionPlan(requestedCode)
                    && !isComingSoonSubscriptionPlan(requestedCode);
                if (hasValidQueryPlan) return; // ?plan= wins
                if (defaults?.defaultPlanCode) {
                    setForm((current) => ({ ...current, planCode: defaults.defaultPlanCode as Plan['code'] }));
                }
            })
            .catch(() => null);
    }, [searchParams]);

    useEffect(() => {
        const requestedPlan = searchParams.get('plan');
        if (!requestedPlan) {
            return;
        }

        const resolvedCode = PLAN_QUERY_TO_CODE[requestedPlan.toLowerCase()];
        if (resolvedCode && isSelfServeSubscriptionPlan(resolvedCode) && !isComingSoonSubscriptionPlan(resolvedCode)) {
            setForm((current) => ({ ...current, planCode: resolvedCode }));
        }
    }, [searchParams]);

    useEffect(() => {
        const referralFromUrl = searchParams.get('ref') || searchParams.get('referral');
        if (referralFromUrl) {
            const normalized = referralFromUrl.trim().toUpperCase();
            // Remember it so a visitor who leaves and comes back later is still
            // attributed to the partner who sent them.
            rememberReferralCode(normalized);
            setForm((current) => ({ ...current, referralCode: normalized }));
            return;
        }

        const remembered = recallReferralCode();
        if (remembered) {
            setForm((current) => (
                current.referralCode ? current : { ...current, referralCode: remembered }
            ));
        }
    }, [searchParams]);

    useEffect(() => {
        const code = form.referralCode.trim();
        if (!code) {
            setReferralStatus('idle');
            setReferralDiscount(null);
            setReferralName('');
            return;
        }

        setReferralStatus('checking');
        const timer = window.setTimeout(() => {
            api.validateReferralCode(code)
                .then((result: { valid?: boolean; discount_pct?: number; referee_name?: string }) => {
                    if (result?.valid) {
                        setReferralStatus('valid');
                        setReferralDiscount(result.discount_pct ?? null);
                        setReferralName(result.referee_name ?? '');
                    } else {
                        setReferralStatus('invalid');
                        setReferralDiscount(null);
                        setReferralName('');
                    }
                })
                .catch(() => {
                    setReferralStatus('invalid');
                    setReferralDiscount(null);
                    setReferralName('');
                });
        }, 400);

        return () => window.clearTimeout(timer);
    }, [form.referralCode]);

    const handleChange = (field: keyof typeof form, value: string) => {
        setForm((current) => ({ ...current, [field]: value }));
    };

    const submitSignup = async (e: FormSubmitEvent) => {
        e.preventDefault();
        setError(null);

        if (!form.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
            setError(t.auth.signup.emailInvalid);
            return;
        }
        if (form.password.length < 8) {
            setError(t.auth.signup.passwordTooShort);
            return;
        }
        if (!form.tenantName.trim()) {
            setError(t.auth.signup.orgNameRequired);
            return;
        }
        if (form.mobile.trim() && !normalizeMobileToE164(form.mobile_country_code, form.mobile)) {
            setError(t.auth.signup.mobileInvalid);
            return;
        }

        setIsLoading(true);

        try {
            const signupRes = await api.signup({
                ...form,
                referralCode: form.referralCode.trim() || undefined,
            });
            setCredentials(signupRes);
            // The remembered code has done its job. Leaving it would silently attach
            // the same partner to an unrelated signup from this browser weeks later.
            clearReferralCode();
            syncLocalePreferenceFromSession(signupRes, { overwrite: true });

            const primaryTenant = signupRes.tenants?.[0];
            if (primaryTenant) {
                setWorkspaceItem('tenant_id', primaryTenant.id);
                // Without this a new tab would resume whichever shop the last
                // account signed into on this browser was in.
                setLastTenantId(primaryTenant.id);
                if (primaryTenant.stores?.[0]?.id) {
                    setWorkspaceItem('store_id', primaryTenant.stores[0].id);
                }
                if (primaryTenant.subscription?.plan?.code) {
                    setWorkspaceItem('subscription_plan_code', primaryTenant.subscription.plan.code);
                }
            }

            if (signupRes.requires_email_verification) {
                router.push(`/verify-email?pending=1&email=${encodeURIComponent(form.email)}`);
                return;
            }

            router.push(postAuthPath);
        } catch (err: any) {
            const msg: string = err.message || '';
            if (/email already exists/i.test(msg)) {
                setError(t.auth.signup.emailTaken);
            } else if (/email/i.test(msg) && /valid/i.test(msg)) {
                setError(t.auth.signup.emailInvalid);
            } else if (/password.*8|8.*character/i.test(msg)) {
                setError(t.auth.signup.passwordTooShort);
            } else {
                setError(msg || t.auth.signup.defaultError);
            }
        } finally {
            setIsLoading(false);
        }
    };

    const handleSubmit: React.ComponentProps<'form'>['onSubmit'] = (e) => {
        void submitSignup(e);
    };

    /**
     * Google's button is an iframe, so the form can't be validated before the
     * click. Instead we send whatever the visitor has already filled in: with an
     * organization name the workspace is provisioned immediately, and without one
     * the backend says `requires_workspace` and the onboarding wizard collects it.
     */
    const handleGoogleCredential = async (credential: string) => {
        setIsGoogleLoading(true);
        setError(null);
        try {
            const authRes = await api.googleSignIn({
                credential,
                tenantName: form.tenantName.trim() || undefined,
                planCode: form.planCode,
                referralCode: form.referralCode.trim() || undefined,
                mobile: form.mobile.trim() || undefined,
                mobile_country_code: form.mobile_country_code,
            });

            if (authRes?.requires_2fa) {
                // An existing account with 2FA clicked "sign up" — the code prompt
                // lives on the login page.
                router.push('/login');
                return;
            }

            const { redirectTo } = await storeAuthResponse(authRes, true);
            clearReferralCode();

            if (authRes?.requires_workspace) {
                router.push(routes.onboarding);
                return;
            }
            router.push(authRes?.is_new_user ? postAuthPath : redirectTo);
        } catch (err: any) {
            setError(err.message || t.auth.signup.googleFailed);
        } finally {
            setIsGoogleLoading(false);
        }
    };

    /**
     * Whatever the visitor has already typed travels with the verified number,
     * so a filled-in form provisions the workspace in the same round trip. The
     * panel asks for an email itself only if this one is still blank.
     */
    const mobileSignUpFields = () => ({
        email: form.email.trim() || undefined,
        tenantName: form.tenantName.trim() || undefined,
        planCode: form.planCode,
        referralCode: form.referralCode.trim() || undefined,
    });

    const handleMobileAuth = async (authRes: any) => {
        if (authRes?.requires_2fa) {
            // An existing account with 2FA used the signup page — the code
            // prompt lives on the login page.
            router.push('/login');
            return;
        }

        const { redirectTo } = await storeAuthResponse(authRes, true);
        clearReferralCode();

        if (authRes?.requires_workspace) {
            router.push(routes.onboarding);
            return;
        }
        router.push(authRes?.is_new_user ? postAuthPath : redirectTo);
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-canvas p-4 font-sans text-gray-900">
            <div className="w-full max-w-2xl">
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 md:p-10">
                    <div className="flex flex-col items-center mb-8">
                        <BrandLogo height={40} className="mb-5" priority />
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
                            <label htmlFor="signup-email" className="text-sm font-medium text-gray-700 ms-1">{t.auth.signup.emailLabel}</label>
                            <div className="relative">
                                <Mail className="absolute start-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
                                <input id="signup-email" type="email" value={form.email} onChange={(e) => handleChange('email', e.target.value)} required className="w-full bg-gray-50 border border-gray-200 rounded-xl py-3 ps-10 pe-4 outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" placeholder="owner@company.com" />
                            </div>
                        </div>

                        <div className="space-y-2 md:col-span-2">
                            <PhoneNumberField
                                countryCode={form.mobile_country_code}
                                mobile={form.mobile}
                                onCountryCodeChange={(value) => handleChange('mobile_country_code', value)}
                                onMobileChange={(value) => handleChange('mobile', value)}
                                countryLabel={t.auth.signup.countryLabel}
                                mobileLabel={t.auth.signup.mobileLabel}
                                mobilePlaceholder={t.auth.signup.mobilePlaceholder}
                                idPrefix="signup"
                            />
                        </div>

                        <div className="space-y-2">
                            <label htmlFor="signup-password" className="text-sm font-medium text-gray-700 ms-1">{t.auth.signup.passwordLabel}</label>
                            <div className="relative">
                                <Lock className="absolute start-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
                                <input id="signup-password" type="password" value={form.password} onChange={(e) => handleChange('password', e.target.value)} required minLength={8} className="w-full bg-gray-50 border border-gray-200 rounded-xl py-3 ps-10 pe-4 outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" placeholder="At least 8 characters" />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label htmlFor="signup-organization" className="text-sm font-medium text-gray-700 ms-1">{t.auth.signup.organizationLabel}</label>
                            <div className="relative">
                                <Building2 className="absolute start-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
                                <input id="signup-organization" value={form.tenantName} onChange={(e) => handleChange('tenantName', e.target.value)} required className="w-full bg-gray-50 border border-gray-200 rounded-xl py-3 ps-10 pe-4 outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" placeholder="Dhaka Retail Co." />
                            </div>
                        </div>

                        <div className="space-y-2 md:col-span-2">
                            <label htmlFor="signup-referral" className="text-sm font-medium text-gray-700 ms-1">{t.auth.signup.referralCodeLabel}</label>
                            <div className="relative">
                                <Gift className="absolute start-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
                                <input
                                    id="signup-referral"
                                    value={form.referralCode}
                                    onChange={(e) => handleChange('referralCode', e.target.value.toUpperCase())}
                                    className="w-full bg-gray-50 border border-gray-200 rounded-xl py-3 ps-10 pe-4 outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 uppercase tracking-wider"
                                    placeholder={t.auth.signup.referralCodePlaceholder}
                                />
                            </div>
                            {referralStatus === 'checking' && (
                                <p className="text-xs text-gray-500 ms-1">{t.auth.signup.referralCodeValidating}</p>
                            )}
                            {referralStatus === 'valid' && referralDiscount !== null && (
                                <p className="text-xs font-medium text-emerald-600 ms-1">
                                    {formatMessage(t.auth.signup.referralCodeValid, {
                                        discount: String(referralDiscount),
                                        name: referralName,
                                    })}
                                </p>
                            )}
                            {referralStatus === 'invalid' && form.referralCode.trim() && (
                                <p className="text-xs font-medium text-red-600 ms-1">{t.auth.signup.referralCodeInvalid}</p>
                            )}
                        </div>

                        <div className="md:col-span-2 space-y-3">
                            <label className="text-sm font-medium text-gray-700 ms-1">{t.auth.signup.planLabel}</label>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {(plans.length > 0 ? plans : FALLBACK_PLANS).map((plan) => {
                                    const selected = form.planCode === plan.code;
                                    return (
                                        <button
                                            type="button"
                                            key={plan.code}
                                            onClick={() => handleChange('planCode', plan.code)}
                                            className={`rounded-2xl border p-4 text-start transition-all ${selected ? 'border-blue-600 bg-blue-50 shadow-blue-100 shadow-lg' : 'border-gray-200 bg-white hover:border-gray-300'}`}
                                        >
                                            <div className="flex items-center justify-between">
                                                <p className="font-bold text-gray-900">{plan.name}</p>
                                                <span className="text-xs font-bold uppercase tracking-widest text-gray-500">{plan.code}</span>
                                            </div>
                                            <p className="mt-2 text-sm text-gray-500">{plan.description}</p>
                                            <p className="mt-3 text-lg font-black text-gray-900">{formatBDT(plan.monthly_price)}<span className="text-xs font-bold text-gray-400 ms-1">{t.auth.signup.monthSuffix}</span></p>
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
                            <button type="submit" disabled={!hydrated || isLoading || isGoogleLoading} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl shadow-lg shadow-blue-200 active:scale-[0.98] transition-all duration-200 flex items-center justify-center space-x-2 rtl:space-x-reverse disabled:opacity-70 disabled:cursor-not-allowed group">
                                {isLoading || !hydrated ? <Loader2 className="w-5 h-5 animate-spin" /> : <><span>{t.auth.signup.submit}</span><ArrowRight className="w-4 h-4 group-hover:translate-x-1 rtl:-scale-x-100 rtl:group-hover:-translate-x-1 transition-transform" /></>}
                            </button>
                        </div>
                    </form>

                    {/* The divider and hint only earn their space once the backend
                        confirms a Google client id is configured. */}
                    {googleAvailable && (
                        <div className="mt-6 flex items-center gap-3">
                            <div className="flex-1 h-px bg-gray-200" />
                            <span className="text-xs text-gray-400 font-medium uppercase tracking-wider">{t.auth.signup.googleDivider}</span>
                            <div className="flex-1 h-px bg-gray-200" />
                        </div>
                    )}
                    <div className={googleAvailable ? 'mt-4' : ''}>
                        <GoogleSignInButton
                            onCredential={handleGoogleCredential}
                            onError={setError}
                            onAvailabilityChange={setGoogleAvailable}
                            text="signup_with"
                            busy={isGoogleLoading}
                            disabled={isLoading}
                        />
                        {googleAvailable && (
                            <p className="mt-2 text-center text-xs text-gray-400">{t.auth.signup.googleHint}</p>
                        )}
                    </div>

                    <div className={mobileAvailable ? 'mt-4' : ''}>
                        <MobileSignInPanel
                            onSuccess={handleMobileAuth}
                            onError={setError}
                            onAvailabilityChange={setMobileAvailable}
                            signUpFields={mobileSignUpFields}
                            intent="signup"
                            disabled={isLoading || isGoogleLoading}
                        />
                    </div>

                    <div className="mt-8 text-center text-sm text-gray-500">
                        {t.auth.signup.alreadyHaveAccount} <Link href="/login" className="font-medium text-blue-600 hover:text-blue-700 transition-colors">{t.auth.signup.signIn}</Link>
                    </div>
                </div>
            </div>
        </div>
    );
}