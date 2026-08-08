'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Loader2, Smartphone } from 'lucide-react';
import { DEFAULT_MOBILE_COUNTRY_CODE, normalizeMobileToE164 } from '@erp71/shared-types';
import { api } from '@/lib/api';
import { formatMessage, useI18n } from '@/lib/i18n';
import PhoneNumberField from '@/components/PhoneNumberField';
import {
    describeFirebaseAuthError,
    sendPhoneVerificationCode,
    type FirebaseWebConfig,
    type PhoneConfirmation,
} from '@/lib/firebase-phone-auth';

/** Fields the host page contributes when the code turns out to create an account. */
export type MobileSignUpFields = {
    email?: string;
    name?: string;
    tenantName?: string;
    planCode?: string;
    referralCode?: string;
};

export type MobileSignInPanelProps = {
    /** Receives the backend's auth response — the caller stores it and routes. */
    onSuccess: (authResponse: any) => void | Promise<void>;
    /** Surfaces failures to the page's own error banner. */
    onError?: (message: string) => void;
    /**
     * Read at exchange time (not at mount) so whatever the visitor has typed
     * into the surrounding signup form is what gets sent.
     */
    signUpFields?: () => MobileSignUpFields;
    /** Blocks the flow while another auth flow on the page is running. */
    disabled?: boolean;
    /** 'signin' on the login page, 'signup' on the signup page. */
    intent?: 'signin' | 'signup';
    /**
     * Fires once the backend has said whether mobile sign-in is configured, so
     * the page can drop its own chrome (dividers, hint text) when it isn't.
     */
    onAvailabilityChange?: (available: boolean) => void;
};

type Step = 'collapsed' | 'number' | 'code' | 'account';

const CODE_LENGTH = 6;

const inputClass =
    'w-full bg-gray-50 border border-gray-200 rounded-xl py-3 px-4 outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500';

/**
 * The whole mobile sign-in flow: number → SMS code → ERP71 session, plus the
 * one extra step a brand-new account needs (an email address, which the backend
 * asks for by answering `requires_signup`).
 *
 * Renders nothing at all unless the backend has Firebase configured, so a
 * deployment without it behaves exactly as before.
 */
export default function MobileSignInPanel({
    onSuccess,
    onError,
    signUpFields,
    disabled = false,
    intent = 'signin',
    onAvailabilityChange,
}: MobileSignInPanelProps) {
    const { t } = useI18n();
    const copy = t.auth.mobile;
    const [config, setConfig] = useState<FirebaseWebConfig | null>(null);
    const [step, setStep] = useState<Step>('collapsed');
    const [countryCode, setCountryCode] = useState(DEFAULT_MOBILE_COUNTRY_CODE);
    const [mobile, setMobile] = useState('');
    const [verifiedMobile, setVerifiedMobile] = useState('');
    const [code, setCode] = useState('');
    const [email, setEmail] = useState('');
    const [name, setName] = useState('');
    const [busy, setBusy] = useState(false);

    const recaptchaRef = useRef<HTMLDivElement>(null);
    const confirmationRef = useRef<PhoneConfirmation | null>(null);
    // Held so the account step can post the same token back without a second SMS.
    const idTokenRef = useRef<string | null>(null);
    const onAvailabilityChangeRef = useRef(onAvailabilityChange);
    onAvailabilityChangeRef.current = onAvailabilityChange;

    useEffect(() => {
        let cancelled = false;

        (async () => {
            // Anything that goes wrong here leaves the page without the mobile
            // option — never a broken login form.
            let loaded: (FirebaseWebConfig & { enabled?: boolean }) | null = null;
            try {
                loaded = await api.getFirebaseAuthConfig();
            } catch {
                loaded = null;
            }
            if (cancelled) return;

            const available = !!loaded?.enabled && !!loaded?.api_key && !!loaded?.project_id;
            onAvailabilityChangeRef.current?.(available);
            setConfig(available ? loaded : null);
        })();

        return () => {
            cancelled = true;
        };
    }, []);

    // Releasing the reCAPTCHA on unmount stops an abandoned flow from leaving a
    // widget bound to a detached node.
    useEffect(() => () => confirmationRef.current?.dispose(), []);

    if (!config) return null;

    const fail = (message: string) => {
        onError?.(message);
    };

    const reset = () => {
        confirmationRef.current?.dispose();
        confirmationRef.current = null;
        idTokenRef.current = null;
        setCode('');
        setStep('collapsed');
    };

    const requestCode = async () => {
        const e164 = normalizeMobileToE164(countryCode, mobile);
        if (!e164) {
            fail(copy.invalidMobile);
            return;
        }
        const container = recaptchaRef.current;
        if (!container) return;

        setBusy(true);
        try {
            confirmationRef.current?.dispose();
            confirmationRef.current = await sendPhoneVerificationCode(config, e164, container);
            setVerifiedMobile(e164);
            setCode('');
            setStep('code');
        } catch (err) {
            fail(describeFirebaseAuthError(err, copy.failed));
        } finally {
            setBusy(false);
        }
    };

    /** Posts a verified Firebase token to ERP71 and routes on what comes back. */
    const exchange = async (idToken: string, extra: MobileSignUpFields) => {
        const authRes = await api.mobileSignIn({ idToken, ...extra });
        if (authRes?.requires_signup) {
            // The number is verified but unknown here — collect an email and
            // send the same token back.
            idTokenRef.current = idToken;
            setStep('account');
            return;
        }
        await onSuccess(authRes);
    };

    const submitCode = async () => {
        const confirmation = confirmationRef.current;
        if (!confirmation) return;

        setBusy(true);
        try {
            const idToken = await confirmation.confirm(code);
            const fields = signUpFields?.() ?? {};
            await exchange(idToken, fields);
        } catch (err) {
            fail(describeFirebaseAuthError(err, copy.failed));
        } finally {
            setBusy(false);
        }
    };

    const submitAccount = async () => {
        const idToken = idTokenRef.current;
        if (!idToken) return;

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
            fail(copy.invalidEmail);
            return;
        }

        setBusy(true);
        try {
            await exchange(idToken, {
                ...(signUpFields?.() ?? {}),
                email: email.trim(),
                name: name.trim() || undefined,
            });
        } catch (err: any) {
            fail(err?.message || copy.failed);
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="space-y-3">
            {/* Firebase paints its challenge here when it wants one; empty otherwise. */}
            <div ref={recaptchaRef} />

            {step === 'collapsed' && (
                <button
                    type="button"
                    onClick={() => setStep('number')}
                    disabled={disabled}
                    className="w-full min-h-touch bg-white hover:bg-gray-50 text-gray-700 font-semibold py-3 rounded-xl border border-gray-200 active:scale-[0.98] transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
                >
                    <Smartphone className="w-5 h-5 text-blue-600" />
                    <span>{intent === 'signup' ? copy.startSignup : copy.start}</span>
                </button>
            )}

            {step === 'number' && (
                <div className="space-y-4 rounded-xl border border-gray-200 p-4">
                    <div>
                        <p className="text-sm font-semibold text-gray-900">{copy.title}</p>
                        <p className="mt-1 text-xs text-gray-500">{copy.description}</p>
                    </div>
                    <PhoneNumberField
                        countryCode={countryCode}
                        mobile={mobile}
                        onCountryCodeChange={setCountryCode}
                        onMobileChange={setMobile}
                        countryLabel={copy.countryLabel}
                        mobileLabel={copy.mobileLabel}
                        idPrefix="mobile-signin"
                    />
                    <div className="flex items-center gap-3">
                        <button
                            type="button"
                            onClick={() => { void requestCode(); }}
                            disabled={busy || disabled || !mobile.trim()}
                            className="flex-1 min-h-touch bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl shadow-lg shadow-blue-200 disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center"
                        >
                            {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : copy.sendCode}
                        </button>
                        <button
                            type="button"
                            onClick={reset}
                            disabled={busy}
                            className="text-sm text-gray-500 hover:text-gray-800 px-2"
                        >
                            {copy.cancel}
                        </button>
                    </div>
                </div>
            )}

            {step === 'code' && (
                <div className="space-y-4 rounded-xl border border-gray-200 p-4">
                    <p className="text-sm text-gray-600">
                        {formatMessage(copy.codeSentTo, { mobile: verifiedMobile })}
                    </p>
                    <div className="space-y-2">
                        <label htmlFor="mobile-signin-code" className="text-sm font-medium text-gray-700 ml-1">
                            {copy.codeLabel}
                        </label>
                        <input
                            id="mobile-signin-code"
                            type="text"
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            maxLength={CODE_LENGTH}
                            value={code}
                            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, CODE_LENGTH))}
                            className={`${inputClass} text-center tracking-[0.4em] font-mono text-lg`}
                            placeholder="000000"
                        />
                    </div>
                    <button
                        type="button"
                        onClick={() => { void submitCode(); }}
                        disabled={busy || disabled || code.length !== CODE_LENGTH}
                        className="w-full min-h-touch bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl shadow-lg shadow-blue-200 disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center"
                    >
                        {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : copy.verify}
                    </button>
                    <div className="flex items-center justify-between text-sm">
                        <button
                            type="button"
                            onClick={() => { confirmationRef.current?.dispose(); confirmationRef.current = null; setStep('number'); }}
                            disabled={busy}
                            className="flex items-center gap-1 text-gray-500 hover:text-gray-800"
                        >
                            <ArrowLeft className="w-4 h-4" />
                            {copy.changeNumber}
                        </button>
                        <button
                            type="button"
                            onClick={() => { void requestCode(); }}
                            disabled={busy}
                            className="font-medium text-blue-600 hover:text-blue-700"
                        >
                            {copy.resend}
                        </button>
                    </div>
                </div>
            )}

            {step === 'account' && (
                <div className="space-y-4 rounded-xl border border-gray-200 p-4">
                    <div>
                        <p className="text-sm font-semibold text-gray-900">{copy.accountTitle}</p>
                        <p className="mt-1 text-xs text-gray-500">
                            {formatMessage(copy.accountDescription, { mobile: verifiedMobile })}
                        </p>
                    </div>
                    <div className="space-y-2">
                        <label htmlFor="mobile-signin-email" className="text-sm font-medium text-gray-700 ml-1">
                            {copy.emailLabel}
                        </label>
                        <input
                            id="mobile-signin-email"
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className={inputClass}
                            placeholder="owner@company.com"
                        />
                    </div>
                    <div className="space-y-2">
                        <label htmlFor="mobile-signin-name" className="text-sm font-medium text-gray-700 ml-1">
                            {copy.nameLabel}
                        </label>
                        <input
                            id="mobile-signin-name"
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className={inputClass}
                            placeholder="Nayeem Ahmad"
                        />
                    </div>
                    <button
                        type="button"
                        onClick={() => { void submitAccount(); }}
                        disabled={busy || disabled || !email.trim()}
                        className="w-full min-h-touch bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl shadow-lg shadow-blue-200 disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center"
                    >
                        {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : copy.createAccount}
                    </button>
                </div>
            )}
        </div>
    );
}
