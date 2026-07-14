'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowRight, CheckCircle2, Loader2, Lock, Mail, Phone, User, UserPlus, XCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { syncLocalePreferenceFromSession } from '@/lib/localization/preference';
import { useI18n, formatMessage } from '@/lib/i18n';

type PageStatus = 'loading' | 'ready' | 'accepting' | 'success' | 'error';

interface InvitationInfo {
    tenantName: string;
    email: string;
    roleName?: string;
    role?: string;
    expiresAt: string;
    hasAccount?: boolean;
}

function AcceptInvitationContent() {
    const { t } = useI18n();
    const m = t.auth.acceptInvitation;
    const searchParams = useSearchParams();
    const router = useRouter();
    const token = searchParams.get('token');
    const [status, setStatus] = useState<PageStatus>('loading');
    const [info, setInfo] = useState<InvitationInfo | null>(null);
    const [errorMessage, setErrorMessage] = useState(m.defaultError);
    const [isLoggedIn, setIsLoggedIn] = useState(false);
    const [currentEmail, setCurrentEmail] = useState<string | null>(null);
    const [name, setName] = useState('');
    const [mobile, setMobile] = useState('');
    const [password, setPassword] = useState('');
    const [formError, setFormError] = useState<string | null>(null);

    useEffect(() => {
        if (!token) {
            setStatus('error');
            setErrorMessage(m.missingToken);
            return;
        }

        const accessToken = localStorage.getItem('access_token');
        setIsLoggedIn(Boolean(accessToken));

        if (accessToken) {
            api.getMe()
                .then((me) => setCurrentEmail(me.email))
                .catch(() => setIsLoggedIn(false));
        }

        api.getInvitationInfo(token)
            .then((data) => {
                setInfo(data);
                setStatus('ready');
            })
            .catch((error: Error) => {
                setErrorMessage(error.message);
                setStatus('error');
            });
    }, [token]);

    const redirectTarget = token
        ? `/accept-invitation?token=${encodeURIComponent(token)}`
        : '/dashboard';

    // Loads the fresh session, selects the joined tenant/store, and redirects.
    // Runs after membership has already been granted (accept or accept-signup).
    const finalizeSession = async () => {
        const me = await api.getMe();
        syncLocalePreferenceFromSession(me, { overwrite: true });

        const matchedTenant = me.tenants?.find((tenant: any) => tenant.name === info?.tenantName)
            || me.tenants?.at(-1);

        if (matchedTenant) {
            localStorage.setItem('tenant_id', matchedTenant.id);
            if (matchedTenant.stores?.[0]?.id) {
                localStorage.setItem('store_id', matchedTenant.stores[0].id);
            }
        }

        setStatus('success');
        setTimeout(() => router.push('/dashboard'), 1500);
    };

    // Already-authenticated invitee clicking "Accept".
    const handleAccept = async () => {
        if (!token) return;
        setStatus('accepting');
        try {
            await api.acceptInvitation(token);
            await finalizeSession();
        } catch (error: any) {
            setErrorMessage(error?.message || m.acceptFailed);
            setStatus('error');
        }
    };

    // Logged-out invitee whose email already has an account: sign in inline, then accept.
    const handleSignInAndAccept = async () => {
        if (!token || !info) return;
        setFormError(null);
        if (!password) {
            setFormError(m.passwordRequired);
            return;
        }
        setStatus('accepting');
        try {
            const res: any = await api.login({ email: info.email, password });
            if (res?.requires_2fa) {
                // Inline sign-in can't complete a 2FA challenge — send them to the full login page.
                setStatus('ready');
                setFormError(m.twoFactorRedirect);
                return;
            }
            localStorage.setItem('access_token', res.access_token);
            setIsLoggedIn(true);
            await api.acceptInvitation(token);
            await finalizeSession();
        } catch (error: any) {
            setStatus('ready');
            setFormError(error?.message || m.acceptFailed);
        }
    };

    // Logged-out invitee with no account: create the account (joins the tenant), then sign in.
    const handleCreateAndAccept = async () => {
        if (!token || !info) return;
        setFormError(null);
        if (!name.trim() || !mobile.trim() || !password) {
            setFormError(m.allFieldsRequired);
            return;
        }
        if (password.length < 8) {
            setFormError(m.passwordTooShort);
            return;
        }
        setStatus('accepting');
        try {
            await api.acceptInvitationSignup({ token, name: name.trim(), mobile: mobile.trim(), password });
            const res: any = await api.login({ email: info.email, password });
            localStorage.setItem('access_token', res.access_token);
            setIsLoggedIn(true);
            await finalizeSession();
        } catch (error: any) {
            setStatus('ready');
            setFormError(error?.message || m.acceptFailed);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-canvas p-4 font-sans text-gray-900">
            <div className="w-full max-w-md">
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 md:p-10">
                    <div className="text-center mb-8">
                        <span className="text-xl font-black tracking-tight text-blue-600">{m.brand}</span>
                    </div>

                    {status === 'loading' && (
                        <div className="flex flex-col items-center gap-5 py-6">
                            <Loader2 className="w-12 h-12 text-blue-500 animate-spin" />
                            <p className="font-semibold text-gray-800">{m.loading}</p>
                        </div>
                    )}

                    {status === 'ready' && info && (
                        <div className="space-y-6">
                            <div className="text-center">
                                <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-4">
                                    <UserPlus className="w-8 h-8 text-blue-600" />
                                </div>
                                <h1 className="text-2xl font-bold tracking-tight text-gray-900">{m.title}</h1>
                                <p className="text-gray-500 mt-2 text-sm leading-relaxed">
                                    {formatMessage(m.joinDescription, { tenant: info.tenantName, role: info.roleName ?? info.role ?? 'Member' })}
                                </p>
                            </div>

                            <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm space-y-2">
                                <div className="flex items-center gap-2 text-gray-700">
                                    <Mail className="w-4 h-4 text-gray-400" />
                                    <span>{info.email}</span>
                                </div>
                                <p className="text-xs text-gray-500">
                                    {formatMessage(m.expires, { date: new Date(info.expiresAt).toLocaleDateString() })}
                                </p>
                            </div>

                            {!isLoggedIn && info.hasAccount ? (
                                <form
                                    className="space-y-3"
                                    onSubmit={(e) => { e.preventDefault(); handleSignInAndAccept(); }}
                                >
                                    <p className="text-sm text-gray-600 text-center">
                                        {formatMessage(m.signInPasswordPrompt, { email: info.email })}
                                    </p>
                                    <div className="relative">
                                        <Lock className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                                        <input
                                            type="password"
                                            autoComplete="current-password"
                                            value={password}
                                            onChange={(e) => setPassword(e.target.value)}
                                            placeholder={m.passwordPlaceholder}
                                            className="w-full pl-10 pr-4 py-3 rounded-xl border border-gray-200 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none text-sm"
                                        />
                                    </div>
                                    {formError && <p className="text-sm text-red-600">{formError}</p>}
                                    <button
                                        type="submit"
                                        className="w-full inline-flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-xl transition-all"
                                    >
                                        {m.signInToAccept}
                                        <ArrowRight className="w-4 h-4" />
                                    </button>
                                    <Link
                                        href={`/login?redirect=${encodeURIComponent(redirectTarget)}`}
                                        className="block text-center text-sm text-gray-500 hover:text-blue-600"
                                    >
                                        {m.useFullSignIn}
                                    </Link>
                                </form>
                            ) : !isLoggedIn ? (
                                <form
                                    className="space-y-3"
                                    onSubmit={(e) => { e.preventDefault(); handleCreateAndAccept(); }}
                                >
                                    <p className="text-sm text-gray-600 text-center">
                                        {formatMessage(m.createAccountPrompt, { email: info.email })}
                                    </p>
                                    <div className="relative">
                                        <User className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                                        <input
                                            type="text"
                                            autoComplete="name"
                                            value={name}
                                            onChange={(e) => setName(e.target.value)}
                                            placeholder={m.namePlaceholder}
                                            className="w-full pl-10 pr-4 py-3 rounded-xl border border-gray-200 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none text-sm"
                                        />
                                    </div>
                                    <div className="relative">
                                        <Phone className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                                        <input
                                            type="tel"
                                            autoComplete="tel"
                                            value={mobile}
                                            onChange={(e) => setMobile(e.target.value)}
                                            placeholder={m.mobilePlaceholder}
                                            className="w-full pl-10 pr-4 py-3 rounded-xl border border-gray-200 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none text-sm"
                                        />
                                    </div>
                                    <div className="relative">
                                        <Lock className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                                        <input
                                            type="password"
                                            autoComplete="new-password"
                                            value={password}
                                            onChange={(e) => setPassword(e.target.value)}
                                            placeholder={m.passwordPlaceholder}
                                            className="w-full pl-10 pr-4 py-3 rounded-xl border border-gray-200 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none text-sm"
                                        />
                                    </div>
                                    <p className="text-xs text-gray-400">{m.passwordHint}</p>
                                    {formError && <p className="text-sm text-red-600">{formError}</p>}
                                    <button
                                        type="submit"
                                        className="w-full inline-flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-xl transition-all"
                                    >
                                        {m.createAccountAndJoin}
                                        <ArrowRight className="w-4 h-4" />
                                    </button>
                                </form>
                            ) : currentEmail && currentEmail !== info.email ? (
                                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                                    {formatMessage(m.emailMismatch, { currentEmail: currentEmail!, invitedEmail: info.email })}
                                </div>
                            ) : (
                                <button
                                    type="button"
                                    onClick={handleAccept}
                                    className="w-full inline-flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-xl transition-all"
                                >
                                    {m.accept}
                                    <ArrowRight className="w-4 h-4" />
                                </button>
                            )}
                        </div>
                    )}

                    {status === 'accepting' && (
                        <div className="flex flex-col items-center gap-5 py-6">
                            <Loader2 className="w-12 h-12 text-blue-500 animate-spin" />
                            <p className="font-semibold text-gray-800">{m.accepting}</p>
                        </div>
                    )}

                    {status === 'success' && (
                        <div className="flex flex-col items-center gap-5 py-6 text-center">
                            <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center">
                                <CheckCircle2 className="w-9 h-9 text-green-500" />
                            </div>
                            <div>
                                <h1 className="text-2xl font-bold tracking-tight text-gray-900">{m.successTitle}</h1>
                                <p className="text-gray-500 mt-2 text-sm">{m.successDescription}</p>
                            </div>
                        </div>
                    )}

                    {status === 'error' && (
                        <div className="flex flex-col items-center gap-5 py-6 text-center">
                            <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center">
                                <XCircle className="w-9 h-9 text-red-500" />
                            </div>
                            <div>
                                <h1 className="text-2xl font-bold tracking-tight text-gray-900">{m.errorTitle}</h1>
                                <p className="text-gray-500 mt-2 text-sm">{errorMessage}</p>
                            </div>
                            <Link href="/login" className="text-sm font-semibold text-blue-600 hover:text-blue-700">
                                {m.goToSignIn}
                            </Link>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

export default function AcceptInvitationPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
            </div>
        }>
            <AcceptInvitationContent />
        </Suspense>
    );
}