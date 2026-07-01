'use client';

import { useEffect } from 'react';
import { useI18n } from '@/lib/i18n';
import { clampLocaleToTenant, type TenantLocaleConfig } from '@/lib/tenant-locales';

/** Keeps the active UI locale within the tenant's enabled languages. */
export default function TenantLocaleSync({
    tenant,
}: {
    tenant: TenantLocaleConfig | null | undefined;
}) {
    const { locale, setLocale } = useI18n();

    useEffect(() => {
        const clamped = clampLocaleToTenant(locale, tenant);
        if (clamped !== locale) {
            setLocale(clamped);
        }
    }, [locale, setLocale, tenant?.localization_enabled, tenant?.secondary_locale]);

    return null;
}