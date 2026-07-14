'use client';
import { useI18n, formatMessage } from '@/lib/i18n';

import { useState, useEffect } from 'react';
import { BarChart3, Loader2 } from 'lucide-react';
import { fetchWithAuth } from '@/lib/api';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { toast } from '@/lib/toast';
import { Alert, Button, Field, Input, PageShell } from '@/components/ui';

type ReportSettings = {
    report_weekly_enabled: boolean;
    report_monthly_enabled: boolean;
    report_email: string | null;
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

export default function ReportSettingsPage() {
    const { t } = useI18n();
    const m = t.settingsExtras.reportEmails;
    const [settings, setSettings] = useState<ReportSettings>({
        report_weekly_enabled: false,
        report_monthly_enabled: false,
        report_email: '',
    });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        fetchWithAuth('/tenants/report-settings')
            .then((d) => {
                if (d) {
                    setSettings({
                        report_weekly_enabled: d.report_weekly_enabled ?? false,
                        report_monthly_enabled: d.report_monthly_enabled ?? false,
                        report_email: d.report_email ?? '',
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
            await fetchWithAuth('/tenants/report-settings', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    report_weekly_enabled: settings.report_weekly_enabled,
                    report_monthly_enabled: settings.report_monthly_enabled,
                    report_email: settings.report_email?.trim() || null,
                }),
            });
            toast.success(m.saved);
        } catch (e: any) {
            setError(e.message ?? m.saveFailed);
        } finally {
            setSaving(false);
        }
    }

    function updateSetting<K extends keyof ReportSettings>(key: K, value: ReportSettings[K]) {
        setSettings((prev) => ({ ...prev, [key]: value }));
    }

    return (
        <PageShell maxWidth="full" className="space-y-4">
            <PageHeader
                title={(
                    <span className="inline-flex items-center gap-2">
                        <BarChart3 className="h-6 w-6 text-gray-600" />
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
                    {/* Weekly report */}
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <label
                                htmlFor="report_weekly_enabled"
                                className="block text-sm font-semibold text-gray-800"
                            >
                                Enable Weekly Report
                            </label>
                            <p className="mt-0.5 text-xs text-gray-500">
                                {m.weekly.hint}
                            </p>
                        </div>
                        <Toggle
                            id="report_weekly_enabled"
                            checked={settings.report_weekly_enabled}
                            onChange={(v) => updateSetting('report_weekly_enabled', v)}
                        />
                    </div>

                    <hr className="border-gray-100" />

                    {/* Monthly report */}
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <label
                                htmlFor="report_monthly_enabled"
                                className="block text-sm font-semibold text-gray-800"
                            >
                                Enable Monthly Report
                            </label>
                            <p className="mt-0.5 text-xs text-gray-500">
                                {m.monthly.hint}
                            </p>
                        </div>
                        <Toggle
                            id="report_monthly_enabled"
                            checked={settings.report_monthly_enabled}
                            onChange={(v) => updateSetting('report_monthly_enabled', v)}
                        />
                    </div>

                    <hr className="border-gray-100" />

                    {/* Email override */}
                    <Field
                        label={(
                            <>
                                Report Email Address
                                <span className="ml-1.5 text-xs font-normal text-gray-400">{m.email.optional}</span>
                            </>
                        ) as unknown as string}
                        htmlFor="report_email"
                        hint={m.email.hint}
                    >
                        <Input
                            id="report_email"
                            type="email"
                            value={settings.report_email ?? ''}
                            onChange={(e) => updateSetting('report_email', e.target.value)}
                            placeholder={m.email.placeholder}
                        />
                    </Field>

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
