'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Mail, ArrowLeft, Loader2, CheckCircle, XCircle, Send } from 'lucide-react';
import { fetchWithAuth } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

type EmailSettings = {
    smtp_host: string;
    smtp_port: string;
    smtp_user: string;
    smtp_pass: string;
    email_from: string;
    frontend_url: string;
};

const DEFAULTS: EmailSettings = {
    smtp_host: 'smtp-relay.brevo.com',
    smtp_port: '587',
    smtp_user: '',
    smtp_pass: '',
    email_from: 'notify@erp71.com',
    frontend_url: 'http://localhost:3000',
};

type Toast = { type: 'success' | 'error'; message: string } | null;

function ToastBanner({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
    useEffect(() => {
        if (!toast) return;
        const t = setTimeout(onDismiss, 4000);
        return () => clearTimeout(t);
    }, [toast, onDismiss]);

    if (!toast) return null;
    const isOk = toast.type === 'success';
    return (
        <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-xl px-4 py-3 shadow-lg border text-sm font-semibold ${isOk ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
            {isOk ? <CheckCircle className="w-4 h-4 text-green-500" /> : <XCircle className="w-4 h-4 text-red-500" />}
            {toast.message}
        </div>
    );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
    return (
        <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">{label}</label>
            {children}
            {hint && <p className="mt-1 text-xs text-gray-400">{hint}</p>}
        </div>
    );
}

export default function PlatformEmailSettingsPage() {
    const { t } = useI18n();
    const m = t.admin.platformSettings.email;
    const c = t.admin.platformSettings.common;
    const [settings, setSettings] = useState<EmailSettings>(DEFAULTS);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [testEmail, setTestEmail] = useState('');
    const [testing, setTesting] = useState(false);
    const [toast, setToast] = useState<Toast>(null);

    useEffect(() => {
        fetchWithAuth('/admin/platform-settings/email')
            .then((r) => r.json())
            .then((json) => {
                const d = json?.data ?? json;
                setSettings({
                    smtp_host: d.smtp_host ?? DEFAULTS.smtp_host,
                    smtp_port: d.smtp_port ?? DEFAULTS.smtp_port,
                    smtp_user: d.smtp_user ?? '',
                    smtp_pass: d.smtp_pass === '••••••••' ? '' : (d.smtp_pass ?? ''),
                    email_from: d.email_from ?? DEFAULTS.email_from,
                    frontend_url: d.frontend_url ?? DEFAULTS.frontend_url,
                });
            })
            .catch(() => setToast({ type: 'error', message: m.loadFailed }))
            .finally(() => setLoading(false));
    }, []);

    function set(key: keyof EmailSettings, value: string) {
        setSettings((s) => ({ ...s, [key]: value }));
    }

    async function handleSave() {
        setSaving(true);
        try {
            const payload: Record<string, string | null> = {
                smtp_host: settings.smtp_host,
                smtp_port: settings.smtp_port,
                smtp_user: settings.smtp_user,
                email_from: settings.email_from,
                frontend_url: settings.frontend_url,
            };
            if (settings.smtp_pass) payload.smtp_pass = settings.smtp_pass;

            const res = await fetchWithAuth('/admin/platform-settings/email', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ settings: payload }),
            });
            if (!res.ok) throw new Error('Save failed');
            setSettings((prev) => ({ ...prev, smtp_pass: '' }));
            setToast({ type: 'success', message: m.saved });
        } catch (e: any) {
            setToast({ type: 'error', message: e.message ?? c.saveFailed });
        } finally {
            setSaving(false);
        }
    }

    async function handleTest() {
        setTesting(true);
        try {
            const body: Record<string, string> = {};
            if (testEmail.trim()) body.email = testEmail.trim();
            const res = await fetchWithAuth('/admin/platform-settings/email/test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                const errMsg = json?.message ?? json?.error ?? (Array.isArray(json?.message) ? json.message.join(', ') : null);
                throw new Error(errMsg || m.test.failed);
            }
            const msg = (json?.data ?? json)?.message ?? m.test.success;
            setToast({ type: 'success', message: msg });
        } catch (e: any) {
            setToast({ type: 'error', message: e.message ?? m.test.failed });
        } finally {
            setTesting(false);
        }
    }

    const inputCls = 'w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition';

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-3 md:p-4 font-sans text-gray-900 text-[13px]">
            <div className="max-w-2xl mx-auto space-y-6">
                <div className="flex items-center gap-3">
                    <Link href="/admin/platform-settings" className="p-1.5 rounded-lg hover:bg-gray-200 transition-colors">
                        <ArrowLeft className="w-4 h-4 text-gray-500" />
                    </Link>
                    <Mail className="w-5 h-5 text-blue-600" />
                    <h1 className="text-xl font-black tracking-tight">{m.title}</h1>
                </div>

                {loading ? (
                    <div className="flex items-center gap-2 text-gray-400 text-sm py-8 justify-center">
                        <Loader2 className="w-4 h-4 animate-spin" /> {c.loading}
                    </div>
                ) : (
                    <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-5">
                        <div className="grid grid-cols-2 gap-4">
                            <Field label={m.smtpHost}>
                                <input
                                    type="text"
                                    value={settings.smtp_host}
                                    onChange={(e) => set('smtp_host', e.target.value)}
                                    placeholder="smtp-relay.brevo.com"
                                    className={inputCls}
                                />
                            </Field>
                            <Field label={m.smtpPort}>
                                <input
                                    type="number"
                                    value={settings.smtp_port}
                                    onChange={(e) => set('smtp_port', e.target.value)}
                                    placeholder="587"
                                    className={inputCls}
                                />
                            </Field>
                        </div>

                        <Field label={m.smtpUser}>
                            <input
                                type="text"
                                autoComplete="username"
                                value={settings.smtp_user}
                                onChange={(e) => set('smtp_user', e.target.value)}
                                placeholder="your@email.com"
                                className={inputCls}
                            />
                        </Field>

                        <Field label={m.smtpPass.label} hint={c.secretPasswordHint}>
                            <input
                                type="password"
                                autoComplete="new-password"
                                value={settings.smtp_pass}
                                onChange={(e) => set('smtp_pass', e.target.value)}
                                placeholder={m.smtpPass.placeholder}
                                className={inputCls}
                            />
                        </Field>

                        <Field label={m.fromAddress.label} hint={m.fromAddress.hint}>
                            <input
                                type="email"
                                value={settings.email_from}
                                onChange={(e) => set('email_from', e.target.value)}
                                placeholder="noreply@erp71.com"
                                className={inputCls}
                            />
                        </Field>

                        <Field label={m.frontendUrl.label} hint={m.frontendUrl.hint}>
                            <input
                                type="url"
                                value={settings.frontend_url}
                                onChange={(e) => set('frontend_url', e.target.value)}
                                placeholder="https://app.erp71.com"
                                className={inputCls}
                            />
                        </Field>

                        <div className="pt-2">
                            <button
                                onClick={handleSave}
                                disabled={saving}
                                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors shadow-sm"
                            >
                                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                                {saving ? c.saving : c.saveSettings}
                            </button>
                        </div>
                    </div>
                )}

                {/* Test panel */}
                <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4">
                    <h2 className="text-sm font-black uppercase tracking-widest text-gray-400">{m.test.title}</h2>
                    <div className="flex gap-3">
                        <input
                            type="email"
                            placeholder={m.test.placeholder}
                            value={testEmail}
                            onChange={(e) => setTestEmail(e.target.value)}
                            className="flex-1 rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                        />
                        <button
                            onClick={handleTest}
                            disabled={testing}
                            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors shadow-sm"
                        >
                            {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                            {testing ? c.sending : c.send}
                        </button>
                    </div>
                    <p className="text-xs text-gray-400">{c.testHint}</p>
                </div>
            </div>

            <ToastBanner toast={toast} onDismiss={() => setToast(null)} />
        </div>
    );
}
