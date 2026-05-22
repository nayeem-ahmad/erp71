'use client';

import { useState, useEffect } from 'react';
import { BarChart3, CheckCircle, Info, Loader2 } from 'lucide-react';
import { fetchWithAuth } from '@/lib/api';

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
    const [settings, setSettings] = useState<ReportSettings>({
        report_weekly_enabled: false,
        report_monthly_enabled: false,
        report_email: '',
    });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [success, setSuccess] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        fetchWithAuth('/api/v1/tenants/report-settings')
            .then((r) => r.json())
            .then((json) => {
                const d = json?.data ?? json;
                if (d) {
                    setSettings({
                        report_weekly_enabled: d.report_weekly_enabled ?? false,
                        report_monthly_enabled: d.report_monthly_enabled ?? false,
                        report_email: d.report_email ?? '',
                    });
                }
            })
            .catch(() => setError('Failed to load report settings.'))
            .finally(() => setLoading(false));
    }, []);

    async function handleSave() {
        setSaving(true);
        setError('');
        setSuccess(false);
        try {
            const res = await fetchWithAuth('/api/v1/tenants/report-settings', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    report_weekly_enabled: settings.report_weekly_enabled,
                    report_monthly_enabled: settings.report_monthly_enabled,
                    report_email: settings.report_email?.trim() || null,
                }),
            });
            if (!res.ok) throw new Error('Save failed');
            setSuccess(true);
            setTimeout(() => setSuccess(false), 3000);
        } catch (e: any) {
            setError(e.message ?? 'Failed to save report settings.');
        } finally {
            setSaving(false);
        }
    }

    function updateSetting<K extends keyof ReportSettings>(key: K, value: ReportSettings[K]) {
        setSettings((prev) => ({ ...prev, [key]: value }));
    }

    return (
        <div className="p-6 max-w-2xl space-y-6">
            <div className="flex items-center gap-2">
                <BarChart3 className="h-6 w-6 text-gray-600" />
                <h1 className="text-2xl font-bold text-gray-900">Automated Reports</h1>
            </div>

            {/* Info box */}
            <div className="flex gap-3 bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800">
                <Info className="h-5 w-5 flex-shrink-0 mt-0.5 text-blue-500" />
                <div>
                    <strong>Automated sales report emails</strong> — enable weekly or monthly reports to
                    receive a summary of your sales, top products, and new customers delivered to your
                    inbox. Reports are sent to your account email unless you specify an override below.
                </div>
            </div>

            {loading ? (
                <div className="flex items-center gap-2 text-gray-400 py-8 justify-center text-sm">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Loading&hellip;
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
                                Sent every Monday morning with last week&apos;s sales summary (Mon–Sun).
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
                                Sent on the 1st of each month with the previous month&apos;s full sales summary.
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
                    <div className="space-y-1.5">
                        <label
                            htmlFor="report_email"
                            className="block text-sm font-semibold text-gray-800"
                        >
                            Report Email Address
                            <span className="ml-1.5 text-xs font-normal text-gray-400">(optional)</span>
                        </label>
                        <input
                            id="report_email"
                            type="email"
                            value={settings.report_email ?? ''}
                            onChange={(e) => updateSetting('report_email', e.target.value)}
                            placeholder="Leave blank to use your account email"
                            className="w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                        />
                        <p className="text-xs text-gray-400">
                            Send reports to this email instead of your account email. Useful for sending
                            reports to a shared inbox or an accountant.
                        </p>
                    </div>

                    {error && (
                        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm">
                            {error}
                        </div>
                    )}

                    {success && (
                        <div className="flex items-center gap-2 bg-green-50 border border-green-200 text-green-700 rounded-lg p-3 text-sm">
                            <CheckCircle className="h-4 w-4 flex-shrink-0" />
                            Report settings saved successfully.
                        </div>
                    )}

                    <div className="pt-2">
                        <button
                            onClick={handleSave}
                            disabled={saving}
                            className="inline-flex items-center gap-2 px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                            {saving ? 'Saving…' : 'Save Report Settings'}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
