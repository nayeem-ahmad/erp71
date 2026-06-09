'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle, XCircle, Loader2, ShieldCheck, ShieldOff, Eye, EyeOff, Palette, Receipt, Gift, MessageSquare, BarChart3, Globe, Monitor } from 'lucide-react';
import { api, fetchWithAuth } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type Tab = 'profile' | 'password' | '2fa';

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
/*  Profile Tab                                                        */
/* ------------------------------------------------------------------ */

function ProfileTab({ user, onToast }: { user: any; onToast: (t: ToastState) => void }) {
    const [name, setName] = useState(user?.name || '');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (user?.name) setName(user.name);
    }, [user]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim()) {
            onToast({ type: 'error', message: 'Display name cannot be empty.' });
            return;
        }
        setSaving(true);
        try {
            await fetchWithAuth('/auth/me', {
                method: 'PATCH',
                body: JSON.stringify({ name: name.trim() }),
                headers: { 'Content-Type': 'application/json' },
            });
            onToast({ type: 'success', message: 'Profile updated successfully.' });
        } catch (err: any) {
            onToast({ type: 'error', message: err?.message || 'Failed to update profile.' });
        } finally {
            setSaving(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-5 max-w-lg">
            <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                    Display Name
                </label>
                <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your name"
                    className="w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                />
            </div>

            <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                    Email Address
                </label>
                <input
                    type="email"
                    value={user?.email || ''}
                    readOnly
                    disabled
                    className="w-full rounded-xl border border-gray-100 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-400 cursor-not-allowed select-none"
                />
                <p className="mt-1.5 text-xs text-gray-400">
                    Email cannot be changed. Contact support if you need help.
                </p>
            </div>

            <div className="pt-2">
                <button
                    type="submit"
                    disabled={saving}
                    className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors shadow-sm"
                >
                    {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                    {saving ? 'Saving…' : 'Save Changes'}
                </button>
            </div>
        </form>
    );
}

/* ------------------------------------------------------------------ */
/*  Password Tab                                                       */
/* ------------------------------------------------------------------ */

function PasswordTab({ onToast }: { onToast: (t: ToastState) => void }) {
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
            onToast({ type: 'error', message: 'Please enter your current password.' });
            return;
        }
        if (next.length < 8) {
            onToast({ type: 'error', message: 'New password must be at least 8 characters.' });
            return;
        }
        if (next !== confirm) {
            onToast({ type: 'error', message: 'New password and confirmation do not match.' });
            return;
        }
        if (next === current) {
            onToast({ type: 'error', message: 'New password must differ from your current password.' });
            return;
        }

        setSaving(true);
        try {
            await fetchWithAuth('/auth/change-password', {
                method: 'POST',
                body: JSON.stringify({ currentPassword: current, newPassword: next }),
                headers: { 'Content-Type': 'application/json' },
            });
            onToast({ type: 'success', message: 'Password changed successfully.' });
            setCurrent('');
            setNext('');
            setConfirm('');
        } catch (err: any) {
            onToast({ type: 'error', message: err?.message || 'Failed to change password.' });
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
                label="Current Password"
                value={current}
                onChange={setCurrent}
                show={showCurrent}
                onToggle={() => setShowCurrent((v) => !v)}
                placeholder="Enter current password"
            />
            <PasswordInput
                label="New Password"
                value={next}
                onChange={setNext}
                show={showNext}
                onToggle={() => setShowNext((v) => !v)}
                placeholder="At least 8 characters"
                hint="Must be at least 8 characters and different from your current password."
            />
            <PasswordInput
                label="Confirm New Password"
                value={confirm}
                onChange={setConfirm}
                show={showConfirm}
                onToggle={() => setShowConfirm((v) => !v)}
                placeholder="Repeat new password"
            />

            <div className="pt-2">
                <button
                    type="submit"
                    disabled={saving}
                    className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors shadow-sm"
                >
                    {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                    {saving ? 'Changing…' : 'Change Password'}
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
            onToast({ type: 'error', message: err?.message || 'Failed to generate QR code.' });
        } finally {
            setLoadingSetup(false);
        }
    };

    const handleEnable = async (e: React.FormEvent) => {
        e.preventDefault();
        if (enableCode.length !== 6 || !/^\d{6}$/.test(enableCode)) {
            onToast({ type: 'error', message: 'Please enter a valid 6-digit code.' });
            return;
        }
        setLoadingEnable(true);
        try {
            await fetchWithAuth('/auth/2fa/enable', {
                method: 'POST',
                body: JSON.stringify({ code: enableCode }),
                headers: { 'Content-Type': 'application/json' },
            });
            onToast({ type: 'success', message: '2FA has been enabled on your account.' });
            setSetup(null);
            setEnableCode('');
            onStatusChange(true);
        } catch (err: any) {
            onToast({ type: 'error', message: err?.message || 'Failed to enable 2FA. Check your code and try again.' });
        } finally {
            setLoadingEnable(false);
        }
    };

    const handleDisable = async (e: React.FormEvent) => {
        e.preventDefault();
        if (disableCode.length !== 6 || !/^\d{6}$/.test(disableCode)) {
            onToast({ type: 'error', message: 'Please enter a valid 6-digit code.' });
            return;
        }
        setLoadingDisable(true);
        try {
            await fetchWithAuth('/auth/2fa/disable', {
                method: 'POST',
                body: JSON.stringify({ code: disableCode }),
                headers: { 'Content-Type': 'application/json' },
            });
            onToast({ type: 'success', message: '2FA has been disabled.' });
            setDisableCode('');
            setShowDisableForm(false);
            onStatusChange(false);
        } catch (err: any) {
            onToast({ type: 'error', message: err?.message || 'Failed to disable 2FA. Check your code and try again.' });
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
                        <p className="text-sm font-bold text-green-800">Two-Factor Authentication is enabled</p>
                        <p className="text-xs text-green-600 mt-0.5">Your account is protected by an authenticator app.</p>
                    </div>
                </div>

                {/* Disable section */}
                {!showDisableForm ? (
                    <button
                        onClick={() => setShowDisableForm(true)}
                        className="inline-flex items-center gap-2 rounded-xl border border-red-200 px-4 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50 transition-colors"
                    >
                        <ShieldOff className="w-4 h-4" />
                        Disable 2FA
                    </button>
                ) : (
                    <form onSubmit={handleDisable} className="space-y-4">
                        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                            <p className="font-semibold">Are you sure you want to disable 2FA?</p>
                            <p className="mt-0.5 text-amber-700">Enter your current authenticator code to confirm.</p>
                        </div>
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                                Authenticator Code
                            </label>
                            <input
                                type="text"
                                inputMode="numeric"
                                pattern="\d{6}"
                                maxLength={6}
                                value={disableCode}
                                onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                placeholder="6-digit code"
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
                                {loadingDisable ? 'Disabling…' : 'Disable 2FA'}
                            </button>
                            <button
                                type="button"
                                onClick={() => { setShowDisableForm(false); setDisableCode(''); }}
                                className="rounded-xl border border-gray-200 px-5 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors"
                            >
                                Cancel
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
                    <p className="text-sm font-bold text-gray-700">Two-Factor Authentication is disabled</p>
                    <p className="text-xs text-gray-500 mt-0.5">Add an extra layer of security to your account.</p>
                </div>
            </div>

            <div className="space-y-1">
                <h3 className="text-sm font-bold text-gray-800">Set up Two-Factor Authentication</h3>
                <p className="text-sm text-gray-500">
                    Use an authenticator app like Google Authenticator or Authy to generate one-time codes.
                </p>
            </div>

            {/* Step 1 */}
            <div className="space-y-3">
                <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-black flex items-center justify-center flex-shrink-0">
                        1
                    </span>
                    <span className="text-sm font-semibold text-gray-700">Generate QR Code</span>
                </div>

                {!setup ? (
                    <button
                        onClick={handleGenerateQR}
                        disabled={loadingSetup}
                        className="inline-flex items-center gap-2 ml-8 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors shadow-sm"
                    >
                        {loadingSetup && <Loader2 className="w-4 h-4 animate-spin" />}
                        {loadingSetup ? 'Generating…' : 'Generate QR Code'}
                    </button>
                ) : (
                    <div className="ml-8 space-y-4">
                        {/* QR Code image */}
                        <div className="inline-block rounded-xl border-2 border-gray-200 p-3 bg-white">
                            {/* qrCodeDataUrl is a data URI from the backend */}
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                                src={setup.qrCodeDataUrl}
                                alt="2FA QR Code"
                                className="w-40 h-40 block"
                            />
                        </div>

                        {/* Manual entry fallback */}
                        <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 space-y-1">
                            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                                Can&apos;t scan? Enter this key manually:
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
                            Regenerate QR Code
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
                        <span className="text-sm font-semibold text-gray-700">Verify with Authenticator App</span>
                    </div>

                    <form onSubmit={handleEnable} className="ml-8 space-y-4">
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                                Enter 6-digit code from your app
                            </label>
                            <input
                                type="text"
                                inputMode="numeric"
                                pattern="\d{6}"
                                maxLength={6}
                                value={enableCode}
                                onChange={(e) => setEnableCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                placeholder="000000"
                                className="w-48 rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition tracking-widest font-mono text-center"
                            />
                        </div>
                        <button
                            type="submit"
                            disabled={loadingEnable || enableCode.length !== 6}
                            className="inline-flex items-center gap-2 rounded-xl bg-green-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-green-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors shadow-sm"
                        >
                            {loadingEnable && <Loader2 className="w-4 h-4 animate-spin" />}
                            {loadingEnable ? 'Verifying…' : 'Enable 2FA'}
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
        { key: 'profile', label: 'Profile' },
        { key: 'password', label: 'Password' },
        { key: '2fa', label: 'Two-Factor Auth' },
    ];

    const quickLinks = [
        {
            href: '/dashboard/settings/localization',
            icon: Globe,
            label: t.settings.quickLinks.localizationLabel,
            description: t.settings.quickLinks.localizationDescription,
        },
        {
            href: '/dashboard/settings/branding',
            icon: Palette,
            label: 'Branding',
            description: 'Customize logo, colors, and business name',
        },
        {
            href: '/dashboard/settings/tax',
            icon: Receipt,
            label: 'Tax / VAT',
            description: 'VAT rate, BIN, and NBR compliance settings',
        },
        {
            href: '/dashboard/settings/loyalty',
            icon: Gift,
            label: 'Loyalty Program',
            description: 'Configure points earn & redeem rates',
        },
        {
            href: '/dashboard/settings/sms',
            icon: MessageSquare,
            label: 'SMS Notifications',
            description: 'Send sale receipts and low stock alerts via SMS',
        },
        {
            href: '/dashboard/settings/reports',
            icon: BarChart3,
            label: 'Automated Reports',
            description: 'Schedule weekly and monthly sales report emails',
        },
        {
            href: '/dashboard/settings/counters',
            icon: Monitor,
            label: 'POS Counters',
            description: 'Manage sales counters for multiple cashier stations',
        },
    ];

    return (
        <div className="h-full overflow-y-auto">
            <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
                {/* Page header */}
                <div>
                    <h1 className="text-2xl font-black text-gray-900 tracking-tight">Account Settings</h1>
                    <p className="mt-1 text-sm text-gray-500">Manage your profile, password, and security preferences.</p>
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
                                Loading…
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
