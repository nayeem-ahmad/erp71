import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import { Inter, Noto_Sans_Bengali } from 'next/font/google';

import './globals.css';
import { BRAND_NAME } from '../lib/brand';
import { I18nProvider } from '../lib/i18n';
import { DEFAULT_LOCALE, LOCALE_COOKIE_NAME, getLocaleConfig, resolveLocale } from '../lib/localization/config';

const inter = Inter({
    subsets: ['latin'],
    variable: '--font-inter',
});

const notoSansBengali = Noto_Sans_Bengali({
    subsets: ['bengali'],
    weight: ['400', '500', '600', '700'],
    variable: '--font-bengali',
});

export const viewport: Viewport = {
    width: 'device-width',
    initialScale: 1,
    maximumScale: 5,
    userScalable: true,
    themeColor: '#2563eb',
};

export const metadata: Metadata = {
    title: 'ERP71 — Business management for Bangladeshi SMEs',
    description: 'All-in-one business management platform with sales, inventory, accounting, and integrated BDT payments.',
    manifest: '/manifest.json',
    appleWebApp: {
        capable: true,
        statusBarStyle: 'default',
        title: BRAND_NAME,
    },
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
    const cookieStore = await cookies();
    const initialLocale = resolveLocale(cookieStore.get(LOCALE_COOKIE_NAME)?.value ?? DEFAULT_LOCALE);
    const localeInfo = getLocaleConfig(initialLocale);

    return (
        <html lang={localeInfo.htmlLang} dir={localeInfo.dir} suppressHydrationWarning>
            <body className={`${inter.variable} ${notoSansBengali.variable}`}>
                <I18nProvider initialLocale={initialLocale}>{children}</I18nProvider>
            </body>
        </html>
    );
}
