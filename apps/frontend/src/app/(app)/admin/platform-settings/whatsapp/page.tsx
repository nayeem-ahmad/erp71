'use client';

import { useEffect, useState } from 'react';
import { Loader2, Send } from 'lucide-react';
import PageHeader from '@/components/ui/compact/PageHeader';
import { PageShell, Button } from '@/components/ui';
import { nestedPageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { routes } from '@/lib/routes';
import { fetchWithAuth } from '@/lib/api';
import { toast } from '@/lib/toast';
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

    useEffect(() => {
        fetchWithAuth('/admin/platform-settings/whatsapp')
            .then((d) => {
                setSettings({
                    access_token: d.access_token === '••••••••' ? '' : (d.access_token ?? ''),
                    phone_number_id: d.phone_number_id ?? '',
                    api_version: d.api_version ?? DEFAULTS.api_version,
                });
            })
            .catch(() => toast.error(m.loadFailed))
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

            await fetchWithAuth('/admin/platform-settings/whatsapp', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ settings: payload }),
            });
            setSettings((prev) => ({ ...prev, access_token: '' }));
            toast.success(m.saved);
        } catch (e: any) {
            toast.error(e.message ?? c.saveFailed);
        } finally {
            setSaving(false);
        }
    }

    async function handleTest() {
        if (!testPhone.trim()) return;
        setTesting(true);
        try {
            const result = await fetchWithAuth('/admin/platform-settings/whatsapp/test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone: testPhone.trim() }),
            });
            const msg = result?.message ?? formatMessage(m.test.success, { phone: testPhone.trim() });
            toast.success(msg);
        } catch (e: any) {
            toast.error(e.message ?? m.test.failed);
        } finally {
            setTesting(false);
        }
    }

    const inputCls = 'w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition';

    return (
        <PageShell>
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
                            <Button onClick={handleSave} loading={saving} size="md">
                                {saving ? c.saving : c.saveSettings}
                            </Button>
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
                        <Button
                            onClick={handleTest}
                            disabled={!testPhone.trim()}
                            loading={testing}
                            icon={!testing ? <Send className="w-4 h-4" /> : undefined}
                            size="md"
                        >
                            {testing ? c.sending : c.send}
                        </Button>
                    </div>
                    <p className="text-xs text-gray-400">{c.testHint}</p>
                </div>
            </div>

        </PageShell>
    );
}