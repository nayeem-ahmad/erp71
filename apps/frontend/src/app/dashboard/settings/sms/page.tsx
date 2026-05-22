'use client';

import { useState, useEffect } from 'react';
import { MessageSquare, CheckCircle, Info, Loader2 } from 'lucide-react';
import { fetchWithAuth } from '@/lib/api';

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
    const [settings, setSettings] = useState<SmsSettings>({
        sms_enabled: false,
        sms_on_sale: false,
        sms_on_low_stock: false,
    });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [success, setSuccess] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        fetchWithAuth('/api/v1/tenants/sms-settings')
            .then((r) => r.json())
            .then((json) => {
                const d = json?.data ?? json;
                if (d) {
                    setSettings({
                        sms_enabled: d.sms_enabled ?? false,
                        sms_on_sale: d.sms_on_sale ?? false,
                        sms_on_low_stock: d.sms_on_low_stock ?? false,
                    });
                }
            })
            .catch(() => setError('Failed to load SMS settings.'))
            .finally(() => setLoading(false));
    }, []);

    async function handleSave() {
        setSaving(true);
        setError('');
        setSuccess(false);
        try {
            const res = await fetchWithAuth('/api/v1/tenants/sms-settings', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(settings),
            });
            if (!res.ok) throw new Error('Save failed');
            setSuccess(true);
            setTimeout(() => setSuccess(false), 3000);
        } catch (e: any) {
            setError(e.message ?? 'Failed to save SMS settings.');
        } finally {
            setSaving(false);
        }
    }

    function updateSetting<K extends keyof SmsSettings>(key: K, value: SmsSettings[K]) {
        setSettings((prev) => ({ ...prev, [key]: value }));
    }

    return (
        <div className="p-6 max-w-2xl space-y-6">
            <div className="flex items-center gap-2">
                <MessageSquare className="h-6 w-6 text-gray-600" />
                <h1 className="text-2xl font-bold text-gray-900">SMS Notifications</h1>
            </div>

            {/* Info box */}
            <div className="flex gap-3 bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800">
                <Info className="h-5 w-5 flex-shrink-0 mt-0.5 text-blue-500" />
                <div>
                    <strong>Server configuration required</strong> — SMS delivery requires the following
                    environment variables to be set on the server:{' '}
                    <code className="font-mono text-xs bg-blue-100 px-1 py-0.5 rounded">SMS_API_URL</code>,{' '}
                    <code className="font-mono text-xs bg-blue-100 px-1 py-0.5 rounded">SMS_API_TOKEN</code>,{' '}
                    <code className="font-mono text-xs bg-blue-100 px-1 py-0.5 rounded">SMS_SENDER_ID</code>.
                    Contact support to configure. Compatible with SSL Wireless, Bulk SMS BD, Alpha SMS,
                    and other Bangladeshi SMS gateways.
                </div>
            </div>

            {loading ? (
                <div className="flex items-center gap-2 text-gray-400 py-8 justify-center text-sm">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Loading…
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
                                Master switch for all SMS notifications for this tenant.
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
                                Sends the customer a purchase confirmation SMS after a completed sale.
                                Requires the customer to have a phone number on file.
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
                                Sends the tenant owner an SMS when products fall below their reorder
                                point during the daily stock check.
                            </p>
                        </div>
                        <Toggle
                            id="sms_on_low_stock"
                            checked={settings.sms_on_low_stock}
                            onChange={(v) => updateSetting('sms_on_low_stock', v)}
                            disabled={!settings.sms_enabled}
                        />
                    </div>

                    {error && (
                        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm">
                            {error}
                        </div>
                    )}

                    {success && (
                        <div className="flex items-center gap-2 bg-green-50 border border-green-200 text-green-700 rounded-lg p-3 text-sm">
                            <CheckCircle className="h-4 w-4 flex-shrink-0" />
                            SMS settings saved successfully.
                        </div>
                    )}

                    <div className="pt-2">
                        <button
                            onClick={handleSave}
                            disabled={saving}
                            className="inline-flex items-center gap-2 px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                            {saving ? 'Saving…' : 'Save SMS Settings'}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
