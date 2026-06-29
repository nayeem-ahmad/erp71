'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle, XCircle, Loader2, ShieldCheck, ShieldOff, Eye, EyeOff, Palette, Receipt, Gift, MessageSquare, BarChart3, Globe, Monitor, UserCog, ScrollText, ShoppingBag, CreditCard } from 'lucide-react';
import { api, fetchWithAuth } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type Tab = 'profile' | 'password' | '2fa' | 'privacy';

type ToastState = { type: 'success' | 'error'; message: string } | null;

/* ------------------------------------------------------------------ */
/*  Toast helper                                                       */
/* ------------------------------------------------------------------ */

function Toast({ toast, onDismiss }: { toast: ToastState; onDismiss: () => void }) {
    useEffect(() => {
        if (!toast) return;
        const t = setTimeout(onDismiss, 4000);
        return () => clearTimeout(t);
    }, [toast, onDismiss]);

    if (!toast) return null;

    const isSuccess = toast.type === 'success';
    return (
        <div
            className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-xl px-4 py-3 shadow-lg border text-sm font-semibold transition-all ${
                isSuccess
                    ? 'bg-green-50 border-green-200 text-green-800'
                    : 'bg-red-50 border-red-200 text-red-800'
            }`}
        >
            {isSuccess ? (
                <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
            ) : (
                <XCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
            )}
            {toast.message}
        </div>
    );
}

/* ------------------------------------------------------------------ */
/*  Data & Privacy Tab                                                 */
/* ------------------------------------------------------------------ */

function PrivacyTab({ onToast }: { onToast: (t: ToastState) => void }) {
    const { t } = useI18n();
    const [exporting, setExporting] = useState(false);
    const [requestingDeletion, setRequestingDeletion] = useState(false);

    const handleExport = async () => {
        setExporting(true);
        try {
            const data = await fetchWithAuth('/account/data-export');
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `erp71-export-${new Date().toISOString().slice(0, 10)}.json`;
            link.click();
            URL.revokeObjectURL(url);
            onToast({ type: 'success', message: t.settings.privacy.exportSuccess });
        } catch (err: any) {
            onToast({ type: 'error', message: err?.message || t.settings.privacy.exportFailed });
        } finally {
            setExporting(false);
        }
    };

    const handleDeletionRequest = async () => {
        if (!globalThis.confirm(t.settings.privacy.confirmDeletion)) {
            return;
        }
        setRequestingDeletion(true);
        try {
            await fetchWithAuth('/account/data-deletion-request', { method: 'DELETE' });
            onToast({ type: 'success', message: t.settings.privacy.deletionSubmitted });
        } catch (err: any) {
            onToast({ type: 'error', message: err?.message || t.settings.privacy.deletionFailed });
        } finally {
            setRequestingDeletion(false);
        }
    };

    return (
        <div className="space-y-6">
            <p className="text-sm text-gray-600">
                {t.settings.privacy.descriptionPrefix}{' '}
                <Link href="/privacy" className="text-blue-600 hover:underline">{t.settings.privacy.privacyPolicy}</Link>.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <button
                    type="button"
                    onClick={handleExport}
                    disabled={exporting}
                    className="rounded-2xl border border-gray-200 bg-gray-50 px-5 py-4 text-left hover:border-blue-300 transition-colors disabled:opacity-60"
                >
                    <p className="text-sm font-bold text-gray-900">{t.settings.privacy.downloadData}</p>
                    <p className="mt-1 text-xs text-gray-500">{t.settings.privacy.downloadDesc}</p>
                </button>
                <button
                    type="button"
                    onClick={handleDeletionRequest}
                    disabled={requestingDeletion}
                    className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-left hover:border-rose-300 transition-colors disabled:opacity-60"
                >
                    <p className="text-sm font-bold text-rose-800">{t.settings.privacy.requestDeletion}</p>
                    <p className="mt-1 text-xs text-rose-700">{t.settings.privacy.deletionDesc}</p>
                </button>
            </div>
        </div>
    );
}

/* ------------------------------------------------------------------ */
/*  Profile Tab                                                        */
/* ------------------------------------------------------------------ */

function ProfileTab({ user, onToast }: { user: any; onToast: (t: ToastState) => void }) {
    const { t } = useI18n();
    const [name, setName] = useState(user?.name || '');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (user?.name) setName(user.name);
    }, [user]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim()) {
            onToast({ type: 'error', message: t.settings.profile.nameRequired });
            return;
        }
        setSaving(true);
        try {
            await fetchWithAuth('/auth/me', {
                method: 'PATCH',
                body: JSON.stringify({ name: name.trim() }),
                headers: { 'Content-Type': 'application/json' },
            });
            onToast({ type: 'success', message: t.settings.profile.profileUpdated });
        } catch (err: any) {
            onToast({ type: 'error', message: err?.message || t.settings.profile.profileFailed });
        } finally {
            setSaving(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-5 max-w-lg">
            <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                    {t.settings.profile.nameLabel}
                </label>
                <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t.settings.profile.namePlaceholder}
                    className="w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                />
            </div>

            <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                    {t.settings.profile.emailLabel}
                </label>
                <input
                    type="email"
                    value={user?.email || ''}
                    readOnly
                    disabled
                    className="w-full rounded-xl border border-gray-100 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-400 cursor-not-allowed select-none"
                />
                <p className="mt-1.5 text-xs text-gray-400">
                    {t.settings.profile.emailReadonly}
                </p>
            </div>

            <div className="pt-2">
                <button
                    type="submit"
                    disabled={saving}
                    className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors shadow-sm"
                >
                    {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                    {saving ? t.settings.profile.saving : t.settings.profile.saveChanges}
                </button>
            </div>
        </form>
    );
}

/* ------------------------------------------------------------------ */
/*  Password Tab                                                       */
/* ------------------------------------------------------------------ */

function PasswordTab({ onToast }: { onToast: (t: ToastState) => void }) {
    const { t } = useI18n();
    const [current, setCurrent] = useState('');
    const [next, setNext] = useState('');
    const [confirm, setConfirm] = useState('');
    const [saving, setSaving] = useState(false);
    const [showCurrent, setShowCurrent] = useState(false);
    const [showNext, setShowNext] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!current) {
            onToast({ type: 'error', message: t.settings.password.currentRequired });
            return;
        }
        if (next.length < 8) {
            onToast({ type: 'error', message: t.settings.password.tooShort });
            return;
        }
        if (next !== confirm) {
            onToast({ type: 'error', message: t.settings.password.mismatch });
            return;
        }
        if (next === current) {
            onToast({ type: 'error', message: t.settings.password.sameAsCurrent });
            return;
        }

        setSaving(true);
        try {
            await fetchWithAuth('/auth/change-password', {
                method: 'POST',
                body: JSON.stringify({ currentPassword: current, newPassword: next }),
                headers: { 'Content-Type': 'application/json' },
            });
            onToast({ type: 'success', message: t.settings.password.success });
            setCurrent('');
            setNext('');
            setConfirm('');
        } catch (err: any) {
            onToast({ type: 'error', message: err?.message || t.settings.password.failed });
        } finally {
            setSaving(false);
        }
    };

    const PasswordInput = ({
        label,
        value,
        onChange,
        show,
        onToggle,
        placeholder,
        hint,
    }: {
        label: string;
        value: string;
        onChange: (v: string) => void;
        show: boolean;
        onToggle: () => void;
        placeholder?: string;
        hint?: string;
    }) => (
        <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">{label}</label>
            <div className="relative">
                <input
                    type={show ? 'text' : 'password'}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={placeholder}
                    className="w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 pr-10 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                />
                <button
                    type="button"
                    onClick={onToggle}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                    tabIndex={-1}
                >
                    {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
            </div>
            {hint && <p className="mt-1.5 text-xs text-gray-400">{hint}</p>}
        </div>
    );

    return (
        <form onSubmit={handleSubmit} className="space-y-5 max-w-lg">
            <PasswordInput
                label={t.settings.password.currentLabel}
                value={current}
                onChange={setCurrent}
                show={showCurrent}
                onToggle={() => setShowCurrent((v) => !v)}
                placeholder={t.settings.password.currentPlaceholder}
            />
            <PasswordInput
                label={t.settings.password.newLabel}
                value={next}
                onChange={setNext}
                show={showNext}
                onToggle={() => setShowNext((v) => !v)}
                placeholder={t.settings.password.newPlaceholder}
                hint={t.settings.password.hint}
            />
            <PasswordInput
                label={t.settings.password.confirmLabel}
                value={confirm}
                onChange={setConfirm}
                show={showConfirm}
                onToggle={() => setShowConfirm((v) => !v)}
                placeholder={t.settings.password.confirmPlaceholder}
            />

            <div className="pt-2">
                <button
                    type="submit"
                    disabled={saving}
                    className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors shadow-sm"
                >
                    {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                    {saving ? t.settings.password.changing : t.settings.password.changePassword}
                </button>
            </div>
        </form>
    );
}

/* ------------------------------------------------------------------ */
/*  2FA Tab                                                            */
/* ------------------------------------------------------------------ */

type TwoFASetupState = {
    secret: string;
    qrCodeDataUrl: string;
    otpAuthUrl: string;
} | null;

function TwoFATab({
    twoFAEnabled,
    onToast,
    onStatusChange,
}: {
    twoFAEnabled: boolean;
    onToast: (t: ToastState) => void;
    onStatusChange: (enabled: boolean) => void;
}) {
    const { t } = useI18n();
    const [setup, setSetup] = useState<TwoFASetupState>(null);
    const [enableCode, setEnableCode] = useState('');
    const [disableCode, setDisableCode] = useState('');
    const [loadingSetup, setLoadingSetup] = useState(false);
    const [loadingEnable, setLoadingEnable] = useState(false);
    const [loadingDisable, setLoadingDisable] = useState(false);
    const [showDisableForm, setShowDisableForm] = useState(false);

    const handleGenerateQR = async () => {
        setLoadingSetup(true);
        try {
            const data = await fetchWithAuth('/auth/2fa/setup', { method: 'POST' });
            setSetup(data as TwoFASetupState);
            setEnableCode('');
        } catch (err: any) {
            onToast({ type: 'error', message: err?.message || t.settings.twoFactor.setupFailed });
        } finally {
            setLoadingSetup(false);
        }
    };

    const handleEnable = async (e: React.FormEvent) => {
        e.preventDefault();
        if (enableCode.length !== 6 || !/^\d{6}$/.test(enableCode)) {
            onToast({ type: 'error', message: t.settings.twoFactor.invalidCode });
            return;
        }
        setLoadingEnable(true);
        try {
            await fetchWithAuth('/auth/2fa/enable', {
                method: 'POST',
                body: JSON.stringify({ code: enableCode }),
                headers: { 'Content-Type': 'application/json' },
            });
            onToast({ type: 'success', message: t.settings.twoFactor.enableSuccess });
            setSetup(null);
            setEnableCode('');
            onStatusChange(true);
        } catch (err: any) {
            onToast({ type: 'error', message: err?.message || t.settings.twoFactor.enableFailed });
        } finally {
            setLoadingEnable(false);
        }
    };

    const handleDisable = async (e: React.FormEvent) => {
        e.preventDefault();
        if (disableCode.length !== 6 || !/^\d{6}$/.test(disableCode)) {
            onToast({ type: 'error', message: t.settings.twoFactor.invalidCode });
            return;
        }
        setLoadingDisable(true);
        try {
            await fetchWithAuth('/auth/2fa/disable', {
                method: 'POST',
                body: JSON.stringify({ code: disableCode }),
                headers: { 'Content-Type': 'application/json' },
            });
            onToast({ type: 'success', message: t.settings.twoFactor.disableSuccess });
            setDisableCode('');
            setShowDisableForm(false);
            onStatusChange(false);
        } catch (err: any) {
            onToast({ type: 'error', message: err?.message || t.settings.twoFactor.disableFailed });
        } finally {
            setLoadingDisable(false);
        }
    };

    /* -- Enabled state ------------------------------------------- */
    if (twoFAEnabled) {
        return (
            <div className="space-y-6 max-w-lg">
                {/* Status badge */}
                <div className="flex items-center gap-3 rounded-xl bg-green-50 border border-green-200 px-4 py-3">
                    <ShieldCheck className="w-5 h-5 text-green-600 flex-shrink-0" />
                    <div>
                        <p className="text-sm font-bold text-green-800">{t.settings.twoFactor.enabledTitle}</p>
                        <p className="text-xs text-green-600 mt-0.5">{t.settings.twoFactor.enabledDesc}</p>
                    </div>
                </div>

                {/* Disable section */}
                {!showDisableForm ? (
                    <button
                        onClick={() => setShowDisableForm(true)}
                        className="inline-flex items-center gap-2 rounded-xl border border-red-200 px-4 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50 transition-colors"
                    >
                        <ShieldOff className="w-4 h-4" />
                        {t.settings.twoFactor.disable}
                    </button>
                ) : (
                    <form onSubmit={handleDisable} className="space-y-4">
                        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                            <p className="font-semibold">{t.settings.twoFactor.disableConfirmTitle}</p>
                            <p className="mt-0.5 text-amber-700">{t.settings.twoFactor.disableConfirmDesc}</p>
                        </div>
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                                {t.settings.twoFactor.authCodeLabel}
                            </label>
                            <input
                                type="text"
                                inputMode="numeric"
                                pattern="\d{6}"
                                maxLength={6}
                                value={disableCode}
                                onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                placeholder={t.settings.twoFactor.authCodePlaceholder}
                                className="w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-400 focus:border-transparent transition tracking-widest font-mono"
                            />
                        </div>
                        <div className="flex gap-3">
                            <button
                                type="submit"
                                disabled={loadingDisable}
                                className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                            >
                                {loadingDisable && <Loader2 className="w-4 h-4 animate-spin" />}
                                {loadingDisable ? t.settings.twoFactor.disabling : t.settings.twoFactor.disable}
                            </button>
                            <button
                                type="button"
                                onClick={() => { setShowDisableForm(false); setDisableCode(''); }}
                                className="rounded-xl border border-gray-200 px-5 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors"
                            >
                                {t.settings.twoFactor.cancel}
                            </button>
                        </div>
                    </form>
                )}
            </div>
        );
    }

    /* -- Disabled state ------------------------------------------ */
    return (
        <div className="space-y-6 max-w-lg">
            {/* Status badge */}
            <div className="flex items-center gap-3 rounded-xl bg-gray-50 border border-gray-200 px-4 py-3">
                <ShieldOff className="w-5 h-5 text-gray-400 flex-shrink-0" />
                <div>
                    <p className="text-sm font-bold text-gray-700">{t.settings.twoFactor.disabledTitle}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{t.settings.twoFactor.disabledDesc}</p>
                </div>
            </div>

            <div className="space-y-1">
                <h3 className="text-sm font-bold text-gray-800">{t.settings.twoFactor.setupTitle}</h3>
                <p className="text-sm text-gray-500">
                    {t.settings.twoFactor.setupDesc}
                </p>
            </div>

            {/* Step 1 */}
            <div className="space-y-3">
                <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-black flex items-center justify-center flex-shrink-0">
                        1
                    </span>
                    <span className="text-sm font-semibold text-gray-700">{t.settings.twoFactor.step1}</span>
                </div>

                {!setup ? (
                    <button
                        onClick={handleGenerateQR}
                        disabled={loadingSetup}
                        className="inline-flex items-center gap-2 ml-8 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors shadow-sm"
                    >
                        {loadingSetup && <Loader2 className="w-4 h-4 animate-spin" />}
                        {loadingSetup ? t.settings.twoFactor.generating : t.settings.twoFactor.generateQr}
                    </button>
                ) : (
                    <div className="ml-8 space-y-4">
                        {/* QR Code image */}
                        <div className="inline-block rounded-xl border-2 border-gray-200 p-3 bg-white">
                            {/* qrCodeDataUrl is a data URI from the backend */}
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                                src={setup.qrCodeDataUrl}
                                alt={t.settings.twoFactor.qrAlt}
                                className="w-40 h-40 block"
                            />
                        </div>

                        {/* Manual entry fallback */}
                        <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 space-y-1">
                            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                                {t.settings.twoFactor.manualEntry}
                            </p>
                            <code className="text-sm font-mono font-bold text-gray-800 tracking-widest break-all select-all">
                                {setup.secret}
                            </code>
                        </div>

                        <button
                            onClick={handleGenerateQR}
                            disabled={loadingSetup}
                            className="text-xs text-gray-400 hover:text-gray-600 underline underline-offset-2 transition-colors"
                        >
                            {t.settings.twoFactor.regenerateQr}
                        </button>
                    </div>
                )}
            </div>

            {/* Step 2 */}
            {setup && (
                <div className="space-y-3">
                    <div className="flex items-center gap-2">
                        <span className="w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-black flex items-center justify-center flex-shrink-0">
                            2
                        </span>
                        <span className="text-sm font-semibold text-gray-700">{t.settings.twoFactor.step2}</span>
                    </div>

                    <form onSubmit={handleEnable} className="ml-8 space-y-4">
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                                {t.settings.twoFactor.codeLabel}
                            </label>
                            <input
                                type="text"
                                inputMode="numeric"
                                pattern="\d{6}"
                                maxLength={6}
                                value={enableCode}
                                onChange={(e) => setEnableCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                placeholder={t.settings.twoFactor.codePlaceholder}
                                className="w-48 rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition tracking-widest font-mono text-center"
                            />
                        </div>
                        <button
                            type="submit"
                            disabled={loadingEnable || enableCode.length !== 6}
                            className="inline-flex items-center gap-2 rounded-xl bg-green-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-green-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors shadow-sm"
                        >
                            {loadingEnable && <Loader2 className="w-4 h-4 animate-spin" />}
                            {loadingEnable ? t.settings.twoFactor.verifying : t.settings.twoFactor.enable}
                        </button>
                    </form>
                </div>
            )}
        </div>
    );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function AccountSettingsPage() {
    const { t } = useI18n();
    const [activeTab, setActiveTab] = useState<Tab>('profile');
    const [user, setUser] = useState<any>(null);
    const [loadingUser, setLoadingUser] = useState(true);
    const [toast, setToast] = useState<ToastState>(null);
    // 2FA enabled is derived from the user's totp status.
    // getMe doesn't expose it directly, so we fetch separately and track locally.
    const [twoFAEnabled, setTwoFAEnabled] = useState<boolean | null>(null);

    useEffect(() => {
        setLoadingUser(true);
        api.getMe()
            .then((u) => {
                setUser(u);
                // Attempt to load 2FA status from a dedicated endpoint; fall back to unknown.
                // We'll optimistically check via the user object if a field is present.
                // Since getMe doesn't expose totp status, we'll rely on the setup flow.
                const hasTwoFA = u?.two_factor_enabled ?? u?.twoFactorEnabled ?? null;
                setTwoFAEnabled(hasTwoFA === true ? true : hasTwoFA === false ? false : null);
            })
            .catch(() => null)
            .finally(() => setLoadingUser(false));
    }, []);

    const tabs: { key: Tab; label: string }[] = [
        { key: 'profile', label: t.settings.tabs.profile },
        { key: 'password', label: t.settings.tabs.password },
        { key: '2fa', label: t.settings.tabs.twoFactor },
        { key: 'privacy', label: t.settings.tabs.dataPrivacy },
    ];

    const quickLinks = [
        {
            href: routes.team,
            icon: UserCog,
            label: t.settings.quickLinks.teamLabel,
            description: t.settings.quickLinks.teamDescription,
        },
        {
            href: routes.settings.auditLogs,
            icon: ScrollText,
            label: t.settings.quickLinks.auditLabel,
            description: t.settings.quickLinks.auditDescription,
        },
        {
            href: routes.settings.localization,
            icon: Globe,
            label: t.settings.quickLinks.localizationLabel,
            description: t.settings.quickLinks.localizationDescription,
        },
        {
            href: routes.settings.branding,
            icon: Palette,
            label: t.settings.quickLinks.brandingLabel,
            description: t.settings.quickLinks.brandingDescription,
        },
        {
            href: routes.settings.tax,
            icon: Receipt,
            label: t.settings.quickLinks.taxLabel,
            description: t.settings.quickLinks.taxDescription,
        },
        {
            href: routes.settings.loyalty,
            icon: Gift,
            label: t.settings.quickLinks.loyaltyLabel,
            description: t.settings.quickLinks.loyaltyDescription,
        },
        {
            href: routes.settings.sms,
            icon: MessageSquare,
            label: t.settings.quickLinks.smsLabel,
            description: t.settings.quickLinks.smsDescription,
        },
        {
            href: routes.settings.reports,
            icon: BarChart3,
            label: t.settings.quickLinks.reportsLabel,
            description: t.settings.quickLinks.reportsDescription,
        },
        {
            href: routes.settings.counters,
            icon: Monitor,
            label: t.settings.quickLinks.countersLabel,
            description: t.settings.quickLinks.countersDescription,
        },
        {
            href: routes.settings.sales,
            icon: ShoppingBag,
            label: 'Sales Settings',
            description: 'Default paper size, reference number format',
        },
        {
            href: routes.settings.paymentMethods,
            icon: CreditCard,
            label: 'Payment Methods',
            description: 'Manage cash, card, mobile wallet methods',
        },
    ];

    return (
        <div className="h-full overflow-y-auto">
            <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
                {/* Page header */}
                <div>
                    <h1 className="text-2xl font-black text-gray-900 tracking-tight">{t.settings.title}</h1>
                    <p className="mt-1 text-sm text-gray-500">{t.settings.description}</p>
                </div>

                {/* Quick links to sub-settings */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {quickLinks.map(({ href, icon: Icon, label, description }) => (
                        <Link
                            key={href}
                            href={href}
                            className="flex items-center gap-4 rounded-2xl border border-gray-200 bg-white px-5 py-4 hover:border-blue-300 hover:shadow-sm transition-all group"
                        >
                            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0 group-hover:bg-blue-100 transition-colors">
                                <Icon className="w-5 h-5 text-blue-600" />
                            </div>
                            <div>
                                <p className="text-sm font-bold text-gray-800">{label}</p>
                                <p className="text-xs text-gray-500 mt-0.5">{description}</p>
                            </div>
                        </Link>
                    ))}
                </div>

                {/* Card */}
                <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                    {/* Tab bar */}
                    <div className="flex items-center border-b border-gray-100 px-6 gap-1">
                        {tabs.map(({ key, label }) => (
                            <button
                                key={key}
                                onClick={() => setActiveTab(key)}
                                className={`relative py-4 px-3 text-sm font-semibold transition-colors ${
                                    activeTab === key
                                        ? 'text-blue-600'
                                        : 'text-gray-500 hover:text-gray-800'
                                }`}
                            >
                                {label}
                                {activeTab === key && (
                                    <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-t-full bg-blue-600" />
                                )}
                            </button>
                        ))}
                    </div>

                    {/* Tab content */}
                    <div className="p-6">
                        {loadingUser ? (
                            <div className="flex items-center gap-2 text-gray-400 text-sm">
                                <Loader2 className="w-4 h-4 animate-spin" />
                                {t.settings.loading}
                            </div>
                        ) : (
                            <>
                                {activeTab === 'profile' && (
                                    <ProfileTab user={user} onToast={setToast} />
                                )}
                                {activeTab === 'password' && (
                                    <PasswordTab onToast={setToast} />
                                )}
                                {activeTab === '2fa' && (
                                    <TwoFATab
                                        twoFAEnabled={twoFAEnabled === true}
                                        onToast={setToast}
                                        onStatusChange={(enabled) => setTwoFAEnabled(enabled)}
                                    />
                                )}
                                {activeTab === 'privacy' && (
                                    <PrivacyTab onToast={setToast} />
                                )}
                            </>
                        )}
                    </div>
                </div>
            </div>

            {/* Toast notification */}
            <Toast toast={toast} onDismiss={() => setToast(null)} />
        </div>
    );
}
