'use client';

import { useEffect, useState } from 'react';
import { Loader2, CheckCircle, XCircle } from 'lucide-react';
import PageHeader from '@/components/ui/compact/PageHeader';
import { nestedPageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { routes } from '@/lib/routes';
import { fetchWithAuth } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

type FeatureSettings = {
    feedback_enabled: string;
    support_enabled: string;
    help_enabled: string;
    voice_enabled: string;
    manufacturing_enabled: string;
};

const DEFAULTS: FeatureSettings = {
    feedback_enabled: 'false',
    support_enabled: 'false',
    help_enabled: 'false',
    voice_enabled: 'false',
    manufacturing_enabled: 'true',
};

type FeatureToggleKey = keyof FeatureSettings;

const FEATURE_TOGGLES: Array<{
    key: FeatureToggleKey;
    labelKey: 'feedback' | 'support' | 'help' | 'voice' | 'manufacturing';
}> = [
    { key: 'feedback_enabled', labelKey: 'feedback' },
    { key: 'support_enabled', labelKey: 'support' },
    { key: 'help_enabled', labelKey: 'help' },
    { key: 'voice_enabled', labelKey: 'voice' },
    { key: 'manufacturing_enabled', labelKey: 'manufacturing' },
];

function FeatureSwitch({
    label,
    hint,
    enabled,
    onToggle,
}: {
    label: string;
    hint: string;
    enabled: boolean;
    onToggle: () => void;
}) {
    return (
        <div className="flex items-start justify-between gap-4">
            <div>
                <p className="text-sm font-semibold text-gray-800">{label}</p>
                <p className="mt-0.5 text-xs text-gray-500">{hint}</p>
            </div>
            <button
                type="button"
                role="switch"
                aria-checked={enabled}
                onClick={onToggle}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${enabled ? 'bg-blue-600' : 'bg-gray-200'}`}
            >
                <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${enabled ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
        </div>
    );
}

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

export default function PlatformTenantFeaturesPage() {
    const { t } = useI18n();
    const m = t.admin.platformSettings.tenantFeatures;
    const c = t.admin.platformSettings.common;
    const [settings, setSettings] = useState<FeatureSettings>(DEFAULTS);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [toast, setToast] = useState<Toast>(null);

    useEffect(() => {
        fetchWithAuth('/admin/platform-settings/general')
            .then((d) => {
                setSettings({
                    feedback_enabled: d.feedback_enabled ?? DEFAULTS.feedback_enabled,
                    support_enabled: d.support_enabled ?? DEFAULTS.support_enabled,
                    help_enabled: d.help_enabled ?? DEFAULTS.help_enabled,
                    voice_enabled: d.voice_enabled ?? DEFAULTS.voice_enabled,
                    manufacturing_enabled: d.manufacturing_enabled ?? DEFAULTS.manufacturing_enabled,
                });
            })
            .catch(() => setToast({ type: 'error', message: c.loadFailed }))
            .finally(() => setLoading(false));
    }, [c.loadFailed]);

    function set(key: FeatureToggleKey, value: string) {
        setSettings((s) => ({ ...s, [key]: value }));
    }

    async function handleSave() {
        setSaving(true);
        try {
            await fetchWithAuth('/admin/platform-settings/general', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ settings }),
            });
            setToast({ type: 'success', message: m.saved });
        } catch (e: any) {
            setToast({ type: 'error', message: e.message ?? c.saveFailed });
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="overflow-y-auto h-full bg-canvas p-3 md:p-4 font-sans text-gray-900 text-[13px]">
            <div className="max-w-2xl mx-auto space-y-6">
                <PageHeader
                    title={m.title}
                    subtitle={m.description}
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
                        <p className="text-xs text-gray-500">{m.hint}</p>
                        {FEATURE_TOGGLES.map(({ key, labelKey }) => {
                            const feature = m[labelKey];
                            const enabled = settings[key] === 'true';
                            return (
                                <FeatureSwitch
                                    key={key}
                                    label={feature.label}
                                    hint={feature.hint}
                                    enabled={enabled}
                                    onToggle={() => set(key, enabled ? 'false' : 'true')}
                                />
                            );
                        })}

                        <div className="pt-2">
                            <button
                                onClick={handleSave}
                                disabled={saving}
                                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors shadow-sm"
                            >
                                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                                {saving ? c.saving : c.saveSettings}
                            </button>
                        </div>
                    </div>
                )}
            </div>

            <ToastBanner toast={toast} onDismiss={() => setToast(null)} />
        </div>
    );
}