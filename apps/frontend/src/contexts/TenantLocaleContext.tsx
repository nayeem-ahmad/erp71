'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { DEFAULT_LOCALE, type Locale } from '@/lib/localization/config';
import {
    getTenantEnabledLocales,
    shouldShowLanguageSwitcher,
    type TenantLocaleConfig,
} from '@/lib/tenant-locales';
import { setActiveTimeZone } from '@/lib/format';
import { DEFAULT_TIMEZONE } from '@/lib/timezones';

type TenantLocaleContextValue = {
    allowedLocales: Locale[];
    showLanguageSwitcher: boolean;
    /** The workspace zone every date in the UI is rendered in. */
    timezone: string;
};

const defaultValue: TenantLocaleContextValue = {
    allowedLocales: [DEFAULT_LOCALE],
    showLanguageSwitcher: false,
    timezone: DEFAULT_TIMEZONE,
};

const TenantLocaleContext = createContext<TenantLocaleContextValue>(defaultValue);

export function TenantLocaleProvider({
    tenant,
    children,
}: {
    tenant: TenantLocaleConfig | null | undefined;
    children: ReactNode;
}) {
    const timezone = tenant?.timezone || DEFAULT_TIMEZONE;

    // Set during render rather than in an effect: the formatters are called by
    // the very children this provider wraps, and an effect would let the first
    // paint render every date in the device's zone before correcting itself.
    setActiveTimeZone(timezone);

    const value = useMemo(
        () => ({
            allowedLocales: getTenantEnabledLocales(tenant),
            showLanguageSwitcher: shouldShowLanguageSwitcher(tenant),
            timezone,
        }),
        [tenant?.localization_enabled, tenant?.secondary_locale, timezone],
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