'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Sparkles, ArrowLeft, Loader2, CheckCircle, XCircle, Zap } from 'lucide-react';
import { fetchWithAuth } from '@/lib/api';

type AiSettings = {
    api_key: string;
    default_model: string;
};

const DEFAULTS: AiSettings = {
    api_key: '',
    default_model: 'anthropic/claude-haiku-4.5',
};

const MODEL_OPTIONS = [
    { value: 'anthropic/claude-haiku-4.5', label: 'Claude Haiku 4.5 — fastest, lowest cost' },
    { value: 'anthropic/claude-sonnet-4.6', label: 'Claude Sonnet 4.6 — balanced quality' },
    { value: 'anthropic/claude-opus-4.5', label: 'Claude Opus 4.5 — most capable' },
    { value: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash — very low cost' },
    { value: 'openai/gpt-4o-mini', label: 'GPT-4o Mini — fast OpenAI model' },
];

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

export default function PlatformAiSettingsPage() {
    const [settings, setSettings] = useState<AiSettings>(DEFAULTS);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [toast, setToast] = useState<Toast>(null);

    const inputCls = 'w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition';

    useEffect(() => {
        fetchWithAuth('/admin/platform-settings/ai')
            .then((r) => r.json())
            .then((json) => {
                const d = json?.data ?? json;
                setSettings({
                    api_key: d.api_key === '••••••••' ? '' : (d.api_key ?? ''),
                    default_model: d.default_model ?? DEFAULTS.default_model,
                });
            })
            .catch(() => setToast({ type: 'error', message: 'Failed to load AI settings.' }))
            .finally(() => setLoading(false));
    }, []);

    async function handleSave() {
        setSaving(true);
        try {
            const payload: Record<string, string | null> = {
                default_model: settings.default_model,
            };
            if (settings.api_key) payload.api_key = settings.api_key;

            const res = await fetchWithAuth('/admin/platform-settings/ai', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ settings: payload }),
            });
            if (!res.ok) throw new Error('Save failed');
            setSettings((prev) => ({ ...prev, api_key: '' }));
            setToast({ type: 'success', message: 'AI settings saved.' });
        } catch (e: any) {
            setToast({ type: 'error', message: e.message ?? 'Failed to save.' });
        } finally {
            setSaving(false);
        }
    }

    async function handleTest() {
        setTesting(true);
        try {
            const res = await fetchWithAuth('/admin/platform-settings/ai/test', { method: 'POST' });
            const json = await res.json();
            const result = json?.data ?? json;
            if (result?.success) {
                setToast({ type: 'success', message: `Connection OK — model: ${result.model}` });
            } else {
                setToast({ type: 'error', message: result?.message ?? 'Test failed.' });
            }
        } catch (e: any) {
            setToast({ type: 'error', message: e.message ?? 'Test failed.' });
        } finally {
            setTesting(false);
        }
    }

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-6 font-sans text-gray-900">
            <div className="max-w-2xl mx-auto space-y-6">
                <div className="flex items-center gap-3">
                    <Link href="/admin/platform-settings" className="p-1.5 rounded-lg hover:bg-gray-200 transition-colors">
                        <ArrowLeft className="w-4 h-4 text-gray-500" />
                    </Link>
                    <Sparkles className="w-5 h-5 text-purple-600" />
                    <h1 className="text-xl font-black tracking-tight">AI Settings</h1>
                </div>

                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    <strong>Platform-wide secret.</strong> This OpenRouter API key is used by all tenants for AI features. Keep it confidential. Get your key from{' '}
                    <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer" className="underline">openrouter.ai/keys</a>.
                </div>

                {loading ? (
                    <div className="flex items-center gap-2 text-gray-400 text-sm py-8 justify-center">
                        <Loader2 className="w-4 h-4 animate-spin" /> Loading…
                    </div>
                ) : (
                    <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-5">
                        <Field
                            label="OpenRouter API Key"
                            hint="Leave blank to keep existing value. Stored encrypted. Falls back to OPENROUTER_API_KEY env var if unset."
                        >
                            <input
                                type="password"
                                autoComplete="new-password"
                                value={settings.api_key}
                                onChange={(e) => setSettings((s) => ({ ...s, api_key: e.target.value }))}
                                placeholder="sk-or-••••••••"
                                className={inputCls}
                            />
                        </Field>

                        <Field
                            label="Default model"
                            hint="OpenRouter model slug used for report narration and message drafting. Haiku is recommended for cost efficiency."
                        >
                            <select
                                value={settings.default_model}
                                onChange={(e) => setSettings((s) => ({ ...s, default_model: e.target.value }))}
                                className={inputCls}
                            >
                                {MODEL_OPTIONS.map((o) => (
                                    <option key={o.value} value={o.value}>{o.label}</option>
                                ))}
                            </select>
                        </Field>

                        <div className="pt-2">
                            <button
                                onClick={handleSave}
                                disabled={saving}
                                className="inline-flex items-center gap-2 rounded-xl bg-purple-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-purple-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors shadow-sm"
                            >
                                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                                {saving ? 'Saving…' : 'Save settings'}
                            </button>
                        </div>
                    </div>
                )}

                <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4">
                    <h2 className="text-sm font-black uppercase tracking-widest text-gray-400">Connection test</h2>
                    <p className="text-sm text-gray-500">
                        Sends a single short message through OpenRouter to verify the API key works. Uses ~10 tokens (negligible cost).
                    </p>
                    <button
                        onClick={handleTest}
                        disabled={testing}
                        className="inline-flex items-center gap-2 rounded-xl bg-purple-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-purple-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors shadow-sm"
                    >
                        {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                        {testing ? 'Testing…' : 'Test connection'}
                    </button>
                </div>

                <div className="bg-white rounded-2xl border border-gray-200 p-6">
                    <h2 className="text-sm font-black uppercase tracking-widest text-gray-400 mb-3">Pricing reference</h2>
                    <p className="text-sm text-gray-500 mb-3">
                        OpenRouter bills per model. Actual cost is recorded from each API response. See{' '}
                        <a href="https://openrouter.ai/models" target="_blank" rel="noopener noreferrer" className="text-purple-600 underline">openrouter.ai/models</a>{' '}
                        for live rates.
                    </p>
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-xs font-semibold text-gray-400 uppercase tracking-wider border-b border-gray-100">
                                <th className="text-left pb-2">Model</th>
                                <th className="text-right pb-2">Typical input /M</th>
                                <th className="text-right pb-2">Typical output /M</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                            <tr><td className="py-2 font-medium">Claude Haiku 4.5</td><td className="text-right text-gray-600">~$1.00</td><td className="text-right text-gray-600">~$5.00</td></tr>
                            <tr><td className="py-2 font-medium">Claude Sonnet 4.6</td><td className="text-right text-gray-600">~$3.00</td><td className="text-right text-gray-600">~$15.00</td></tr>
                            <tr><td className="py-2 font-medium">Claude Opus 4.5</td><td className="text-right text-gray-600">~$5.00</td><td className="text-right text-gray-600">~$25.00</td></tr>
                        </tbody>
                    </table>
                    <p className="text-xs text-gray-400 mt-3">1 credit = 1,000 tokens. You charge tenants per credit; OpenRouter charges you per model usage.</p>
                </div>
            </div>

            <ToastBanner toast={toast} onDismiss={() => setToast(null)} />
        </div>
    );
}