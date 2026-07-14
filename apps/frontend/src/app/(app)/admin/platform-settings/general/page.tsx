'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import PageHeader from '@/components/ui/compact/PageHeader';
import { PageShell, Button } from '@/components/ui';
import { nestedPageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { routes } from '@/lib/routes';
import { fetchWithAuth } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';

type GeneralSettings = {
    platform_name: string;
    support_email: string;
    maintenance_mode: string;
};

const DEFAULTS: GeneralSettings = {
    platform_name: 'ERP71',
    support_email: 'support@erp71.com',
    maintenance_mode: 'false',
};

export default function PlatformGeneralSettingsPage() {
    const { t } = useI18n();
    const m = t.admin.platformSettings.general;
    const c = t.admin.platformSettings.common;
    const [settings, setSettings] = useState<GeneralSettings>(DEFAULTS);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        fetchWithAuth('/admin/platform-settings/general')
            .then((d) => {
                setSettings({
                    platform_name: d.platform_name ?? DEFAULTS.platform_name,
                    support_email: d.support_email ?? DEFAULTS.support_email,
                    maintenance_mode: d.maintenance_mode ?? DEFAULTS.maintenance_mode,
                });
            })
            .catch(() => toast.error(c.loadFailed))
            .finally(() => setLoading(false));
    }, [c.loadFailed]);

    function set(key: keyof GeneralSettings, value: string) {
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
            toast.success(m.saved);
        } catch (e: any) {
            toast.error(e.message ?? c.saveFailed);
        } finally {
            setSaving(false);
        }
    }

    const inputCls = 'w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition';
    const maintenanceOn = settings.maintenance_mode === 'true';

    return (
        <PageShell>
            <div className="max-w-2xl mx-auto space-y-6">
                <PageHeader
                    title={m.title}
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
                    <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-5">
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-1">{m.platformName.label}</label>
                            <input
                                type="text"
                                value={settings.platform_name}
                                onChange={(e) => set('platform_name', e.target.value)}
                                placeholder={m.platformName.placeholder}
                                className={inputCls}
                            />
                            <p className="mt-1 text-xs text-gray-400">{m.platformName.hint}</p>
                        </div>

                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-1">{m.supportEmail.label}</label>
                            <input
                                type="email"
                                value={settings.support_email}
                                onChange={(e) => set('support_email', e.target.value)}
                                placeholder={m.supportEmail.placeholder}
                                className={inputCls}
                            />
                            <p className="mt-1 text-xs text-gray-400">{m.supportEmail.hint}</p>
                        </div>

                        <div className="flex items-start justify-between gap-4 pt-2">
                            <div>
                                <p className="text-sm font-semibold text-gray-800">{m.maintenance.label}</p>
                                <p className="mt-0.5 text-xs text-gray-500">{m.maintenance.hint}</p>
                                {maintenanceOn && (
                                    <p className="mt-1 text-xs font-bold text-red-600">{m.maintenance.activeWarning}</p>
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
                            <Button onClick={handleSave} loading={saving} size="md">
                                {saving ? c.saving : c.saveSettings}
                            </Button>
                        </div>
                    </div>
                )}
            </div>
        </PageShell>
    );
}