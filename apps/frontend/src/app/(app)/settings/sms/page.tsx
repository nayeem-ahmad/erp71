'use client';
import { useI18n, formatMessage } from '@/lib/i18n';

import { useState, useEffect } from 'react';
import { MessageSquare, Loader2 } from 'lucide-react';
import { fetchWithAuth } from '@/lib/api';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { toast } from '@/lib/toast';
import { Alert, Button, PageShell } from '@/components/ui';

type SmsSettings = {
    sms_enabled: boolean;
    sms_on_sale: boolean;
    sms_on_low_stock: boolean;
};

function Toggle({
    id,
    checked,
    onChange,
    disabled,
}: {
    id: string;
    checked: boolean;
    onChange: (v: boolean) => void;
    disabled?: boolean;
}) {
    return (
        <button
            id={id}
            type="button"
            role="switch"
            aria-checked={checked}
            disabled={disabled}
            onClick={() => onChange(!checked)}
            className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
                checked ? 'bg-blue-600' : 'bg-gray-200'
            }`}
        >
            <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    checked ? 'translate-x-5' : 'translate-x-0'
                }`}
            />
        </button>
    );
}

export default function SmsSettingsPage() {
    const { t } = useI18n();
    const m = t.settingsExtras.sms;
    const [settings, setSettings] = useState<SmsSettings>({
        sms_enabled: false,
        sms_on_sale: false,
        sms_on_low_stock: false,
    });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        fetchWithAuth('/tenants/sms-settings')
            .then((d) => {
                if (d) {
                    setSettings({
                        sms_enabled: d.sms_enabled ?? false,
                        sms_on_sale: d.sms_on_sale ?? false,
                        sms_on_low_stock: d.sms_on_low_stock ?? false,
                    });
                }
            })
            .catch(() => setError(m.loadFailed))
            .finally(() => setLoading(false));
    }, []);

    async function handleSave() {
        setSaving(true);
        setError('');
        try {
            await fetchWithAuth('/tenants/sms-settings', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(settings),
            });
            toast.success(m.saved);
        } catch (e: any) {
            setError(e.message ?? m.saveFailed);
        } finally {
            setSaving(false);
        }
    }

    function updateSetting<K extends keyof SmsSettings>(key: K, value: SmsSettings[K]) {
        setSettings((prev) => ({ ...prev, [key]: value }));
    }

    return (
        <PageShell maxWidth="full" className="space-y-4">
            <PageHeader
                title={(
                    <span className="inline-flex items-center gap-2">
                        <MessageSquare className="h-6 w-6 text-gray-600" />
                        {m.title}
                    </span>
                )}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.accountSettings,
                    m.title,
                    'settings',
                )}
            />

            {/* Info box */}
            <Alert tone="info">
                <strong>{m.infoTitle}</strong> — {m.infoBody}
            </Alert>

            {loading ? (
                <div className="flex items-center gap-2 text-gray-400 py-8 justify-center text-sm">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {m.loading}
                </div>
            ) : (
                <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-6">
                    {/* Enable SMS Notifications */}
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <label
                                htmlFor="sms_enabled"
                                className="block text-sm font-semibold text-gray-800"
                            >
                                Enable SMS Notifications
                            </label>
                            <p className="mt-0.5 text-xs text-gray-500">
                                {m.enable.hint}
                            </p>
                        </div>
                        <Toggle
                            id="sms_enabled"
                            checked={settings.sms_enabled}
                            onChange={(v) => updateSetting('sms_enabled', v)}
                        />
                    </div>

                    <hr className="border-gray-100" />

                    {/* Send SMS receipt after each sale */}
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <label
                                htmlFor="sms_on_sale"
                                className={`block text-sm font-semibold ${
                                    settings.sms_enabled ? 'text-gray-800' : 'text-gray-400'
                                }`}
                            >
                                Send SMS receipt after each sale
                            </label>
                            <p className="mt-0.5 text-xs text-gray-500">
                                {m.onSale.hint}
                            </p>
                        </div>
                        <Toggle
                            id="sms_on_sale"
                            checked={settings.sms_on_sale}
                            onChange={(v) => updateSetting('sms_on_sale', v)}
                            disabled={!settings.sms_enabled}
                        />
                    </div>

                    <hr className="border-gray-100" />

                    {/* Send SMS for low stock alerts */}
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <label
                                htmlFor="sms_on_low_stock"
                                className={`block text-sm font-semibold ${
                                    settings.sms_enabled ? 'text-gray-800' : 'text-gray-400'
                                }`}
                            >
                                Send SMS for low stock alerts
                            </label>
                            <p className="mt-0.5 text-xs text-gray-500">
                                {m.onLowStock.hint}
                            </p>
                        </div>
                        <Toggle
                            id="sms_on_low_stock"
                            checked={settings.sms_on_low_stock}
                            onChange={(v) => updateSetting('sms_on_low_stock', v)}
                            disabled={!settings.sms_enabled}
                        />
                    </div>

                    {error && <Alert tone="danger">{error}</Alert>}

                    <div className="pt-2">
                        <Button onClick={handleSave} disabled={saving} loading={saving}>
                            {saving ? m.saving : m.saveButton}
                        </Button>
                    </div>
                </div>
            )}
        </PageShell>
    );
}
