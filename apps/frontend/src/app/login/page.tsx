'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Lock, Mail, ArrowRight, Loader2, PlayCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { storeAuthResponse } from '@/lib/auth-session';
import { safeAppPath } from '@/lib/safe-redirect';
import { normalizeWorkspaceSlug } from '@/lib/workspace-slug';
import { useI18n } from '@/lib/i18n';
import BrandLogo from '@/components/BrandLogo';
import GoogleSignInButton from '@/components/GoogleSignInButton';
import MobileSignInPanel from '@/components/MobileSignInPanel';
import { CURRENT_TERMS_VERSION } from '@erp71/shared-types';
import { routes } from '@/lib/routes';
import { useHydrated } from '@/hooks/useHydrated';

type FormSubmitEvent = Parameters<NonNullable<React.ComponentProps<'form'>['onSubmit']>>[0];

function LoginPageContent() {
    const { t } = useI18n();
    // Holds an email address or a mobile number; the backend picks the lookup
    // column by looking for an `@`.
    const [identifier, setIdentifier] = useState('');
    const [password, setPassword] = useState('');
    const [rememberMe, setRememberMe] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isDemoLoading, setIsDemoLoading] = useState(false);
    const [isGoogleLoading, setIsGoogleLoading] = useState(false);
    const [googleAvailable, setGoogleAvailable] = useState(false);
    const [mobileAvailable, setMobileAvailable] = useState(false);
    const [twoFactorUserId, setTwoFactorUserId] = useState<string | null>(null);
    const [twoFactorCode, setTwoFactorCode] = useState('');
    const router = useRouter();
    const searchParams = useSearchParams();
    // The server-rendered form is typable before React attaches its handlers;
    // until then a submit would natively reload the page. See useHydrated.
    const hydrated = useHydrated();
    const postAuthPath = safeAppPath(searchParams.get('redirect'), routes.home);
    // A workspace named in the URL — set by `/w/<slug>` links, and by anything
    // that wants a shop owner with several shops to land in a specific one.
    const workspaceSlug = normalizeWorkspaceSlug(searchParams.get('workspace'));
    // Set when an expired token bounced the user out of the app, so the login
    // screen explains why they are here instead of looking like a random logout.
    const sessionExpired = searchParams.get('reason') === 'expired';

    // The auth helper tells us where to land (a shop dashboard, the admin
    // console, or the account chooser). Preserve what the user came in with:
    // honour `?redirect=` once a single workspace is resolved, and carry both it
    // and `?workspace=` through the chooser so they still apply after selection.
    // A workspace that *did* resolve never reaches the chooser at all — the auth
    // helper entered it and returned the dashboard.
    const resolveDestination = (redirectTo: string) => {
        if (redirectTo === routes.selectAccount) {
            const params = new URLSearchParams();
            if (workspaceSlug) params.set('workspace', workspaceSlug);
            if (postAuthPath !== routes.home) params.set('redirect', postAuthPath);
            const query = params.toString();
            return query ? `${routes.selectAccount}?${query}` : routes.selectAccount;
        }
        if (redirectTo === routes.home) {
            return postAuthPath;
        }
        return redirectTo;
    };

    // Auto-trigger demo login when ?demo=1 is present in the URL
    useEffect(() => {
        if (searchParams.get('demo') === '1') {
            handleDemoLogin();
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const submitLogin = async (e: FormSubmitEvent) => {
        e.preventDefault();
        setIsLoading(true);
        setError(null);

        try {
            const loginRes = await api.login({ identifier, password });
            if (loginRes?.requires_2fa && loginRes?.user_id) {
                setTwoFactorUserId(loginRes.user_id);
                return;
            }
            const { redirectTo } = await storeAuthResponse(loginRes, rememberMe, { workspaceSlug });
            router.push(resolveDestination(redirectTo));
        } catch (err: any) {
            setError(err.message || t.auth.login.defaultError);
        } finally {
            setIsLoading(false);
        }
    };

    const submitTwoFactor = async (e: FormSubmitEvent) => {
        e.preventDefault();
        if (!twoFactorUserId) return;
        setIsLoading(true);
        setError(null);
        try {
            const loginRes = await api.verify2FALogin(twoFactorUserId, twoFactorCode);
            const { redirectTo } = await storeAuthResponse(loginRes, rememberMe, { workspaceSlug });
            router.push(resolveDestination(redirectTo));
        } catch (err: any) {
            setError(err.message || t.auth.login.defaultError);
        } finally {
            setIsLoading(false);
        }
    };

    const handleLogin: React.ComponentProps<'form'>['onSubmit'] = (e) => {
        void submitLogin(e);
    };

    const handleTwoFactor: React.ComponentProps<'form'>['onSubmit'] = (e) => {
        void submitTwoFactor(e);
    };

    const handleGoogleCredential = async (credential: string) => {
        setIsGoogleLoading(true);
        setError(null);
        try {
            // This button signs an unknown Google account *up*, so it carries the
            // same consent the signup form's checkbox collects. The notice under
            // the buttons is what the visitor is agreeing to here.
            const authRes = await api.googleSignIn({
                credential,
                acceptedTermsVersion: CURRENT_TERMS_VERSION,
            });
            if (authRes?.requires_2fa && authRes?.user_id) {
                // Google proved the identity; the authenticator app still has to.
                setTwoFactorUserId(authRes.user_id);
                return;
            }
            const { redirectTo } = await storeAuthResponse(authRes, rememberMe, { workspaceSlug });
            // A first-time Google account has no workspace yet — the wizard
            // collects the organization details a password signup asks for upfront.
            router.push(authRes?.requires_workspace ? routes.onboarding : resolveDestination(redirectTo));
        } catch (err: any) {
            setError(err.message || t.auth.login.googleFailed);
        } finally {
            setIsGoogleLoading(false);
        }
    };

    /**
     * The SMS code has already been verified by the time this runs — `authRes`
     * is an ERP71 session (or a 2FA challenge), exactly like the Google path.
     */
    const handleMobileAuth = async (authRes: any) => {
        if (authRes?.requires_2fa && authRes?.user_id) {
            setTwoFactorUserId(authRes.user_id);
            return;
        }
        const { redirectTo } = await storeAuthResponse(authRes, rememberMe, { workspaceSlug });
        router.push(authRes?.requires_workspace ? routes.onboarding : resolveDestination(redirectTo));
    };

    const handleDemoLogin = async () => {
        setIsDemoLoading(true);
        setError(null);

        try {
            const auth = await api.demoLogin();
            await storeAuthResponse(auth, true); // demo always persists
            localStorage.removeItem('onboarding_complete');
            router.push('/dashboard/onboarding');
        } catch (err: any) {
            setError(err.message || t.auth.login.demoFailed);
        } finally {
            setIsDemoLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-canvas p-4 font-sans text-gray-900">
            <div className="w-full max-w-md">
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 md:p-10">
                    <div className="flex flex-col items-center mb-8">
                        {/* The full lockup rather than the mark on a tile: the mark's
                            outline cubes lose all definition below ~40px. */}
                        <BrandLogo height={40} className="mb-5" priority />
                        <h1 className="text-2xl font-bold tracking-tight">{t.auth.login.title}</h1>
                        <p className="text-gray-500 mt-2 text-sm">{t.auth.login.description}</p>
                    </div>

                    {sessionExpired && !error && (
                        <output className="block mb-6 p-3 bg-amber-50 border border-amber-100 text-amber-700 text-sm rounded-xl text-center">
                            {t.auth.login.sessionExpired}
                        </output>
                    )}

                    {error && (
                        <div className="mb-6 p-3 bg-red-50 border border-red-100 text-red-600 text-sm rounded-xl text-center animate-in fade-in slide-in-from-top-1">
                            {error}
                        </div>
                    )}

                    {twoFactorUserId ? (
                    <form onSubmit={handleTwoFactor} className="space-y-6">
                        <p className="text-sm text-gray-600 text-center">Enter the 6-digit code from your authenticator app.</p>
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-gray-700 ms-1">Authentication code</label>
                            <input
                                type="text"
                                inputMode="numeric"
                                pattern="[0-9]{6}"
                                maxLength={6}
                                required
                                value={twoFactorCode}
                                onChange={(e) => setTwoFactorCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                className="w-full bg-gray-50 border border-gray-200 rounded-xl py-3 px-4 text-center tracking-[0.4em] font-mono text-lg outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                                placeholder="000000"
                            />
                        </div>
                        <button
                            type="submit"
                            disabled={!hydrated || isLoading || twoFactorCode.length !== 6}
                            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl shadow-lg shadow-blue-200 disabled:opacity-70"
                        >
                            {isLoading ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : 'Verify and sign in'}
                        </button>
                        <button type="button" onClick={() => { setTwoFactorUserId(null); setTwoFactorCode(''); }} className="w-full text-sm text-gray-500 hover:text-gray-800">
                            Back to password login
                        </button>
                    </form>
                    ) : (
                    <form onSubmit={handleLogin} className="space-y-6">
                        <div className="space-y-2">
                            <label htmlFor="login-identifier" className="text-sm font-medium text-gray-700 ms-1">{t.auth.login.identifierLabel}</label>
                            <div className="relative">
                                <Mail className="absolute start-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
                                {/* type="text", not "email": the browser would otherwise reject a
                                    mobile number as malformed before the form ever submits. */}
                                <input
                                    id="login-identifier"
                                    type="text"
                                    autoComplete="username"
                                    required
                                    value={identifier}
                                    onChange={(e) => setIdentifier(e.target.value)}
                                    className="w-full bg-gray-50 border border-gray-200 rounded-xl py-3 ps-10 pe-4 outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all duration-200"
                                    placeholder={t.auth.login.identifierPlaceholder}
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label htmlFor="login-password" className="text-sm font-medium text-gray-700 ms-1">{t.auth.login.passwordLabel}</label>
                            <div className="relative">
                                <Lock className="absolute start-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
                                <input
                                    id="login-password"
                                    type="password"
                                    required
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    className="w-full bg-gray-50 border border-gray-200 rounded-xl py-3 ps-10 pe-4 outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all duration-200"
                                    placeholder="••••••••"
                                />
                            </div>
                        </div>

                        <div className="flex items-center justify-between text-sm">
                            <label className="flex items-center space-x-2 rtl:space-x-reverse cursor-pointer group">
                                <input
                                    type="checkbox"
                                    checked={rememberMe}
                                    onChange={(e) => setRememberMe(e.target.checked)}
                                    className="w-4 h-4 rounded-sm border-gray-300 text-blue-600 focus:ring-blue-500"
                                />
                                <span className="text-gray-600 group-hover:text-gray-900 transition-colors">{t.common.rememberMe}</span>
                            </label>
                            <Link href="/forgot-password" className="font-medium text-blue-600 hover:text-blue-700 transition-colors">{t.common.forgotPassword}</Link>
                        </div>

                        <button
                            type="submit"
                            disabled={!hydrated || isLoading || isDemoLoading || isGoogleLoading}
                            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl shadow-lg shadow-blue-200 active:scale-[0.98] transition-all duration-200 flex items-center justify-center space-x-2 rtl:space-x-reverse disabled:opacity-70 disabled:cursor-not-allowed group"
                        >
                            {isLoading || !hydrated ? (
                                <Loader2 className="w-5 h-5 animate-spin" />
                            ) : (
                                <>
                                    <span>{t.auth.login.submit}</span>
                                    <ArrowRight className="w-4 h-4 group-hover:translate-x-1 rtl:-scale-x-100 rtl:group-hover:-translate-x-1 transition-transform" />
                                </>
                            )}
                        </button>
                    </form>
                    )}

                    {/* Divider */}
                    <div className="my-6 flex items-center gap-3">
                        <div className="flex-1 h-px bg-gray-200" />
                        <span className="text-xs text-gray-400 font-medium uppercase tracking-wider">{t.auth.login.dividerOr}</span>
                        <div className="flex-1 h-px bg-gray-200" />
                    </div>

                    {/* Both render nothing unless the backend is configured for them. */}
                    {!twoFactorUserId && (
                        <div className={googleAvailable ? 'mb-3' : ''}>
                            <GoogleSignInButton
                                onCredential={handleGoogleCredential}
                                onError={setError}
                                onAvailabilityChange={setGoogleAvailable}
                                text="signin_with"
                                busy={isGoogleLoading}
                                disabled={isLoading || isDemoLoading}
                            />
                        </div>
                    )}

                    {!twoFactorUserId && (
                        <div className={mobileAvailable ? 'mb-3' : ''}>
                            <MobileSignInPanel
                                onSuccess={handleMobileAuth}
                                onError={setError}
                                onAvailabilityChange={setMobileAvailable}
                                // An unrecognised number is signed up rather than
                                // turned away, so this path needs consent too.
                                signUpFields={() => ({ acceptedTermsVersion: CURRENT_TERMS_VERSION })}
                                disabled={isLoading || isDemoLoading || isGoogleLoading}
                            />
                        </div>
                    )}

                    {/* Neither button asks for a plan, so no tier addendum applies
                        here — the tier is chosen in the onboarding wizard, which is
                        where a workspace created this way gets one. Shown only when
                        a button that can create an account is actually rendered. */}
                    {!twoFactorUserId && (googleAvailable || mobileAvailable) && (
                        <p className="mb-3 text-center text-xs leading-relaxed text-gray-400">
                            {t.auth.login.termsNotice}{' '}
                            <Link href="/terms" className="text-blue-600 hover:underline font-medium">
                                {t.auth.signup.termsLink}
                            </Link>
                            {' '}{t.auth.signup.and}{' '}
                            <Link href="/privacy" className="text-blue-600 hover:underline font-medium">
                                {t.auth.signup.privacyLink}
                            </Link>.
                        </p>
                    )}

                    {/* Try Demo button */}
                    <button
                        type="button"
                        onClick={handleDemoLogin}
                        disabled={!hydrated || isLoading || isDemoLoading || isGoogleLoading}
                        className="w-full bg-white hover:bg-gray-50 text-gray-700 font-semibold py-3 rounded-xl border border-gray-200 active:scale-[0.98] transition-all duration-200 flex items-center justify-center space-x-2 rtl:space-x-reverse disabled:opacity-70 disabled:cursor-not-allowed"
                    >
                        {isDemoLoading ? (
                            <Loader2 className="w-5 h-5 animate-spin" />
                        ) : (
                            <>
                                <PlayCircle className="w-5 h-5 text-blue-500" />
                                <span>{t.auth.login.demo}</span>
                            </>
                        )}
                    </button>
                    <p className="mt-2 text-center text-xs text-gray-400">
                        {t.auth.login.demoDescription}
                    </p>

                    <div className="mt-6 text-center text-sm text-gray-500">
                        {t.auth.login.noAccount} <Link href="/signup" className="font-medium text-blue-600 hover:text-blue-700 transition-colors">{t.auth.login.signUpForFree}</Link>
                    </div>
                </div>

                <p className="mt-8 text-center text-xs text-gray-400 uppercase tracking-widest font-semibold">
                    {t.auth.login.version}
                </p>
            </div>
        </div>
    );
}

export default function LoginPage() {
    return (
        <Suspense>
            <LoginPageContent />
        </Suspense>
    );
}