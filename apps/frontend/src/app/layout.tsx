import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';

import './globals.css';
import { I18nProvider } from '../lib/i18n';
import { DEFAULT_LOCALE, LOCALE_COOKIE_NAME, getLocaleConfig, resolveLocale } from '../lib/localization/config';

export const viewport: Viewport = {
    width: 'device-width',
    initialScale: 1,
    maximumScale: 5,
    userScalable: true,
    themeColor: '#2563eb',
};

export const metadata: Metadata = {
    title: 'RetailSaaS — Retail management for Bangladeshi businesses',
    description: 'All-in-one retail management platform with POS, inventory, sales analytics, and integrated BDT payments.',
    manifest: '/manifest.json',
    appleWebApp: {
        capable: true,
        statusBarStyle: 'default',
        title: 'RetailSaaS',
    },
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
    const cookieStore = await cookies();
    const initialLocale = resolveLocale(cookieStore.get(LOCALE_COOKIE_NAME)?.value ?? DEFAULT_LOCALE);
    const localeInfo = getLocaleConfig(initialLocale);

    return (
        <html lang={localeInfo.htmlLang} dir={localeInfo.dir} suppressHydrationWarning>
            <body>
                <I18nProvider initialLocale={initialLocale}>{children}</I18nProvider>
            </body>
        </html>
    );
}
