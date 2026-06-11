'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { MessageSquare, ArrowLeft, Loader2, CheckCircle, XCircle, Send } from 'lucide-react';
import { fetchWithAuth } from '@/lib/api';

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

export default function PlatformSmsSeetingsPage() {
    const [settings, setSettings] = useState<SmsSettings>(DEFAULTS);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [testPhone, setTestPhone] = useState('');
    const [testing, setTesting] = useState(false);
    const [toast, setToast] = useState<Toast>(null);

    useEffect(() => {
        fetchWithAuth('/admin/platform-settings/sms')
            .then((r) => r.json())
            .then((json) => {
                const d = json?.data ?? json;
                setSettings({
                    provider: d.provider ?? DEFAULTS.provider,
                    api_key: d.api_key === '••••••••' ? '' : (d.api_key ?? ''),
                    sender_id: d.sender_id ?? DEFAULTS.sender_id,
                    base_url: d.base_url ?? DEFAULTS.base_url,
                });
            })
            .catch(() => setToast({ type: 'error', message: 'Failed to load SMS settings.' }))
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

            const res = await fetchWithAuth('/admin/platform-settings/sms', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ settings: payload }),
            });
            if (!res.ok) throw new Error('Save failed');
            setSettings((prev) => ({ ...prev, api_key: '' }));
            setToast({ type: 'success', message: 'SMS settings saved.' });
        } catch (e: any) {
            setToast({ type: 'error', message: e.message ?? 'Failed to save.' });
        } finally {
            setSaving(false);
        }
    }

    async function handleTest() {
        if (!testPhone.trim()) return;
        setTesting(true);
        try {
            const res = await fetchWithAuth('/admin/platform-settings/sms/test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone: testPhone }),
            });
            if (!res.ok) throw new Error('Test failed');
            setToast({ type: 'success', message: `Test SMS dispatched to ${testPhone}.` });
        } catch (e: any) {
            setToast({ type: 'error', message: e.message ?? 'Test SMS failed.' });
        } finally {
            setTesting(false);
        }
    }

    const inputCls = 'w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition';

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-6 font-sans text-gray-900">
            <div className="max-w-2xl mx-auto space-y-6">
                <div className="flex items-center gap-3">
                    <Link href="/dashboard/admin/platform-settings" className="p-1.5 rounded-lg hover:bg-gray-200 transition-colors">
                        <ArrowLeft className="w-4 h-4 text-gray-500" />
                    </Link>
                    <MessageSquare className="w-5 h-5 text-green-600" />
                    <h1 className="text-xl font-black tracking-tight">SMS Gateway</h1>
                </div>

                {loading ? (
                    <div className="flex items-center gap-2 text-gray-400 text-sm py-8 justify-center">
                        <Loader2 className="w-4 h-4 animate-spin" /> Loading…
                    </div>
                ) : (
                    <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-5">
                        <Field label="Provider" hint="The SMS gateway service you are using.">
                            <select
                                value={settings.provider}
                                onChange={(e) => setSettings((s) => ({ ...s, provider: e.target.value }))}
                                className={inputCls}
                            >
                                <option value="bulksmsbd">Bulk SMS BD</option>
                                <option value="ssl_wireless">SSL Wireless</option>
                                <option value="alpha_net">Alpha Net</option>
                                <option value="other">Other</option>
                            </select>
                        </Field>

                        <Field label="API Key" hint="Leave blank to keep the existing key unchanged.">
                            <input
                                type="password"
                                autoComplete="new-password"
                                placeholder="Enter new API key (leave blank to keep existing)"
                                value={settings.api_key}
                                onChange={(e) => setSettings((s) => ({ ...s, api_key: e.target.value }))}
                                className={inputCls}
                            />
                        </Field>

                        <Field label="Sender ID" hint="The sender name or number shown on recipient devices.">
                            <input
                                type="text"
                                value={settings.sender_id}
                                onChange={(e) => setSettings((s) => ({ ...s, sender_id: e.target.value }))}
                                className={inputCls}
                            />
                        </Field>

                        <Field label="API Base URL" hint="The HTTP endpoint for your provider's send API.">
                            <input
                                type="url"
                                value={settings.base_url}
                                onChange={(e) => setSettings((s) => ({ ...s, base_url: e.target.value }))}
                                className={inputCls}
                            />
                        </Field>

                        <div className="pt-2 flex gap-3">
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

                {/* Test panel */}
                <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4">
                    <h2 className="text-sm font-black uppercase tracking-widest text-gray-400">Send Test SMS</h2>
                    <div className="flex gap-3">
                        <input
                            type="tel"
                            placeholder="e.g. 01712345678"
                            value={testPhone}
                            onChange={(e) => setTestPhone(e.target.value)}
                            className="flex-1 rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                        />
                        <button
                            onClick={handleTest}
                            disabled={testing || !testPhone.trim()}
                            className="inline-flex items-center gap-2 rounded-xl bg-green-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-green-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors shadow-sm"
                        >
                            {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                            {testing ? 'Sending…' : 'Send'}
                        </button>
                    </div>
                    <p className="text-xs text-gray-400">Uses the currently saved credentials. Save first to test new ones.</p>
                </div>
            </div>

            <ToastBanner toast={toast} onDismiss={() => setToast(null)} />
        </div>
    );
}
