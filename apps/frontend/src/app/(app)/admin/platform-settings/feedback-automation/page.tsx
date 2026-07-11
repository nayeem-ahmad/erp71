'use client';

import { useEffect, useState } from 'react';
import { Loader2, CheckCircle, XCircle, Bot } from 'lucide-react';
import PageHeader from '@/components/ui/compact/PageHeader';
import { nestedPageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { routes } from '@/lib/routes';
import { fetchWithAuth } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

type Settings = {
    enabled: string;
    schedule: string;
    model: string;
    max_turns: string;
    require_migration_signoff: string;
    github_token: string;
    github_repo: string;
    github_base_branch: string;
    github_production_branch: string;
};

const DEFAULTS: Settings = {
    enabled: 'false',
    schedule: 'manual',
    model: 'anthropic/claude-sonnet-4.6',
    max_turns: '40',
    require_migration_signoff: 'true',
    github_token: '',
    github_repo: 'nayeem-ahmad/erp71',
    github_base_branch: 'dev',
    github_production_branch: 'main',
};

// Curated for the coding agent: reliable tool-calling on a provider without an aggressive
// input guardrail (avoid z-ai/glm-* and deepseek, which block or ignore tool calls on repo code).
// Prices are per 1M tokens (input/output); verify current pricing on openrouter.ai before relying on it.
const RECOMMENDED_MODELS: { slug: string; price: string; note: string }[] = [
    { slug: 'openai/gpt-5.1-codex-mini', price: '$0.25/$2.00', note: 'cheapest solid — coding-tuned' },
    { slug: 'openai/gpt-5-mini', price: '$0.25/$2.00', note: 'cheap — strong reasoning + tools' },
    { slug: 'google/gemini-2.5-flash', price: '$0.30/$2.50', note: 'cheap — 1M context' },
    { slug: 'anthropic/claude-haiku-4.5', price: '$1.00/$5.00', note: 'cheap Claude — great tool-use' },
    { slug: 'openai/gpt-5.1-codex', price: '$1.25/$10', note: 'best value coder' },
    { slug: 'google/gemini-2.5-pro', price: '$1.25/$10', note: 'strong coder — 1M context' },
    { slug: 'anthropic/claude-sonnet-4.6', price: '$3.00/$15', note: 'most reliable (default)' },
];

const MANUAL_MODEL = '__manual__';

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

export default function FeedbackAutomationSettingsPage() {
    const { t } = useI18n();
    const [settings, setSettings] = useState<Settings>(DEFAULTS);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [toast, setToast] = useState<Toast>(null);
    // Show the free-text slug box when the user picks "manual" or the saved model isn't a preset.
    const [manualModel, setManualModel] = useState(false);
    const isPresetModel = RECOMMENDED_MODELS.some((m) => m.slug === settings.model);
    const showManualModel = manualModel || !isPresetModel;

    const inputCls = 'w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition';

    useEffect(() => {
        // fetchWithAuth already unwraps the { data } envelope and parses JSON — no .json()/.ok here.
        fetchWithAuth('/admin/platform-settings/feedback_automation')
            .then((d: any) => {
                setSettings({
                    enabled: d.enabled ?? DEFAULTS.enabled,
                    schedule: d.schedule ?? DEFAULTS.schedule,
                    model: d.model ?? DEFAULTS.model,
                    max_turns: d.max_turns ?? DEFAULTS.max_turns,
                    require_migration_signoff: d.require_migration_signoff ?? DEFAULTS.require_migration_signoff,
                    github_token: d.github_token === '••••••••' ? '' : (d.github_token ?? ''),
                    github_repo: d.github_repo ?? DEFAULTS.github_repo,
                    github_base_branch: d.github_base_branch ?? DEFAULTS.github_base_branch,
                    github_production_branch: d.github_production_branch ?? DEFAULTS.github_production_branch,
                });
            })
            .catch(() => setToast({ type: 'error', message: 'Failed to load feedback automation settings.' }))
            .finally(() => setLoading(false));
    }, []);

    async function handleSave() {
        setSaving(true);
        try {
            const payload: Record<string, string | null> = {
                enabled: settings.enabled,
                schedule: settings.schedule,
                model: settings.model,
                max_turns: settings.max_turns,
                require_migration_signoff: settings.require_migration_signoff,
                github_repo: settings.github_repo,
                github_base_branch: settings.github_base_branch,
                github_production_branch: settings.github_production_branch,
            };
            if (settings.github_token) payload.github_token = settings.github_token;

            await fetchWithAuth('/admin/platform-settings/feedback_automation', {
                method: 'PATCH',
                body: JSON.stringify({ settings: payload }),
            });
            setSettings((prev) => ({ ...prev, github_token: '' }));
            setToast({ type: 'success', message: 'Feedback automation settings saved.' });
        } catch (e: any) {
            setToast({ type: 'error', message: e.message ?? 'Failed to save.' });
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-3 md:p-4 font-sans text-gray-900 text-[13px]">
            <div className="max-w-2xl mx-auto space-y-6">
                <PageHeader
                    title="Feedback Automation"
                    breadcrumbs={nestedPageBreadcrumbs(
                        t.dashboardHome.breadcrumbHome,
                        t.sidebar.modules.admin,
                        'admin',
                        [{ label: t.admin.platformSettings.index.title, href: routes.admin.platformSettings.root }],
                        'Feedback Automation',
                    )}
                />

                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    <strong>Experimental.</strong> Lets an agent propose an implementation plan for approved tenant feedback,
                    and — once you approve the plan — implement it and open a pull request. It never merges anything itself;
                    every PR still needs human review. Reuses the OpenRouter key configured on the AI settings page.
                </div>

                {loading ? (
                    <div className="flex items-center gap-2 text-gray-400 text-sm py-8 justify-center">
                        <Loader2 className="w-4 h-4 animate-spin" /> Loading…
                    </div>
                ) : (
                    <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-5">
                        <Field label="Enabled">
                            <select
                                value={settings.enabled}
                                onChange={(e) => setSettings((s) => ({ ...s, enabled: e.target.value }))}
                                className={inputCls}
                            >
                                <option value="false">Off</option>
                                <option value="true">On</option>
                            </select>
                        </Field>

                        <Field
                            label="Batch schedule"
                            hint="How often to automatically propose plans for feedback with a saved instruction. 'Manual' means only the Propose Plan button in the feedback list triggers it."
                        >
                            <select
                                value={settings.schedule}
                                onChange={(e) => setSettings((s) => ({ ...s, schedule: e.target.value }))}
                                className={inputCls}
                            >
                                <option value="manual">Manual only</option>
                                <option value="daily">Daily</option>
                                <option value="weekly">Weekly</option>
                            </select>
                        </Field>

                        <Field label="Model" hint="OpenRouter model slug for the coding agent. Pick a recommended model or enter any slug manually. Use a strong tool-calling model on a provider without an aggressive input guardrail — avoid z-ai/glm-* and deepseek, which block or ignore tool calls on repo code.">
                            <select
                                value={showManualModel ? MANUAL_MODEL : settings.model}
                                onChange={(e) => {
                                    const v = e.target.value;
                                    if (v === MANUAL_MODEL) {
                                        setManualModel(true);
                                    } else {
                                        setManualModel(false);
                                        setSettings((s) => ({ ...s, model: v }));
                                    }
                                }}
                                className={inputCls}
                            >
                                {RECOMMENDED_MODELS.map((m) => (
                                    <option key={m.slug} value={m.slug}>
                                        {m.slug} ({m.price} per 1M — {m.note})
                                    </option>
                                ))}
                                <option value={MANUAL_MODEL}>✏️ Enter model slug manually…</option>
                            </select>
                            {showManualModel && (
                                <input
                                    value={settings.model}
                                    onChange={(e) => setSettings((s) => ({ ...s, model: e.target.value }))}
                                    placeholder="e.g. openai/gpt-5.1-codex"
                                    className={`${inputCls} mt-2`}
                                />
                            )}
                        </Field>

                        <Field label="Max tool-call turns" hint="How many model round-trips the agent may take per run (5–100) before it must return a best-effort plan. Raise this for large repos where the agent runs out of turns while exploring; lower it to cap cost per run.">
                            <input
                                type="number"
                                min={5}
                                max={100}
                                value={settings.max_turns}
                                onChange={(e) => setSettings((s) => ({ ...s, max_turns: e.target.value }))}
                                className={inputCls}
                            />
                        </Field>

                        <Field label="Require migration sign-off">
                            <select
                                value={settings.require_migration_signoff}
                                onChange={(e) => setSettings((s) => ({ ...s, require_migration_signoff: e.target.value }))}
                                className={inputCls}
                            >
                                <option value="true">Yes — block approval of migration-touching plans until explicitly confirmed</option>
                                <option value="false">No (not recommended)</option>
                            </select>
                        </Field>

                        <Field label="GitHub token" hint="Fine-grained personal access token or GitHub App installation token, scoped only to the target repo, with contents + pull-requests write access. For the in-app Deploy to Production button, also grant actions:write (to dispatch the deploy workflow). Leave blank to keep existing value.">
                            <input
                                type="password"
                                autoComplete="new-password"
                                value={settings.github_token}
                                onChange={(e) => setSettings((s) => ({ ...s, github_token: e.target.value }))}
                                placeholder="github_pat_••••••••"
                                className={inputCls}
                            />
                        </Field>

                        <Field label="GitHub repo">
                            <input
                                value={settings.github_repo}
                                onChange={(e) => setSettings((s) => ({ ...s, github_repo: e.target.value }))}
                                className={inputCls}
                            />
                        </Field>

                        <Field label="Base branch" hint="Branch the agent clones and opens PRs against (the integration branch).">
                            <input
                                value={settings.github_base_branch}
                                onChange={(e) => setSettings((s) => ({ ...s, github_base_branch: e.target.value }))}
                                className={inputCls}
                            />
                        </Field>

                        <Field label="Production branch" hint="Where a merged feedback PR is auto-promoted, and what the Deploy to Production button ships. The promotion only fires after a Feedback Automation merge, and only once its dev→main PR is green.">
                            <input
                                value={settings.github_production_branch}
                                onChange={(e) => setSettings((s) => ({ ...s, github_production_branch: e.target.value }))}
                                className={inputCls}
                            />
                        </Field>

                        <div className="pt-2">
                            <button
                                onClick={handleSave}
                                disabled={saving}
                                className="inline-flex items-center gap-2 rounded-xl bg-purple-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-purple-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors shadow-sm"
                            >
                                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bot className="w-4 h-4" />}
                                {saving ? 'Saving…' : 'Save settings'}
                            </button>
                        </div>
                    </div>
                )}
            </div>

            <ToastBanner toast={toast} onDismiss={() => setToast(null)} />
        </div>
    );
}
