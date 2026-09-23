'use client';

import { useEffect } from 'react';
import { useI18n } from '@/lib/i18n';
import { clampLocaleToTenant, type TenantLocaleConfig } from '@/lib/tenant-locales';

/**
 * Keeps the active UI locale within the tenant's enabled languages.
 *
 * Does nothing until a tenant is known. The layout passes `null` while
 * `/auth/me` is still loading (and in platform-admin / referee mode), and
 * clamping against "no tenant" would mean clamping to English only — which
 * `setLocale` then persists, so a Bangla user was put back into English on
 * every full page load before their workspace had even arrived.
 */
export default function TenantLocaleSync({
    tenant,
}: {
    tenant: TenantLocaleConfig | null | undefined;
}) {
    const { locale, setLocale } = useI18n();

    useEffect(() => {
        if (!tenant) return;
        const clamped = clampLocaleToTenant(locale, tenant);
        if (clamped !== locale) {
            setLocale(clamped);
        }
    }, [locale, setLocale, tenant?.localization_enabled, tenant?.secondary_locale]);

    return null;
}