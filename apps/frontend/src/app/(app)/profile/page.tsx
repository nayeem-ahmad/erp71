'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Camera, Eye, EyeOff, Loader2, ShieldCheck, ShieldOff } from 'lucide-react';
import { api, fetchWithAuth } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import AvatarCropModal from '@/components/AvatarCropModal';
import { PageShell } from '@/components/ui';
import { toast } from '@/lib/toast';

type ToastState = { type: 'success' | 'error'; message: string } | null;

type Tab = 'profile' | 'password' | '2fa' | 'privacy';

/** Forwards local `{type, message}` toast payloads to the global toast store. */
function showToast(state: ToastState) {
    if (!state) return;
    if (state.type === 'success') toast.success(state.message);
    else toast.error(state.message);
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
                    className="rounded-lg border border-gray-200 bg-gray-50 px-5 py-4 text-left hover:border-blue-300 transition-colors disabled:opacity-60"
                >
                    <p className="text-sm font-bold text-gray-900">{t.settings.privacy.downloadData}</p>
                    <p className="mt-1 text-xs text-gray-500">{t.settings.privacy.downloadDesc}</p>
                </button>
                <button
                    type="button"
                    onClick={handleDeletionRequest}
                    disabled={requestingDeletion}
                    className="rounded-lg border border-rose-200 bg-rose-50 px-5 py-4 text-left hover:border-rose-300 transition-colors disabled:opacity-60"
                >
                    <p className="text-sm font-bold text-rose-800">{t.settings.privacy.requestDeletion}</p>
                    <p className="mt-1 text-xs text-rose-700">{t.settings.privacy.deletionDesc}</p>
                </button>
            </div>
        </div>
    );
}

/* ------------------------------------------------------------------ */
/*  Password Tab                                                       */
/* ------------------------------------------------------------------ */

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
                    <span className="w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center flex-shrink-0">
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
                        <span className="w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center flex-shrink-0">
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

export default function ProfilePage() {
    const { t } = useI18n();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [user, setUser] = useState<any>(null);
    const [name, setName] = useState('');
    const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [cropSrc, setCropSrc] = useState<string | null>(null);
    const [cropOpen, setCropOpen] = useState(false);
    const [activeTab, setActiveTab] = useState<Tab>('profile');
    const [twoFAEnabled, setTwoFAEnabled] = useState<boolean | null>(null);

    useEffect(() => {
        api.getMe()
            .then((me) => {
                setUser(me);
                setName(me?.name || '');
                setAvatarUrl(me?.avatar_url || null);
            })
            .catch(() => null)
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => {
        const has = user?.two_factor_enabled ?? user?.twoFactorEnabled ?? null;
        setTwoFAEnabled(has === true ? true : has === false ? false : null);
    }, [user]);

    const tabs: { key: Tab; label: string }[] = [
        { key: 'profile', label: t.settings.tabs.profile },
        { key: 'password', label: t.settings.tabs.password },
        { key: '2fa', label: t.settings.tabs.twoFactor },
        { key: 'privacy', label: t.settings.tabs.dataPrivacy },
    ];

    const initials = (name || user?.name || 'U')
        .split(' ')
        .map((part: string) => part[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);

    const handleFilePick = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            showToast({ type: 'error', message: t.profile.uploadFailed });
            return;
        }
        const reader = new FileReader();
        reader.onload = () => {
            setCropSrc(reader.result as string);
            setCropOpen(true);
        };
        reader.readAsDataURL(file);
        event.target.value = '';
    };

    const handleCropConfirm = async (file: File) => {
        setUploading(true);
        try {
            const formData = new FormData();
            formData.append('avatar', file);
            const result: { avatarUrl?: string } = await api.updateProfileAvatar(formData);
            const nextUrl = result?.avatarUrl ?? null;
            setAvatarUrl(nextUrl);
            showToast({ type: 'success', message: t.profile.uploadSuccess });
        } catch (err: any) {
            showToast({ type: 'error', message: err?.message || t.profile.uploadFailed });
        } finally {
            setUploading(false);
            setCropSrc(null);
        }
    };

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!name.trim()) {
            showToast({ type: 'error', message: t.profile.nameRequired });
            return;
        }
        setSaving(true);
        try {
            await fetchWithAuth('/auth/me', {
                method: 'PATCH',
                body: JSON.stringify({ name: name.trim() }),
                headers: { 'Content-Type': 'application/json' },
            });
            setUser((current: any) => ({ ...current, name: name.trim() }));
            showToast({ type: 'success', message: t.profile.profileUpdated });
        } catch (err: any) {
            showToast({ type: 'error', message: err?.message || t.profile.profileFailed });
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <PageShell>
                <p className="text-sm text-gray-500">{t.settings.loading}</p>
            </PageShell>
        );
    }

    return (
        <PageShell>
            <div className="max-w-2xl mx-auto space-y-6">
                <PageHeader
                    title={t.profile.pageTitle}
                    subtitle={t.profile.pageDescription}
                    breadcrumbs={modulePageBreadcrumbs(
                        t.dashboardHome.breadcrumbHome,
                        t.profile.pageTitle,
                        t.profile.pageTitle,
                        'profile',
                    )}
                />

                <div className="rounded-lg border border-gray-200 bg-white p-3 md:p-4 shadow-sm space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-5">
                        <div className="relative flex-shrink-0">
                            {avatarUrl ? (
                                <img
                                    src={avatarUrl}
                                    alt={name || user?.name || 'Profile'}
                                    className="w-24 h-24 rounded-full object-cover ring-4 ring-white shadow-md"
                                />
                            ) : (
                                <div className="w-24 h-24 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-2xl font-bold ring-4 ring-white shadow-md">
                                    {initials}
                                </div>
                            )}
                            {uploading && (
                                <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center">
                                    <Loader2 className="w-6 h-6 text-white animate-spin" />
                                </div>
                            )}
                        </div>

                        <div className="space-y-2">
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={handleFilePick}
                            />
                            <button
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                disabled={uploading}
                                className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm font-bold text-gray-800 hover:border-blue-300 hover:bg-blue-50 disabled:opacity-60"
                            >
                                <Camera className="w-4 h-4" />
                                {t.profile.changePhoto}
                            </button>
                            <p className="text-xs text-gray-400">{t.profile.photoHint}</p>
                        </div>
                    </div>
                </div>

                {/* Tabbed account controls card */}
                <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
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
                        {activeTab === 'profile' && (
                            <form onSubmit={handleSubmit} className="space-y-5 max-w-lg">
                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                                        {t.profile.nameLabel}
                                    </label>
                                    <input
                                        type="text"
                                        value={name}
                                        onChange={(e) => setName(e.target.value)}
                                        placeholder={t.profile.namePlaceholder}
                                        className="w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                                        {t.profile.emailLabel}
                                    </label>
                                    <input
                                        type="email"
                                        value={user?.email || ''}
                                        readOnly
                                        disabled
                                        className="w-full rounded-xl border border-gray-100 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-400 cursor-not-allowed"
                                    />
                                    <p className="mt-1.5 text-xs text-gray-400">{t.profile.emailReadonly}</p>
                                </div>

                                <div className="flex flex-wrap items-center gap-3 pt-2">
                                    <button
                                        type="submit"
                                        disabled={saving}
                                        className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60"
                                    >
                                        {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                                        {saving ? t.profile.saving : t.profile.saveChanges}
                                    </button>
                                </div>
                            </form>
                        )}
                        {activeTab === 'password' && (
                            <PasswordTab onToast={showToast} />
                        )}
                        {activeTab === '2fa' && (
                            <TwoFATab
                                twoFAEnabled={twoFAEnabled === true}
                                onToast={showToast}
                                onStatusChange={(enabled) => setTwoFAEnabled(enabled)}
                            />
                        )}
                        {activeTab === 'privacy' && (
                            <PrivacyTab onToast={showToast} />
                        )}
                    </div>
                </div>
            </div>

            {cropSrc && (
                <AvatarCropModal
                    imageSrc={cropSrc}
                    open={cropOpen}
                    title={t.profile.cropTitle}
                    confirmLabel={t.profile.cropConfirm}
                    cancelLabel={t.profile.cropCancel}
                    onClose={() => {
                        setCropOpen(false);
                        setCropSrc(null);
                    }}
                    onConfirm={handleCropConfirm}
                />
            )}
        </PageShell>
    );
}
