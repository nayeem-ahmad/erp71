import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import { Inter, Noto_Sans_Arabic, Noto_Sans_Bengali } from 'next/font/google';

import './globals.css';
import { siteOrigin } from '../lib/domain-routing';
import { BRAND_FULL_NAME, BRAND_NAME } from '../lib/brand';
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

/*
 * Arabic script, covering both `ar` and `ur` — Inter has no Arabic glyphs at
 * all, so without this every Urdu and Arabic screen falls through to whatever
 * the OS happens to ship.
 *
 * Naskh rather than Nastaliq, which is a real tradeoff and not an oversight:
 * Urdu readers expect Nastaliq (`Noto Nastaliq Urdu`), but its cascading
 * baseline needs roughly double the line-height, and this UI is deliberately
 * compact (`text-sm`/`text-xs` body, dense tables). Shipping Nastaliq without
 * first re-tuning row heights would break every table in Urdu; shipping Naskh
 * renders correct, readable Urdu in a typeface that is not the preferred one.
 * The Nastaliq pass is tracked as a follow-up and wants a designer looking at
 * real tables, not a font swap.
 */
const notoSansArabic = Noto_Sans_Arabic({
    subsets: ['arabic'],
    weight: ['400', '500', '600', '700'],
    variable: '--font-arabic',
});

export const viewport: Viewport = {
    width: 'device-width',
    initialScale: 1,
    maximumScale: 5,
    userScalable: true,
    themeColor: '#2563eb',
};

const SITE_DESCRIPTION =
    'All-in-one business management platform with sales, inventory, accounting, and integrated BDT payments.';

export const metadata: Metadata = {
    // Without this, og:image resolves against http://localhost:3000 and every
    // shared link points at a card no crawler can fetch. Same origin the
    // sitemap and robots.txt already use.
    metadataBase: new URL(siteOrigin()),
    title: BRAND_FULL_NAME,
    description: SITE_DESCRIPTION,
    // `manifest` is deliberately absent: app/manifest.ts already emits the link
    // tag pointing at /manifest.webmanifest. Naming it here produced a /manifest.json 404.
    appleWebApp: {
        capable: true,
        statusBarStyle: 'default',
        title: BRAND_NAME,
    },
    // Inherited by every page that doesn't set its own — without this, links
    // shared to Facebook and WhatsApp render with no image at all.
    openGraph: {
        type: 'website',
        siteName: BRAND_NAME,
        title: BRAND_FULL_NAME,
        description: SITE_DESCRIPTION,
    },
    twitter: {
        card: 'summary_large_image',
        title: BRAND_FULL_NAME,
        description: SITE_DESCRIPTION,
    },
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
    const cookieStore = await cookies();
    const initialLocale = resolveLocale(cookieStore.get(LOCALE_COOKIE_NAME)?.value ?? DEFAULT_LOCALE);
    const localeInfo = getLocaleConfig(initialLocale);

    /*
     * The font variables belong on `<html>`, not `<body>`.
     *
     * Tailwind's preflight sets `html { font-family: theme('fontFamily.sans') }`,
     * which compiles to `var(--font-inter), var(--font-bengali), var(--font-arabic), ...`.
     * With the `next/font` variable classes on `<body>`, those custom properties
     * are undefined at `<html>`, so the whole declaration is invalid at
     * computed-value time and `font-family` falls back to the browser default —
     * which `<body>` then inherits, since preflight's `body` rule sets only
     * margin and line-height. The intended stack reached exactly those subtrees
     * that happened to carry an explicit `font-sans`; everything else (the
     * storefront, the public quotation view, `/demo`, `/app-entry`, the label
     * sheet, and every dropdown portalled to `document.body`) rendered in the
     * browser's default font. Under `lang="bn"` that default is resolved
     * per-language, so Bangla users saw a system Bengali face applied to Latin
     * text too.
     *
     * `font-sans` on `<body>` is deliberate belt-and-braces: the variables are
     * in scope there either way, so the app keeps its typeface even if the
     * preflight rule is ever lost.
     */
    return (
        <html
            lang={localeInfo.htmlLang}
            dir={localeInfo.dir}
            className={`${inter.variable} ${notoSansBengali.variable} ${notoSansArabic.variable}`}
            suppressHydrationWarning
        >
            <body className="font-sans">
                <I18nProvider initialLocale={initialLocale}>{children}</I18nProvider>
            </body>
        </html>
    );
}
