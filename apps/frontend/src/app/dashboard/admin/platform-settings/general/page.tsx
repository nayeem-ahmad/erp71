'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Settings, ArrowLeft, Loader2, CheckCircle, XCircle } from 'lucide-react';
import { fetchWithAuth } from '@/lib/api';

type GeneralSettings = {
    platform_name: string;
    support_email: string;
    maintenance_mode: string;
};

const DEFAULTS: GeneralSettings = {
    platform_name: 'RetailSaaS',
    support_email: 'support@retailsaas.app',
    maintenance_mode: 'false',
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

export default function PlatformGeneralSettingsPage() {
    const [settings, setSettings] = useState<GeneralSettings>(DEFAULTS);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [toast, setToast] = useState<Toast>(null);

    useEffect(() => {
        fetchWithAuth('/admin/platform-settings/general')
            .then((r) => r.json())
            .then((json) => {
                const d = json?.data ?? json;
                setSettings({
                    platform_name: d.platform_name ?? DEFAULTS.platform_name,
                    support_email: d.support_email ?? DEFAULTS.support_email,
                    maintenance_mode: d.maintenance_mode ?? DEFAULTS.maintenance_mode,
                });
            })
            .catch(() => setToast({ type: 'error', message: 'Failed to load settings.' }))
            .finally(() => setLoading(false));
    }, []);

    function set(key: keyof GeneralSettings, value: string) {
        setSettings((s) => ({ ...s, [key]: value }));
    }

    async function handleSave() {
        setSaving(true);
        try {
            const res = await fetchWithAuth('/admin/platform-settings/general', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ settings }),
            });
            if (!res.ok) throw new Error('Save failed');
            setToast({ type: 'success', message: 'General settings saved.' });
        } catch (e: any) {
            setToast({ type: 'error', message: e.message ?? 'Failed to save.' });
        } finally {
            setSaving(false);
        }
    }

    const inputCls = 'w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition';
    const maintenanceOn = settings.maintenance_mode === 'true';

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-6 font-sans text-gray-900">
            <div className="max-w-2xl mx-auto space-y-6">
                <div className="flex items-center gap-3">
                    <Link href="/dashboard/admin/platform-settings" className="p-1.5 rounded-lg hover:bg-gray-200 transition-colors">
                        <ArrowLeft className="w-4 h-4 text-gray-500" />
                    </Link>
                    <Settings className="w-5 h-5 text-amber-600" />
                    <h1 className="text-xl font-black tracking-tight">General</h1>
                </div>

                {loading ? (
                    <div className="flex items-center gap-2 text-gray-400 text-sm py-8 justify-center">
                        <Loader2 className="w-4 h-4 animate-spin" /> Loading…
                    </div>
                ) : (
                    <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-5">
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-1">Platform Name</label>
                            <input
                                type="text"
                                value={settings.platform_name}
                                onChange={(e) => set('platform_name', e.target.value)}
                                placeholder="RetailSaaS"
                                className={inputCls}
                            />
                            <p className="mt-1 text-xs text-gray-400">Shown in email subjects and notifications.</p>
                        </div>

                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-1">Support Email</label>
                            <input
                                type="email"
                                value={settings.support_email}
                                onChange={(e) => set('support_email', e.target.value)}
                                placeholder="support@retailsaas.app"
                                className={inputCls}
                            />
                            <p className="mt-1 text-xs text-gray-400">Destination for contact form submissions.</p>
                        </div>

                        <div className="flex items-start justify-between gap-4 pt-2">
                            <div>
                                <p className="text-sm font-semibold text-gray-800">Maintenance Mode</p>
                                <p className="mt-0.5 text-xs text-gray-500">
                                    When enabled, the API returns a 503 for all non-admin requests.
                                </p>
                                {maintenanceOn && (
                                    <p className="mt-1 text-xs font-bold text-red-600">
                                        Maintenance mode is ON — tenants cannot access the platform.
                                    </p>
                                )}
                            </div>
                            <button
                                type="button"
                                role="switch"
                                aria-checked={maintenanceOn}
                                onClick={() => set('maintenance_mode', maintenanceOn ? 'false' : 'true')}
                                className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 ${maintenanceOn ? 'bg-red-600' : 'bg-gray-200'}`}
                            >
                                <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${maintenanceOn ? 'translate-x-5' : 'translate-x-0'}`} />
                            </button>
                        </div>

                        <div className="pt-2">
                            <button
                                onClick={handleSave}
                                disabled={saving}
                                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors shadow-sm"
                            >
                                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                                {saving ? 'Saving…' : 'Save Settings'}
                            </button>
                        </div>
                    </div>
                )}
            </div>

            <ToastBanner toast={toast} onDismiss={() => setToast(null)} />
        </div>
    );
}
