'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Lock, Mail, ArrowRight, Loader2, PlayCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { storeAuthResponse } from '@/lib/auth-session';
import { useI18n } from '@/lib/i18n';
import BrandLogo from '@/components/BrandLogo';
import GoogleSignInButton from '@/components/GoogleSignInButton';
import MobileSignInPanel from '@/components/MobileSignInPanel';
import { routes } from '@/lib/routes';

type FormSubmitEvent = Parameters<NonNullable<React.ComponentProps<'form'>['onSubmit']>>[0];

function LoginPageContent() {
    const { t } = useI18n();
    const [email, setEmail] = useState('');
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
    const postAuthPath = (() => {
        const redirect = searchParams.get('redirect');
        return redirect && redirect.startsWith('/') ? redirect : '/dashboard';
    })();
    // Set when an expired token bounced the user out of the app, so the login
    // screen explains why they are here instead of looking like a random logout.
    const sessionExpired = searchParams.get('reason') === 'expired';

    // The auth helper tells us where to land (a shop dashboard, the admin
    // console, or the account chooser). Preserve any ?redirect= the user came
    // in with: honour it once a single workspace is resolved, or carry it
    // through the chooser so it applies after selection.
    const resolveDestination = (redirectTo: string) => {
        if (redirectTo === '/select-account') {
            return postAuthPath === '/dashboard'
                ? '/select-account'
                : `/select-account?redirect=${encodeURIComponent(postAuthPath)}`;
        }
        if (redirectTo === '/dashboard') {
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
            const loginRes = await api.login({ email, password });
            if (loginRes?.requires_2fa && loginRes?.user_id) {
                setTwoFactorUserId(loginRes.user_id);
                return;
            }
            const { redirectTo } = await storeAuthResponse(loginRes, rememberMe);
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
            const { redirectTo } = await storeAuthResponse(loginRes, rememberMe);
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
            const authRes = await api.googleSignIn({ credential });
            if (authRes?.requires_2fa && authRes?.user_id) {
                // Google proved the identity; the authenticator app still has to.
                setTwoFactorUserId(authRes.user_id);
                return;
            }
            const { redirectTo } = await storeAuthResponse(authRes, rememberMe);
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
        const { redirectTo } = await storeAuthResponse(authRes, rememberMe);
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
                            disabled={isLoading || twoFactorCode.length !== 6}
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
                            <label htmlFor="login-email" className="text-sm font-medium text-gray-700 ms-1">{t.auth.login.emailLabel}</label>
                            <div className="relative">
                                <Mail className="absolute start-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
                                <input
                                    id="login-email"
                                    type="email"
                                    required
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    className="w-full bg-gray-50 border border-gray-200 rounded-xl py-3 ps-10 pe-4 outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all duration-200"
                                    placeholder="name@company.com"
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
                            disabled={isLoading || isDemoLoading || isGoogleLoading}
                            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl shadow-lg shadow-blue-200 active:scale-[0.98] transition-all duration-200 flex items-center justify-center space-x-2 rtl:space-x-reverse disabled:opacity-70 disabled:cursor-not-allowed group"
                        >
                            {isLoading ? (
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
                        <span className="text-xs text-gray-400 font-medium uppercase tracking-wider">or</span>
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
                                disabled={isLoading || isDemoLoading || isGoogleLoading}
                            />
                        </div>
                    )}

                    {/* Try Demo button */}
                    <button
                        type="button"
                        onClick={handleDemoLogin}
                        disabled={isLoading || isDemoLoading || isGoogleLoading}
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