'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { DEFAULT_LOCALE, type Locale } from '@/lib/localization/config';
import {
    getTenantEnabledLocales,
    shouldShowLanguageSwitcher,
    type TenantLocaleConfig,
} from '@/lib/tenant-locales';

type TenantLocaleContextValue = {
    allowedLocales: Locale[];
    showLanguageSwitcher: boolean;
};

const defaultValue: TenantLocaleContextValue = {
    allowedLocales: [DEFAULT_LOCALE],
    showLanguageSwitcher: false,
};

const TenantLocaleContext = createContext<TenantLocaleContextValue>(defaultValue);

export function TenantLocaleProvider({
    tenant,
    children,
}: {
    tenant: TenantLocaleConfig | null | undefined;
    children: ReactNode;
}) {
    const value = useMemo(
        () => ({
            allowedLocales: getTenantEnabledLocales(tenant),
            showLanguageSwitcher: shouldShowLanguageSwitcher(tenant),
        }),
        [tenant?.localization_enabled, tenant?.secondary_locale],
    );

    return (
        <TenantLocaleContext.Provider value={value}>
            {children}
        </TenantLocaleContext.Provider>
    );
}

export function useTenantLocales() {
    return useContext(TenantLocaleContext);
}