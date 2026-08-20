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
    web_search_enabled: string;
    web_search_engine: string;
    web_search_max_results: string;
    web_search_daily_cap: string;
};

const DEFAULTS: AiSettings = {
    api_key: '',
    default_model: 'anthropic/claude-haiku-4.5',
    web_search_enabled: 'false',
    web_search_engine: 'exa',
    web_search_max_results: '5',
    web_search_daily_cap: '50',
};

const SEARCH_ENGINE_OPTIONS = [
    { value: 'exa', label: 'Exa — $0.005 per search (up to 10 results)' },
    { value: 'parallel', label: 'Parallel — $0.001 per search (up to 10 results)' },
    { value: 'perplexity', label: 'Perplexity — $0.005 per search' },
    { value: 'native', label: 'Native — the answering model’s own search, priced by its provider' },
];

const MODEL_OPTIONS = [
    { value: 'anthropic/claude-haiku-4.5', label: 'Claude Haiku 4.5 — fastest, lowest cost' },
    { value: 'anthropic/claude-sonnet-4.6', label: 'Claude Sonnet 4.6 — balanced quality' },
    { value: 'anthropic/claude-opus-4.5', label: 'Claude Opus 4.5 — most capable' },
    { value: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash — very low cost' },
    { value: 'openai/gpt-4o-mini', label: 'GPT-4o Mini — fast OpenAI model' },
    { value: 'moonshotai/kimi-k3', label: 'Kimi K3 — long-context agentic, Sonnet-class pricing' },
    { value: 'qwen/qwen3.7-plus', label: 'Qwen3.7 Plus — very low cost, 1M context' },
    { value: 'openrouter/free', label: 'Free router — $0, but rate-limited and non-deterministic' },
];

/** Sentinel for the "type a slug" branch — never a real OpenRouter model id. */
const CUSTOM_MODEL = '__custom__';

/** provider/model, the shape every OpenRouter slug takes. */
const MODEL_SLUG = /^[a-z0-9][\w.-]*\/[\w.:-]+$/i;

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
    // OpenRouter adds models faster than this list can be edited, so an admin can
    // always type a slug the dropdown has never heard of.
    const [customModel, setCustomModel] = useState(false);
    const [modelError, setModelError] = useState<string | null>(null);

    const inputCls = 'w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition';

    useEffect(() => {
        fetchWithAuth('/admin/platform-settings/ai')
            .then((d) => {
                // A stored slug that predates this list — or was typed by hand —
                // must come back in the text field, not silently snap to Haiku.
                const model = d.default_model ?? DEFAULTS.default_model;
                setCustomModel(Boolean(model) && !MODEL_OPTIONS.some((o) => o.value === model));
                setSettings({
                    api_key: d.api_key === '••••••••' ? '' : (d.api_key ?? ''),
                    default_model: d.default_model ?? DEFAULTS.default_model,
                    web_search_enabled: d.web_search_enabled ?? DEFAULTS.web_search_enabled,
                    web_search_engine: d.web_search_engine ?? DEFAULTS.web_search_engine,
                    web_search_max_results: d.web_search_max_results ?? DEFAULTS.web_search_max_results,
                    web_search_daily_cap: d.web_search_daily_cap ?? DEFAULTS.web_search_daily_cap,
                });
            })
            .catch(() => toast.error('Failed to load AI settings.'))
            .finally(() => setLoading(false));
    }, []);

    async function handleSave() {
        // A malformed slug fails on every AI call for every tenant, and only ever
        // as an opaque OpenRouter 400. Catch it at the point of entry instead.
        const model = settings.default_model.trim();
        if (!MODEL_SLUG.test(model)) {
            setModelError('Enter a model slug in the form provider/model — for example moonshotai/kimi-k3.');
            return;
        }
        setModelError(null);

        setSaving(true);
        try {
            const payload: Record<string, string | null> = {
                default_model: model,
                web_search_enabled: settings.web_search_enabled,
                web_search_engine: settings.web_search_engine,
                web_search_max_results: settings.web_search_max_results,
                web_search_daily_cap: settings.web_search_daily_cap,
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
                            hint="OpenRouter model slug used for the AI assistant, report narration and message drafting. Haiku is recommended for cost efficiency."
                        >
                            <select
                                value={customModel ? CUSTOM_MODEL : settings.default_model}
                                onChange={(e) => {
                                    const next = e.target.value;
                                    setModelError(null);
                                    if (next === CUSTOM_MODEL) {
                                        // Blank the field so the admin types a slug
                                        // rather than saving the model they left.
                                        setCustomModel(true);
                                        setSettings((s) => ({ ...s, default_model: '' }));
                                        return;
                                    }
                                    setCustomModel(false);
                                    setSettings((s) => ({ ...s, default_model: next }));
                                }}
                                className={inputCls}
                            >
                                {MODEL_OPTIONS.map((o) => (
                                    <option key={o.value} value={o.value}>{o.label}</option>
                                ))}
                                <option value={CUSTOM_MODEL}>Other — enter a model slug…</option>
                            </select>

                            {customModel ? (
                                <input
                                    type="text"
                                    value={settings.default_model}
                                    onChange={(e) => {
                                        setModelError(null);
                                        setSettings((s) => ({ ...s, default_model: e.target.value }));
                                    }}
                                    placeholder="provider/model — e.g. moonshotai/kimi-k3"
                                    spellCheck={false}
                                    autoCapitalize="none"
                                    aria-label="Custom model slug"
                                    aria-invalid={Boolean(modelError)}
                                    className={`${inputCls} mt-2 font-mono`}
                                />
                            ) : null}

                            {modelError ? <p className="mt-1 text-xs text-red-600">{modelError}</p> : null}

                            {customModel ? (
                                <p className="mt-1 text-xs text-gray-400">
                                    Copy the slug from <a href="https://openrouter.ai/models" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">openrouter.ai/models</a>. The assistant
                                    needs a model that supports tool calling, or every question will come back
                                    unanswered. Cost is read from each response, so an unlisted model still bills
                                    accurately.
                                </p>
                            ) : null}
                        </Field>

                        <div className="border-t border-gray-100 pt-5 space-y-4">
                            <div>
                                <h2 className="text-sm font-semibold text-gray-900">Web search</h2>
                                <p className="mt-1 text-xs text-gray-500">
                                    Lets the AI assistant look up facts outside a tenant&apos;s own database — market prices, VAT
                                    rules, brand information. It is offered to the model as a tool, so it only runs on questions
                                    that actually need the web; questions about a tenant&apos;s own sales or stock never trigger a
                                    search. Each search bills a per-request fee to the platform on top of tokens.
                                </p>
                            </div>

                            <div>
                                <label
                                    htmlFor="web-search-enabled"
                                    className="flex min-h-touch cursor-pointer items-center gap-2.5 text-sm text-gray-700"
                                >
                                    <input
                                        id="web-search-enabled"
                                        type="checkbox"
                                        checked={settings.web_search_enabled === 'true'}
                                        onChange={(e) =>
                                            setSettings((s) => ({ ...s, web_search_enabled: e.target.checked ? 'true' : 'false' }))
                                        }
                                        className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                    />
                                    <span>Enable web search</span>
                                </label>
                                <p className="ps-6 text-xs text-gray-400">
                                    When off, both web tools are withheld from the model entirely.
                                </p>
                            </div>

                            {settings.web_search_enabled === 'true' ? (
                                <div className="space-y-4 ps-6">
                                    <Field
                                        label="Search engine"
                                        hint="Which index OpenRouter searches, and what each search costs you."
                                    >
                                        <select
                                            value={settings.web_search_engine}
                                            onChange={(e) => setSettings((s) => ({ ...s, web_search_engine: e.target.value }))}
                                            className={inputCls}
                                        >
                                            {SEARCH_ENGINE_OPTIONS.map((o) => (
                                                <option key={o.value} value={o.value}>{o.label}</option>
                                            ))}
                                        </select>
                                    </Field>

                                    <Field
                                        label="Results per search"
                                        hint="1–10. Exa and Parallel charge one flat fee for the first 10, so more results cost nothing extra — but each one is billed again as input tokens on the next model call. 5 is a good balance."
                                    >
                                        <input
                                            type="number"
                                            min={1}
                                            max={10}
                                            value={settings.web_search_max_results}
                                            onChange={(e) => setSettings((s) => ({ ...s, web_search_max_results: e.target.value }))}
                                            className={inputCls}
                                        />
                                    </Field>

                                    <Field
                                        label="Daily searches per tenant"
                                        hint="Caps what one business can spend in a day. At the Exa rate, 50 searches is about $0.25. Set 0 for no cap."
                                    >
                                        <input
                                            type="number"
                                            min={0}
                                            value={settings.web_search_daily_cap}
                                            onChange={(e) => setSettings((s) => ({ ...s, web_search_daily_cap: e.target.value }))}
                                            className={inputCls}
                                        />
                                    </Field>
                                </div>
                            ) : null}
                        </div>

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
                        <a href="https://openrouter.ai/models" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">openrouter.ai/models</a>{' '}
                        for live rates.
                    </p>
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-xs font-semibold text-gray-400 uppercase tracking-wider border-b border-gray-100">
                                <th className="text-start pb-2">Model</th>
                                <th className="text-end pb-2">Typical input /M</th>
                                <th className="text-end pb-2">Typical output /M</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                            <tr><td className="py-2 font-medium">Claude Haiku 4.5</td><td className="text-end text-gray-600">~$1.00</td><td className="text-end text-gray-600">~$5.00</td></tr>
                            <tr><td className="py-2 font-medium">Claude Sonnet 4.6</td><td className="text-end text-gray-600">~$3.00</td><td className="text-end text-gray-600">~$15.00</td></tr>
                            <tr><td className="py-2 font-medium">Claude Opus 4.5</td><td className="text-end text-gray-600">~$5.00</td><td className="text-end text-gray-600">~$25.00</td></tr>
                            <tr><td className="py-2 font-medium">Kimi K3</td><td className="text-end text-gray-600">~$3.00</td><td className="text-end text-gray-600">~$15.00</td></tr>
                            <tr><td className="py-2 font-medium">Qwen3.7 Plus</td><td className="text-end text-gray-600">~$0.32</td><td className="text-end text-gray-600">~$1.28</td></tr>
                            <tr><td className="py-2 font-medium">Free router</td><td className="text-end text-gray-600">$0.00</td><td className="text-end text-gray-600">$0.00</td></tr>
                        </tbody>
                    </table>
                    <p className="text-xs text-gray-400 mt-3">1 credit = 1,000 tokens. You charge tenants per credit; OpenRouter charges you per model usage.</p>
                </div>
        </PageShell>
    );
}