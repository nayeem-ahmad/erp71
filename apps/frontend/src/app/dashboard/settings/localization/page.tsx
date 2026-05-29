'use client';

import { useEffect, useState } from 'react';
import { Globe, Loader2 } from 'lucide-react';

import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

type LocaleOption = 'en' | 'bn' | 'ms';

export default function LocalizationSettingsPage() {
    const { locale, locales, setLocale, t } = useI18n();
    const [tenantLocale, setTenantLocale] = useState<LocaleOption>('en');
    const [loading, setLoading] = useState(true);
    const [savingTenant, setSavingTenant] = useState(false);
    const [savingProfile, setSavingProfile] = useState(false);
    const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

    useEffect(() => {
        let active = true;

        Promise.all([api.getMe(), api.getTenantLocalizationSettings()])
            .then(([me, tenantSettings]) => {
                if (!active) return;
                if (me?.preferred_locale && me.preferred_locale !== locale) {
                    setLocale(me.preferred_locale);
                }
                setTenantLocale((tenantSettings?.default_locale || 'en') as LocaleOption);
            })
            .catch(() => {
                if (!active) return;
                setToast({ type: 'error', message: t.settings.localization.tenantSaveFailed });
            })
            .finally(() => {
                if (active) setLoading(false);
            });

        return () => {
            active = false;
        };
    }, [locale, setLocale, t.settings.localization.tenantSaveFailed]);

    const saveTenantLocale = async () => {
        setSavingTenant(true);
        try {
            await api.updateTenantLocalizationSettings({ default_locale: tenantLocale });
            setToast({ type: 'success', message: t.settings.localization.tenantSaved });
        } catch (error: any) {
            setToast({ type: 'error', message: error?.message || t.settings.localization.tenantSaveFailed });
        } finally {
            setSavingTenant(false);
        }
    };

    const saveProfileLocale = async () => {
        setSavingProfile(true);
        try {
            await api.updateProfile({ preferred_locale: locale });
            setToast({ type: 'success', message: t.settings.localization.profileSaved });
        } catch (error: any) {
            setToast({ type: 'error', message: error?.message || t.settings.localization.profileSaveFailed });
        } finally {
            setSavingProfile(false);
        }
    };

    if (loading) {
        return (
            <div className="h-full overflow-y-auto p-6">
                <div className="max-w-3xl mx-auto flex items-center gap-2 text-sm text-gray-400">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {t.settings.localization.loading}
                </div>
            </div>
        );
    }

    return (
        <div className="h-full overflow-y-auto p-6">
            <div className="max-w-3xl mx-auto space-y-6">
                <div>
                    <h1 className="text-2xl font-black text-gray-900 tracking-tight">{t.settings.localization.title}</h1>
                    <p className="mt-1 text-sm text-gray-500">{t.settings.localization.description}</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <section className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4">
                        <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                                <Globe className="w-5 h-5" />
                            </div>
                            <div>
                                <h2 className="text-sm font-bold text-gray-900">{t.settings.localization.tenantDefaultLabel}</h2>
                                <p className="text-xs text-gray-500 mt-0.5">{t.settings.localization.tenantHelp}</p>
                            </div>
                        </div>

                        <select
                            value={tenantLocale}
                            onChange={(event) => setTenantLocale(event.target.value as LocaleOption)}
                            className="w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900"
                        >
                            {locales.map((entry) => (
                                <option key={entry.code} value={entry.code}>
                                    {entry.nativeLabel}
                                </option>
                            ))}
                        </select>

                        <button
                            type="button"
                            onClick={saveTenantLocale}
                            disabled={savingTenant}
                            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60"
                        >
                            {savingTenant && <Loader2 className="w-4 h-4 animate-spin" />}
                            {t.settings.localization.saveTenant}
                        </button>
                    </section>

                    <section className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4">
                        <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                                <Globe className="w-5 h-5" />
                            </div>
                            <div>
                                <h2 className="text-sm font-bold text-gray-900">{t.settings.localization.userPreferredLabel}</h2>
                                <p className="text-xs text-gray-500 mt-0.5">{t.settings.localization.userHelp}</p>
                            </div>
                        </div>

                        <select
                            value={locale}
                            onChange={(event) => {
                                const nextLocale = locales.find((entry) => entry.code === event.target.value);
                                if (nextLocale) {
                                    setLocale(nextLocale.code);
                                }
                            }}
                            className="w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900"
                        >
                            {locales.map((entry) => (
                                <option key={entry.code} value={entry.code}>
                                    {entry.nativeLabel}
                                </option>
                            ))}
                        </select>

                        <button
                            type="button"
                            onClick={saveProfileLocale}
                            disabled={savingProfile}
                            className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-60"
                        >
                            {savingProfile && <Loader2 className="w-4 h-4 animate-spin" />}
                            {t.settings.localization.saveProfile}
                        </button>
                    </section>
                </div>

                {toast && (
                    <div className={`rounded-2xl border px-4 py-3 text-sm ${toast.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
                        {toast.message}
                    </div>
                )}
            </div>
        </div>
    );
}