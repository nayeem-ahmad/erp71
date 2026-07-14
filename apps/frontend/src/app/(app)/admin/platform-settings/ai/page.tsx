'use client';

import { useEffect, useState } from 'react';
import { Loader2, Zap } from 'lucide-react';
import PageHeader from '@/components/ui/compact/PageHeader';
import { PageShell, Button } from '@/components/ui';
import { nestedPageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { routes } from '@/lib/routes';
import { fetchWithAuth } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';

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
    const { t } = useI18n();
    const [settings, setSettings] = useState<AiSettings>(DEFAULTS);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);

    const inputCls = 'w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition';

    useEffect(() => {
        fetchWithAuth('/admin/platform-settings/ai')
            .then((d) => {
                setSettings({
                    api_key: d.api_key === '••••••••' ? '' : (d.api_key ?? ''),
                    default_model: d.default_model ?? DEFAULTS.default_model,
                });
            })
            .catch(() => toast.error('Failed to load AI settings.'))
            .finally(() => setLoading(false));
    }, []);

    async function handleSave() {
        setSaving(true);
        try {
            const payload: Record<string, string | null> = {
                default_model: settings.default_model,
            };
            if (settings.api_key) payload.api_key = settings.api_key;

            await fetchWithAuth('/admin/platform-settings/ai', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ settings: payload }),
            });
            setSettings((prev) => ({ ...prev, api_key: '' }));
            toast.success('AI settings saved.');
        } catch (e: any) {
            toast.error(e.message ?? 'Failed to save.');
        } finally {
            setSaving(false);
        }
    }

    async function handleTest() {
        setTesting(true);
        try {
            const result = await fetchWithAuth('/admin/platform-settings/ai/test', { method: 'POST' });
            if (result?.success) {
                toast.success(`Connection OK — model: ${result.model}`);
            } else {
                toast.error(result?.message ?? 'Test failed.');
            }
        } catch (e: any) {
            toast.error(e.message ?? 'Test failed.');
        } finally {
            setTesting(false);
        }
    }

    return (
        <PageShell maxWidth="narrow">
            <PageHeader
                    title="AI Settings"
                    breadcrumbs={nestedPageBreadcrumbs(
                        t.dashboardHome.breadcrumbHome,
                        t.sidebar.modules.admin,
                        'admin',
                        [{ label: t.admin.platformSettings.index.title, href: routes.admin.platformSettings.root }],
                        'AI Settings',
                    )}
                />

                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    <strong>Platform-wide secret.</strong> This OpenRouter API key is used by all tenants for AI features. Keep it confidential. Get your key from{' '}
                    <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer" className="underline">openrouter.ai/keys</a>.
                </div>

                {loading ? (
                    <div className="flex items-center gap-2 text-gray-400 text-sm py-8 justify-center">
                        <Loader2 className="w-4 h-4 animate-spin" /> Loading…
                    </div>
                ) : (
                    <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-5">
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
                            <Button onClick={handleSave} loading={saving} size="md">
                                {saving ? 'Saving…' : 'Save settings'}
                            </Button>
                        </div>
                    </div>
                )}

                <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
                    <h2 className="text-sm font-medium text-gray-500">Connection test</h2>
                    <p className="text-sm text-gray-500">
                        Sends a single short message through OpenRouter to verify the API key works. Uses ~10 tokens (negligible cost).
                    </p>
                    <Button onClick={handleTest} loading={testing} icon={!testing ? <Zap className="w-4 h-4" /> : undefined} size="md">
                        {testing ? 'Testing…' : 'Test connection'}
                    </Button>
                </div>

                <div className="bg-white rounded-lg border border-gray-200 p-6">
                    <h2 className="text-sm font-medium text-gray-500 mb-3">Pricing reference</h2>
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
        </PageShell>
    );
}