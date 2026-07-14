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

type SmsSettings = {
    provider: string;
    api_key: string;
    sender_id: string;
    base_url: string;
};

const DEFAULTS: SmsSettings = {
    provider: 'bulksmsbd',
    api_key: '',
    sender_id: '8809617621294',
    base_url: 'http://bulksmsbd.net/api/smsapi',
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

export default function PlatformSmsSeetingsPage() {
    const { t } = useI18n();
    const m = t.admin.platformSettings.sms;
    const c = t.admin.platformSettings.common;
    const [settings, setSettings] = useState<SmsSettings>(DEFAULTS);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [testPhone, setTestPhone] = useState('');
    const [testing, setTesting] = useState(false);

    useEffect(() => {
        fetchWithAuth('/admin/platform-settings/sms')
            .then((d) => {
                setSettings({
                    provider: d.provider ?? DEFAULTS.provider,
                    api_key: d.api_key === '••••••••' ? '' : (d.api_key ?? ''),
                    sender_id: d.sender_id ?? DEFAULTS.sender_id,
                    base_url: d.base_url ?? DEFAULTS.base_url,
                });
            })
            .catch(() => toast.error(m.loadFailed))
            .finally(() => setLoading(false));
    }, []);

    async function handleSave() {
        setSaving(true);
        try {
            const payload: Record<string, string | null> = {
                provider: settings.provider,
                sender_id: settings.sender_id,
                base_url: settings.base_url,
            };
            // Only send api_key if the user typed a new value
            if (settings.api_key) payload.api_key = settings.api_key;

            await fetchWithAuth('/admin/platform-settings/sms', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ settings: payload }),
            });
            setSettings((prev) => ({ ...prev, api_key: '' }));
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
            await fetchWithAuth('/admin/platform-settings/sms/test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone: testPhone }),
            });
            toast.success(formatMessage(m.test.success, { phone: testPhone }));
        } catch (e: any) {
            toast.error(e.message ?? m.test.failed);
        } finally {
            setTesting(false);
        }
    }

    const inputCls = 'w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition';

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
                    <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-5">
                        <Field label={m.provider.label} hint={m.provider.hint}>
                            <select
                                value={settings.provider}
                                onChange={(e) => setSettings((s) => ({ ...s, provider: e.target.value }))}
                                className={inputCls}
                            >
                                <option value="bulksmsbd">{m.providers.bulksmsbd}</option>
                                <option value="ssl_wireless">{m.providers.sslWireless}</option>
                                <option value="alpha_net">{m.providers.alphaNet}</option>
                                <option value="other">{m.providers.other}</option>
                            </select>
                        </Field>

                        <Field label={m.apiKey.label} hint={c.apiKeyHint}>
                            <input
                                type="password"
                                autoComplete="new-password"
                                placeholder={m.apiKey.placeholder}
                                value={settings.api_key}
                                onChange={(e) => setSettings((s) => ({ ...s, api_key: e.target.value }))}
                                className={inputCls}
                            />
                        </Field>

                        <Field label={m.senderId.label} hint={m.senderId.hint}>
                            <input
                                type="text"
                                value={settings.sender_id}
                                onChange={(e) => setSettings((s) => ({ ...s, sender_id: e.target.value }))}
                                className={inputCls}
                            />
                        </Field>

                        <Field label={m.baseUrl.label} hint={m.baseUrl.hint}>
                            <input
                                type="url"
                                value={settings.base_url}
                                onChange={(e) => setSettings((s) => ({ ...s, base_url: e.target.value }))}
                                className={inputCls}
                            />
                        </Field>

                        <div className="pt-2 flex gap-3">
                            <Button onClick={handleSave} loading={saving} size="md">
                                {saving ? c.saving : c.saveSettings}
                            </Button>
                        </div>
                    </div>
                )}

                <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
                    <h2 className="text-sm font-medium text-gray-500">{m.test.title}</h2>
                    <div className="flex gap-3">
                        <input
                            type="tel"
                            placeholder={m.test.placeholder}
                            value={testPhone}
                            onChange={(e) => setTestPhone(e.target.value)}
                            className="flex-1 rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
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
