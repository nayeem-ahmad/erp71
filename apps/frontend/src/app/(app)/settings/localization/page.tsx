'use client';

import { useEffect, useMemo, useState } from 'react';
import { Globe, Loader2 } from 'lucide-react';

import { api } from '@/lib/api';
import { localeRegistry } from '@/lib/localization/config';
import { useTenantLocales } from '@/contexts/TenantLocaleContext';
import { useI18n } from '@/lib/i18n';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { toast } from '@/lib/toast';
import { Button, PageShell, Select } from '@/components/ui';

type LocaleOption = 'en' | 'bn' | 'ms';

export default function LocalizationSettingsPage() {
    const { locale, setLocale, t } = useI18n();
    const { allowedLocales } = useTenantLocales();
    const locales = useMemo(
        () => allowedLocales.map((code) => localeRegistry[code]),
        [allowedLocales],
    );
    const [tenantLocale, setTenantLocale] = useState<LocaleOption>('en');
    const [localizationEnabled, setLocalizationEnabled] = useState(false);
    const [loading, setLoading] = useState(true);
    const [savingTenant, setSavingTenant] = useState(false);
    const [savingProfile, setSavingProfile] = useState(false);

    useEffect(() => {
        let active = true;

        Promise.all([api.getMe(), api.getTenantLocalizationSettings()])
            .then(([me, tenantSettings]) => {
                if (!active) return;
                setLocalizationEnabled(Boolean(tenantSettings?.localization_enabled));
                if (me?.preferred_locale && locales.some((entry) => entry.code === me.preferred_locale)) {
                    setLocale(me.preferred_locale);
                }
                setTenantLocale((tenantSettings?.default_locale || 'en') as LocaleOption);
            })
            .catch(() => {
                if (!active) return;
                toast.error(t.settings.localization.tenantSaveFailed);
            })
            .finally(() => {
                if (active) setLoading(false);
            });

        return () => {
            active = false;
        };
    }, [locales, setLocale, t.settings.localization.tenantSaveFailed]);

    const saveTenantLocale = async () => {
        setSavingTenant(true);
        try {
            await api.updateTenantLocalizationSettings({ default_locale: tenantLocale });
            toast.success(t.settings.localization.tenantSaved);
        } catch (error: any) {
            toast.error(error?.message || t.settings.localization.tenantSaveFailed);
        } finally {
            setSavingTenant(false);
        }
    };

    const saveProfileLocale = async () => {
        setSavingProfile(true);
        try {
            await api.updateProfile({ preferred_locale: locale });
            toast.success(t.settings.localization.profileSaved);
        } catch (error: any) {
            toast.error(error?.message || t.settings.localization.profileSaveFailed);
        } finally {
            setSavingProfile(false);
        }
    };

    if (loading) {
        return (
            <PageShell maxWidth="wide">
                <div className="flex items-center gap-2 text-sm text-gray-400">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {t.settings.localization.loading}
                </div>
            </PageShell>
        );
    }

    if (!localizationEnabled) {
        return (
            <PageShell maxWidth="wide" className="space-y-4">
                <PageHeader
                    title={t.settings.localization.title}
                    subtitle={t.settings.localization.description}
                    breadcrumbs={modulePageBreadcrumbs(
                        t.dashboardHome.breadcrumbHome,
                        t.sidebar.modules.accountSettings,
                        t.settings.localization.title,
                        'settings',
                    )}
                />
                <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600">
                    {t.settings.localization.disabledByAdmin}
                </div>
            </PageShell>
        );
    }

    return (
        <PageShell maxWidth="full">
            <PageHeader
                title={t.settings.localization.title}
                subtitle={t.settings.localization.description}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.accountSettings,
                    t.settings.localization.title,
                    'settings',
                )}
            />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                <section className="rounded-lg border border-gray-200 bg-white p-3 md:p-4 space-y-4">
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                            <Globe className="w-5 h-5" />
                        </div>
                        <div>
                            <h2 className="text-sm font-bold text-gray-900">{t.settings.localization.tenantDefaultLabel}</h2>
                            <p className="text-xs text-gray-500 mt-0.5">{t.settings.localization.tenantHelp}</p>
                        </div>
                    </div>

                    <Select
                        value={tenantLocale}
                        onChange={(event) => setTenantLocale(event.target.value as LocaleOption)}
                    >
                        {locales.map((entry) => (
                            <option key={entry.code} value={entry.code}>
                                {entry.nativeLabel}
                            </option>
                        ))}
                    </Select>

                    <Button onClick={saveTenantLocale} disabled={savingTenant} loading={savingTenant}>
                        {t.settings.localization.saveTenant}
                    </Button>
                </section>

                <section className="rounded-lg border border-gray-200 bg-white p-3 md:p-4 space-y-4">
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                            <Globe className="w-5 h-5" />
                        </div>
                        <div>
                            <h2 className="text-sm font-bold text-gray-900">{t.settings.localization.userPreferredLabel}</h2>
                            <p className="text-xs text-gray-500 mt-0.5">{t.settings.localization.userHelp}</p>
                        </div>
                    </div>

                    <Select
                        value={locale}
                        onChange={(event) => {
                            const nextLocale = locales.find((entry) => entry.code === event.target.value);
                            if (nextLocale) {
                                setLocale(nextLocale.code);
                            }
                        }}
                    >
                        {locales.map((entry) => (
                            <option key={entry.code} value={entry.code}>
                                {entry.nativeLabel}
                            </option>
                        ))}
                    </Select>

                    <Button
                        onClick={saveProfileLocale}
                        disabled={savingProfile}
                        loading={savingProfile}
                        className="!bg-emerald-600 hover:!bg-emerald-700"
                    >
                        {t.settings.localization.saveProfile}
                    </Button>
                </section>
            </div>
        </PageShell>
    );
}