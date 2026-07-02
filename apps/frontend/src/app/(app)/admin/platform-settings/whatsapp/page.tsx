'use client';

import { useEffect, useState } from 'react';
import { Loader2, CheckCircle, XCircle, Send } from 'lucide-react';
import PageHeader from '@/components/ui/compact/PageHeader';
import { nestedPageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { routes } from '@/lib/routes';
import { fetchWithAuth } from '@/lib/api';
import { useI18n, formatMessage } from '@/lib/i18n';

type WhatsAppSettings = {
    access_token: string;
    phone_number_id: string;
    api_version: string;
};

const DEFAULTS: WhatsAppSettings = {
    access_token: '',
    phone_number_id: '',
    api_version: 'v18.0',
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

export default function PlatformWhatsAppSettingsPage() {
    const { t } = useI18n();
    const m = t.admin.platformSettings.whatsapp;
    const c = t.admin.platformSettings.common;
    const [settings, setSettings] = useState<WhatsAppSettings>(DEFAULTS);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [testPhone, setTestPhone] = useState('');
    const [testing, setTesting] = useState(false);
    const [toast, setToast] = useState<Toast>(null);

    useEffect(() => {
        fetchWithAuth('/admin/platform-settings/whatsapp')
            .then((r) => r.json())
            .then((json) => {
                const d = json?.data ?? json;
                setSettings({
                    access_token: d.access_token === '••••••••' ? '' : (d.access_token ?? ''),
                    phone_number_id: d.phone_number_id ?? '',
                    api_version: d.api_version ?? DEFAULTS.api_version,
                });
            })
            .catch(() => setToast({ type: 'error', message: m.loadFailed }))
            .finally(() => setLoading(false));
    }, []);

    function set(key: keyof WhatsAppSettings, value: string) {
        setSettings((s) => ({ ...s, [key]: value }));
    }

    async function handleSave() {
        setSaving(true);
        try {
            const payload: Record<string, string | null> = {
                phone_number_id: settings.phone_number_id,
                api_version: settings.api_version,
            };
            if (settings.access_token) payload.access_token = settings.access_token;

            const res = await fetchWithAuth('/admin/platform-settings/whatsapp', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ settings: payload }),
            });
            if (!res.ok) throw new Error('Save failed');
            setSettings((prev) => ({ ...prev, access_token: '' }));
            setToast({ type: 'success', message: m.saved });
        } catch (e: any) {
            setToast({ type: 'error', message: e.message ?? c.saveFailed });
        } finally {
            setSaving(false);
        }
    }

    async function handleTest() {
        if (!testPhone.trim()) return;
        setTesting(true);
        try {
            const res = await fetchWithAuth('/admin/platform-settings/whatsapp/test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone: testPhone.trim() }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                const errMsg = json?.message ?? json?.error ?? (Array.isArray(json?.message) ? json.message.join(', ') : null);
                throw new Error(errMsg || m.test.failed);
            }
            const msg = (json?.data ?? json)?.message ?? formatMessage(m.test.success, { phone: testPhone.trim() });
            setToast({ type: 'success', message: msg });
        } catch (e: any) {
            setToast({ type: 'error', message: e.message ?? m.test.failed });
        } finally {
            setTesting(false);
        }
    }

    const inputCls = 'w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition';

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-3 md:p-4 font-sans text-gray-900 text-[13px]">
            <div className="max-w-2xl mx-auto space-y-6">
                <PageHeader
                    title={m.title}
                    breadcrumbs={nestedPageBreadcrumbs(
                        t.dashboardHome.breadcrumbHome,
                        t.sidebar.modules.admin,
                        'admin',
                        [{ label: t.admin.platformSettings.index.title, href: routes.admin.platformSettings.root }],
                        m.title,
                    )}
                />

                {loading ? (
                    <div className="flex items-center gap-2 text-gray-400 text-sm py-8 justify-center">
                        <Loader2 className="w-4 h-4 animate-spin" /> {c.loading}
                    </div>
                ) : (
                    <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-5">
                        <p className="text-sm text-gray-500 leading-relaxed">{m.description}</p>

                        <Field label={m.accessToken.label} hint={c.apiKeyHint}>
                            <input
                                type="password"
                                autoComplete="new-password"
                                value={settings.access_token}
                                onChange={(e) => set('access_token', e.target.value)}
                                placeholder={m.accessToken.placeholder}
                                className={inputCls}
                            />
                        </Field>

                        <Field label={m.phoneNumberId.label} hint={m.phoneNumberId.hint}>
                            <input
                                type="text"
                                value={settings.phone_number_id}
                                onChange={(e) => set('phone_number_id', e.target.value)}
                                placeholder="123456789012345"
                                className={inputCls}
                            />
                        </Field>

                        <Field label={m.apiVersion.label} hint={m.apiVersion.hint}>
                            <input
                                type="text"
                                value={settings.api_version}
                                onChange={(e) => set('api_version', e.target.value)}
                                placeholder="v18.0"
                                className={inputCls}
                            />
                        </Field>

                        <div className="pt-2">
                            <button
                                onClick={handleSave}
                                disabled={saving}
                                className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors shadow-sm"
                            >
                                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                                {saving ? c.saving : c.saveSettings}
                            </button>
                        </div>
                    </div>
                )}

                <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4">
                    <h2 className="text-sm font-black uppercase tracking-widest text-gray-400">{m.test.title}</h2>
                    <div className="flex gap-3">
                        <input
                            type="tel"
                            placeholder={m.test.placeholder}
                            value={testPhone}
                            onChange={(e) => setTestPhone(e.target.value)}
                            className="flex-1 rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition"
                        />
                        <button
                            onClick={handleTest}
                            disabled={testing || !testPhone.trim()}
                            className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors shadow-sm"
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